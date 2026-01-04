// Visual Feedback Extension - Background Service Worker

interface VisualChange {
  id: string;
  element: {
    selector: string;
    tag: string;
    id: string | null;
    classes: string[];
    path: { tag: string; id: string | null; classes: string[]; index: number; selector: string }[];
    computedStyles: Record<string, string>;
    screenshot: string | null;
  };
  feedback: string;
  timestamp: string;
}

// State - per tab activation, global connection
const activeTabIds = new Set<number>();
let socket: WebSocket | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let serverPort: number | null = null;
let projectPath: string = '/tmp';
let selectedModel: string = 'claude-opus-4-5-20251101';

// Load project path, server port, and model from storage on startup
chrome.storage.local.get(['projectPath', 'serverPort', 'selectedModel']).then((result) => {
  if (result.projectPath) {
    projectPath = result.projectPath;
    console.log('[VF] Loaded project path:', projectPath);
  }
  if (result.serverPort) {
    serverPort = result.serverPort;
    console.log('[VF] Loaded server port:', serverPort);
  }
  if (result.selectedModel) {
    selectedModel = result.selectedModel;
    console.log('[VF] Loaded model:', selectedModel);
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async
});

async function handleMessage(
  message: { type: string; [key: string]: any },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
) {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'GET_STATE':
      sendResponse({
        isActive: tabId ? activeTabIds.has(tabId) : false,
        connectionStatus,
        serverPort,
      });
      break;

    case 'SET_ACTIVE':
      if (tabId !== undefined) {
        if (message.active) {
          activeTabIds.add(tabId);
        } else {
          activeTabIds.delete(tabId);
        }
        updateIcon(tabId, message.active);
      }
      sendResponse({ success: true });
      break;

    case 'TOGGLE_ACTIVE':
      if (tabId !== undefined) {
        const newState = !activeTabIds.has(tabId);
        if (newState) {
          activeTabIds.add(tabId);
        } else {
          activeTabIds.delete(tabId);
        }
        updateIcon(tabId, newState);
        sendResponse({ isActive: newState });
      }
      break;

    case 'CONNECT':
      await connect(message.port);
      sendResponse({ success: connectionStatus === 'connected' });
      break;

    case 'DISCONNECT':
      disconnect();
      sendResponse({ success: true });
      break;

    case 'SET_PROJECT_PATH':
      projectPath = message.path || '/tmp';
      // Persist to storage
      chrome.storage.local.set({ projectPath });
      console.log('[VF] Project path set to:', projectPath);
      sendResponse({ success: true });
      break;

    case 'SET_MODEL':
      selectedModel = message.model || 'claude-opus-4-5-20251101';
      chrome.storage.local.set({ selectedModel });
      console.log('[VF] Model set to:', selectedModel);
      sendResponse({ success: true });
      break;

    case 'SUBMIT_FEEDBACK':
      if (message.change) {
        // Use message projectPath, fall back to stored projectPath
        const path = message.projectPath || projectPath;
        const result = await submitFeedback(message.change, path, message.pageUrl);
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: 'No change data' });
      }
      break;

    case 'CAPTURE_SCREENSHOT':
      if (sender.tab?.id && sender.tab?.windowId !== undefined) {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(
            sender.tab.windowId,
            { format: 'png' }
          );
          sendResponse({ success: true, dataUrl });
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
        }
      } else {
        sendResponse({ success: false, error: 'No tab context' });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

// Update extension icon based on active state
function updateIcon(tabId: number, isActive: boolean) {
  const iconPath = isActive ? '/icons/icon-active' : '/icons/icon';
  chrome.action.setIcon({
    tabId,
    path: {
      16: `${iconPath}16.png`,
      32: `${iconPath}32.png`,
      48: `${iconPath}48.png`,
      128: `${iconPath}128.png`,
    },
  }).catch(() => {});
}

// Connect to server
async function connect(port: number) {
  if (socket?.readyState === WebSocket.OPEN) {
    disconnect();
  }

  connectionStatus = 'connecting';
  serverPort = port;
  // Persist for auto-reconnect
  chrome.storage.local.set({ serverPort: port });

  try {
    socket = new WebSocket(`ws://localhost:${port}`);

    socket.onopen = () => {
      console.log('[VF] Connected to server');
      connectionStatus = 'connected';
      broadcastStatus();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[VF] Server message:', data);

        // Forward task updates to all tabs
        if (data.type === 'task_update' && data.task) {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'TASK_UPDATE',
                  task: data.task,
                }).catch(() => {});
              }
            });
          });
        }
      } catch (e) {}
    };

    socket.onerror = (error) => {
      console.error('[VF] WebSocket error:', error);
      connectionStatus = 'disconnected';
      broadcastStatus();
    };

    socket.onclose = () => {
      console.log('[VF] Disconnected from server');
      connectionStatus = 'disconnected';
      socket = null;
      broadcastStatus();
    };

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      socket!.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket!.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Connection failed')); }, { once: true });
    });
  } catch (error) {
    console.error('[VF] Connection failed:', error);
    connectionStatus = 'disconnected';
    socket = null;
  }
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  connectionStatus = 'disconnected';
  serverPort = null;
  broadcastStatus();
}

// Submit feedback to server
async function submitFeedback(
  change: VisualChange,
  _projectPathArg?: string,
  pageUrl?: string
): Promise<{ success: boolean; error?: string; taskId?: string }> {
  // Auto-reconnect if needed
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.log('[VF] Socket closed, attempting reconnect...');
    if (serverPort) {
      await connect(serverPort);
    } else {
      // Try to get port from discovery
      try {
        const response = await fetch('http://localhost:3848/status');
        if (response.ok) {
          const data = await response.json();
          if (data.wsPort) {
            await connect(data.wsPort);
          }
        }
      } catch (e) {
        return { success: false, error: 'Server not running' };
      }
    }
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return { success: false, error: 'Could not connect to server' };
  }

  try {
    socket.send(JSON.stringify({
      type: 'visual_feedback',
      payload: {
        id: change.id,
        feedback: change.feedback,
        element: {
          tag: change.element.tag,
          id: change.element.id,
          classes: change.element.classes,
          selector: change.element.selector,
          path: change.element.path,
          computedStyles: change.element.computedStyles,
          screenshot: change.element.screenshot,
        },
        projectPath: projectPath || '/tmp',
        pageUrl: pageUrl,
        model: selectedModel,
      },
    }));

    // Return taskId so content script can track completion
    return { success: true, taskId: change.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Broadcast connection status to all tabs
function broadcastStatus() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CONNECTION_STATUS',
          status: connectionStatus,
        }).catch(() => {});
      }
    });
  });
}

// Handle extension icon click - toggle for that tab
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const isActive = activeTabIds.has(tab.id);
  const newState = !isActive;

  if (newState) {
    activeTabIds.add(tab.id);
  } else {
    activeTabIds.delete(tab.id);
  }

  updateIcon(tab.id, newState);

  // Notify content script
  chrome.tabs.sendMessage(tab.id, {
    type: 'SET_ACTIVE',
    active: newState,
  }).catch(() => {});
});

// Clean up when tab is closed or navigates
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabIds.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Reset active state when page reloads
  if (changeInfo.status === 'loading') {
    activeTabIds.delete(tabId);
    updateIcon(tabId, false);
  }
});

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('[VF] Extension installed');
});

// Try to auto-connect on startup
chrome.runtime.onStartup.addListener(async () => {
  try {
    const response = await fetch('http://localhost:3848/status');
    if (response.ok) {
      const data = await response.json();
      if (data.wsPort) {
        await connect(data.wsPort);
      }
    }
  } catch (e) {
    // Server not running
  }
});
