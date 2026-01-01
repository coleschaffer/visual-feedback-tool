// Self-contained service worker - no external imports

// Types (inlined to avoid import issues)
interface VisualChange {
  id: string;
  element: {
    selector: string;
    tag: string;
    classes: string[];
    screenshot: string | null;
  };
  feedback: string;
  visualAdjustments: Record<string, string>;
  timestamp: string;
  status: string;
}

interface MCPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// State
let isActive = false;
let mcpToken: string | null = null;
let mcpSocket: WebSocket | null = null;
let connectedProject: string | null = null;
let pendingChanges: VisualChange[] = [];

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(
  message: { type: string; active?: boolean; rect?: any; change?: VisualChange; token?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
) {
  switch (message.type) {
    case 'GET_STATE':
      sendResponse({
        isActive,
        mcpToken,
        connectionStatus: getConnectionStatus(),
        connectedProject
      });
      break;

    case 'SET_ACTIVE':
      isActive = message.active ?? false;
      updateIcon();
      sendResponse({ success: true });
      break;

    case 'CAPTURE_SCREENSHOT':
      if (sender.tab?.id && sender.tab?.windowId !== undefined && message.rect) {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(
            sender.tab.windowId,
            { format: 'png' }
          );
          // Send full screenshot - cropping happens in content script
          sendResponse({ success: true, dataUrl });
        } catch (error) {
          console.error('Screenshot error:', error);
          sendResponse({ success: false, error: String(error) });
        }
      } else {
        sendResponse({ success: false, error: 'No tab context' });
      }
      break;

    case 'CONFIRM_CHANGE':
      if (message.change) {
        console.log('[VF-SW] Received CONFIRM_CHANGE:', message.change.id);
        pendingChanges.push(message.change);
        const sent = await sendToMCP(message.change);
        console.log('[VF-SW] Sent to MCP:', sent);
        sendResponse({ success: sent });
      }
      break;

    case 'CONNECT_MCP':
      if (message.token) {
        mcpToken = message.token;
        connectedProject = (message as any).projectName || null;
        await chrome.storage.local.set({ mcpToken, connectedProject });
        connectToMCP();
        sendResponse({ success: true });
      }
      break;

    case 'DISCONNECT_MCP':
      if (mcpSocket) {
        mcpSocket.close();
        mcpSocket = null;
      }
      mcpToken = null;
      connectedProject = null;
      await chrome.storage.local.remove(['mcpToken', 'connectedProject']);
      sendResponse({ success: true });
      break;

    case 'CHECK_CONNECTION':
      sendResponse({ status: getConnectionStatus() });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

// Update extension icon based on active state
function updateIcon() {
  const iconPath = isActive ? '/icons/icon-active' : '/icons/icon';

  chrome.action.setIcon({
    path: {
      16: `${iconPath}16.png`,
      32: `${iconPath}32.png`,
      48: `${iconPath}48.png`,
      128: `${iconPath}128.png`,
    },
  }).catch((err) => {
    console.log('Icon update skipped:', err.message);
  });
}

// Get current connection status
function getConnectionStatus(): 'disconnected' | 'connecting' | 'connected' | 'error' {
  if (!mcpSocket) return 'disconnected';
  switch (mcpSocket.readyState) {
    case WebSocket.CONNECTING:
      return 'connecting';
    case WebSocket.OPEN:
      return 'connected';
    default:
      return 'disconnected';
  }
}

// Connect to MCP server via WebSocket
async function connectToMCP() {
  if (!mcpToken) {
    // Try to load from storage
    const result = await chrome.storage.local.get(['mcpToken']);
    mcpToken = result.mcpToken || null;
  }

  if (!mcpToken) {
    console.log('No MCP token configured');
    return;
  }

  try {
    // Connect to local MCP server
    mcpSocket = new WebSocket(`ws://localhost:3847?token=${mcpToken}`);

    mcpSocket.onopen = () => {
      console.log('Connected to MCP server');
      broadcastConnectionStatus('connected');

      // Send any queued changes
      if (pendingChanges.length > 0) {
        pendingChanges.forEach((change) => {
          sendToMCP(change);
        });
      }
    };

    mcpSocket.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data) as MCPResponse;
        handleMCPResponse(response);
      } catch (error) {
        console.error('Failed to parse MCP response:', error);
      }
    };

    mcpSocket.onerror = (error) => {
      console.error('MCP WebSocket error:', error);
      broadcastConnectionStatus('error');
    };

    mcpSocket.onclose = () => {
      console.log('MCP connection closed');
      broadcastConnectionStatus('disconnected');

      // Attempt reconnect after delay
      setTimeout(() => {
        if (mcpToken) connectToMCP();
      }, 5000);
    };
  } catch (error) {
    console.error('Failed to connect to MCP:', error);
    broadcastConnectionStatus('error');
  }
}

// Send change to MCP server
async function sendToMCP(change: VisualChange): Promise<boolean> {
  console.log('[VF-SW] sendToMCP called, socket state:', mcpSocket?.readyState);

  if (!mcpSocket || mcpSocket.readyState !== WebSocket.OPEN) {
    console.log('[VF-SW] WebSocket not connected, cannot send');
    return false;
  }

  const request = {
    type: 'get_visual_feedback',
    payload: change,
  };

  try {
    mcpSocket.send(JSON.stringify(request));
    console.log('[VF-SW] Sent to MCP successfully');
    return true;
  } catch (error) {
    console.error('[VF-SW] Failed to send to MCP:', error);
    return false;
  }
}

// Handle MCP response
function handleMCPResponse(response: MCPResponse) {
  if (response.success) {
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'CHANGE_APPLIED',
          data: response.data,
        });
      }
    });
  } else {
    console.error('MCP error:', response.error);
  }
}

// Broadcast connection status to all tabs
function broadcastConnectionStatus(status: string) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CONNECTION_STATUS',
          status,
        }).catch(() => {
          // Tab might not have content script
        });
      }
    });
  });
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    isActive = !isActive;
    updateIcon();

    // Toggle in content script
    chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_ACTIVE',
    });
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Visual Feedback Tool installed');
  updateIcon();
});

// Load token on startup
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get(['mcpToken', 'connectedProject']);
  if (result.mcpToken) {
    mcpToken = result.mcpToken;
    connectedProject = result.connectedProject || null;
    connectToMCP();
  }
});

// Attempt initial connection
connectToMCP();
