import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { exec } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { generateToken } from './auth/tokenGenerator.js';
import { ChangeQueue } from './store/changeQueue.js';

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Server registry for auto-discovery
const REGISTRY_DIR = join(homedir(), '.visual-feedback');
const REGISTRY_FILE = join(REGISTRY_DIR, 'servers.json');

interface ServerEntry {
  token: string;
  projectPath: string;
  projectName: string;
  port: number;
  pid: number;
  startedAt: string;
}

function registerServer(token: string, port: number) {
  try {
    mkdirSync(REGISTRY_DIR, { recursive: true });

    let servers: Record<string, ServerEntry> = {};
    if (existsSync(REGISTRY_FILE)) {
      try {
        servers = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
      } catch {
        servers = {};
      }
    }

    // Clean up stale entries (servers that are no longer running)
    for (const [pid, entry] of Object.entries(servers)) {
      try {
        process.kill(parseInt(pid), 0); // Check if process exists
      } catch {
        delete servers[pid]; // Process doesn't exist, remove entry
      }
    }

    const projectPath = process.cwd();
    servers[process.pid.toString()] = {
      token,
      projectPath,
      projectName: basename(projectPath),
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };

    writeFileSync(REGISTRY_FILE, JSON.stringify(servers, null, 2));
    console.error(`Registered server for project: ${basename(projectPath)}`);
  } catch (error) {
    console.error('Failed to register server:', error);
  }
}

function unregisterServer() {
  try {
    if (existsSync(REGISTRY_FILE)) {
      const servers = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
      delete servers[process.pid.toString()];
      writeFileSync(REGISTRY_FILE, JSON.stringify(servers, null, 2));
    }
  } catch (error) {
    console.error('Failed to unregister server:', error);
  }
}

// Clean up on exit
process.on('exit', unregisterServer);
process.on('SIGINT', () => { unregisterServer(); process.exit(); });
process.on('SIGTERM', () => { unregisterServer(); process.exit(); });

// Auto-submit feedback to the running Claude Code terminal using AppleScript
function autoSubmitToTerminal(feedback: string, selector: string, classes: string[], tag: string) {
  // Build element representation with full class names
  const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
  const elementHtml = `<${tag}${classAttr}>`;

  const message = `Add this feedback to ToDo: "${feedback}" on element ${elementHtml}`;

  console.error('📤 Submitting to Claude Code terminal...');
  console.error(`   Message: ${message}`);

  // Use AppleScript to type into Terminal and press Enter
  const script = `
    tell application "Terminal"
      activate
      delay 0.5
      tell application "System Events"
        keystroke "${message.replace(/"/g, '\\"').replace(/\n/g, ' ')}"
        delay 0.3
        key code 36
      end tell
    end tell
  `;

  exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Failed to submit to terminal:', error.message);
      // Try iTerm2 as fallback
      const itermScript = `
        tell application "iTerm"
          activate
          delay 0.3
          tell current session of current window
            write text "${message.replace(/"/g, '\\"')}"
          end tell
        end tell
      `;
      exec(`osascript -e '${itermScript.replace(/'/g, "'\"'\"'")}'`, (err2) => {
        if (err2) {
          console.error('❌ iTerm2 fallback also failed:', err2.message);
        } else {
          console.error('✅ Submitted via iTerm2');
        }
      });
    } else {
      console.error('✅ Submitted to Terminal');
    }
  });
}

// Auto-apply changes using a headless Claude process (deprecated)
function autoApplyChanges(changeId: string, feedback: string, selector: string) {
  // Single line prompt to avoid shell escaping issues
  const prompt = `VISUAL FEEDBACK: "${feedback}" on element ${selector}. Use get_visual_feedback tool, find the source file, make the edit, then call mark_change_applied with changeId "${changeId}". Do not ask for confirmation.`;
  const claudePath = process.env.HOME + '/.local/bin/claude';
  const workDir = process.cwd();

  console.error('🔄 Spawning Claude to apply changes...');
  console.error(`   Working dir: ${workDir}`);
  console.error(`   Feedback: "${feedback}"`);
  console.error(`   Selector: ${selector}`);

  // Use spawn with args array to properly handle the prompt
  const { spawn } = require('child_process');
  const child = spawn(claudePath, ['-p', prompt, '--dangerously-skip-permissions'], {
    cwd: workDir,
    env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data: Buffer) => {
    console.error('[Claude]', data.toString().trim());
  });

  child.stderr?.on('data', (data: Buffer) => {
    console.error('[Claude stderr]', data.toString().trim());
  });

  child.on('close', (code: number) => {
    if (code === 0) {
      console.error('✅ Claude process completed successfully');
    } else {
      console.error(`❌ Claude process exited with code ${code}`);
      if (connectedClient?.readyState === WebSocket.OPEN) {
        connectedClient.send(JSON.stringify({
          type: 'AUTO_APPLY_FAILED',
          changeId,
          error: `Process exited with code ${code}`,
        }));
      }
    }
  });

  child.on('error', (error: Error) => {
    console.error('❌ Failed to spawn Claude:', error.message);
    if (connectedClient?.readyState === WebSocket.OPEN) {
      connectedClient.send(JSON.stringify({
        type: 'AUTO_APPLY_FAILED',
        changeId,
        error: error.message,
      }));
    }
  });
}

// Types
interface VisualChange {
  id: string;
  element: {
    selector: string;
    tag: string;
    id: string | null;
    classes: string[];
    computedStyles: Record<string, string>;
    sourceHint: string | null;
    smartSummary: string | null;
    screenshot: string | null;
  };
  feedback: string;
  visualAdjustments: Record<string, string>;
  cssFramework: string;
  originalUnits: Record<string, string>;
  timestamp: string;
  status: 'draft' | 'staged' | 'confirmed' | 'applied' | 'failed';
}

// Initialize change queue
const changeQueue = new ChangeQueue();

// Generate and display token on startup
const TOKEN = generateToken();
console.error(`\n${'='.repeat(60)}`);
console.error('Visual Feedback MCP Server Started');
console.error(`${'='.repeat(60)}`);
console.error(`\nConnection Token: ${TOKEN}`);
console.error('\nEnter this token in the Visual Feedback extension to connect.');
console.error(`${'='.repeat(60)}\n`);

// WebSocket server for extension communication
// Only start if we're the primary instance (not spawned by claude -p)
let wss: WebSocketServer | null = null;
let connectedClient: WebSocket | null = null;

function startWebSocketServer() {
  try {
    wss = new WebSocketServer({ port: 3847 });

    wss.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error('WebSocket port 3847 already in use (another MCP instance running)');
        wss = null;
      } else {
        console.error('WebSocket error:', error);
      }
    });

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '', 'http://localhost');
      const token = url.searchParams.get('token');

      if (token !== TOKEN) {
        console.error('Connection rejected: Invalid token');
        ws.close(1008, 'Invalid token');
        return;
      }

      console.error('Extension connected');
      connectedClient = ws;

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleExtensionMessage(message, ws);
        } catch (error) {
          console.error('Failed to parse extension message:', error);
        }
      });

      ws.on('close', () => {
        console.error('Extension disconnected');
        if (connectedClient === ws) {
          connectedClient = null;
        }
      });
    });

    console.error('WebSocket server started on port 3847');

    // Register for auto-discovery
    registerServer(TOKEN, 3847);
  } catch (error) {
    console.error('Failed to start WebSocket server:', error);
  }
}

// Start WebSocket server
startWebSocketServer();

// HTTP server for discovery (serves list of available servers)
const httpServer = createServer((req, res) => {
  // CORS headers for extension access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/servers' && req.method === 'GET') {
    try {
      let servers: Record<string, ServerEntry> = {};
      if (existsSync(REGISTRY_FILE)) {
        servers = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));

        // Filter out stale servers
        for (const [pid, entry] of Object.entries(servers)) {
          try {
            process.kill(parseInt(pid), 0);
          } catch {
            delete servers[pid];
          }
        }
        // Update file with cleaned entries
        writeFileSync(REGISTRY_FILE, JSON.stringify(servers, null, 2));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.values(servers)));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read servers' }));
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

httpServer.listen(3848, () => {
  console.error('Discovery server started on port 3848');
});

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error('Discovery port 3848 already in use');
  }
});

// Handle messages from extension
function handleExtensionMessage(message: { type: string; payload?: VisualChange }, ws: WebSocket) {
  if (message.type === 'get_visual_feedback' && message.payload) {
    changeQueue.add(message.payload);

    console.error(`\n${'═'.repeat(50)}`);
    console.error('📝 VISUAL FEEDBACK RECEIVED');
    console.error(`${'═'.repeat(50)}`);
    console.error(`Element: ${message.payload.element.selector}`);
    console.error(`Feedback: "${message.payload.feedback}"`);
    console.error(`${'═'.repeat(50)}\n`);

    // Acknowledge receipt
    ws.send(JSON.stringify({
      success: true,
      changeId: message.payload.id,
    }));

    // Auto-submit to the running Claude Code terminal
    setTimeout(() => {
      autoSubmitToTerminal(
        message.payload!.feedback,
        message.payload!.element.selector,
        message.payload!.element.classes || [],
        message.payload!.element.tag || 'div'
      );
    }, 500);
  }
}

// MCP Server
const server = new Server(
  {
    name: 'visual-feedback-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_visual_feedback',
        description: `Get pending visual feedback from the browser extension.
Returns a list of visual changes made by the user including:
- Element information (selector, tag, classes, computed styles)
- User's text feedback describing what they want changed
- Visual adjustments they made (resize, spacing, colors)
- Element screenshot
- Detected CSS framework (Tailwind, CSS Modules, etc.)

Call this tool when you want to see what visual changes the user has requested.`,
        inputSchema: {
          type: 'object',
          properties: {
            includeApplied: {
              type: 'boolean',
              description: 'Include already applied changes in the response',
              default: false,
            },
          },
        },
      },
      {
        name: 'mark_change_applied',
        description: `Mark a visual change as successfully applied.
Call this after you have made the code changes to implement the user's visual feedback.`,
        inputSchema: {
          type: 'object',
          properties: {
            changeId: {
              type: 'string',
              description: 'The ID of the change to mark as applied',
            },
          },
          required: ['changeId'],
        },
      },
      {
        name: 'mark_change_failed',
        description: `Mark a visual change as failed to apply.
Call this if you were unable to implement the user's visual feedback.`,
        inputSchema: {
          type: 'object',
          properties: {
            changeId: {
              type: 'string',
              description: 'The ID of the change to mark as failed',
            },
            reason: {
              type: 'string',
              description: 'Reason for the failure',
            },
          },
          required: ['changeId'],
        },
      },
      {
        name: 'get_change_details',
        description: `Get detailed information about a specific visual change.`,
        inputSchema: {
          type: 'object',
          properties: {
            changeId: {
              type: 'string',
              description: 'The ID of the change to get details for',
            },
          },
          required: ['changeId'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_visual_feedback': {
      const includeApplied = (args as { includeApplied?: boolean })?.includeApplied ?? false;
      const changes = changeQueue.getPending(includeApplied);

      if (changes.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No pending visual feedback. The user has not made any visual changes in the extension yet.',
            },
          ],
        };
      }

      const formattedChanges = changes.map((change) => ({
        id: change.id,
        element: {
          selector: change.element.selector,
          tag: change.element.tag,
          classes: change.element.classes,
          currentStyles: change.element.computedStyles,
          sourceFile: change.element.sourceHint,
          description: change.element.smartSummary,
        },
        userFeedback: change.feedback,
        visualChanges: change.visualAdjustments,
        cssFramework: change.cssFramework,
        timestamp: change.timestamp,
        status: change.status,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${changes.length} pending visual change(s):\n\n${JSON.stringify(formattedChanges, null, 2)}`,
          },
        ],
      };
    }

    case 'mark_change_applied': {
      const { changeId } = args as { changeId: string };
      const success = changeQueue.markApplied(changeId);

      if (success) {
        // Notify extension
        try {
          if (connectedClient?.readyState === WebSocket.OPEN) {
            connectedClient.send(JSON.stringify({
              type: 'CHANGE_APPLIED',
              changeId,
            }));
          }
        } catch (e) {
          console.error('Failed to notify extension:', e);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Change ${changeId} marked as applied.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Change ${changeId} not found.`,
          },
        ],
      };
    }

    case 'mark_change_failed': {
      const { changeId, reason } = args as { changeId: string; reason?: string };
      const success = changeQueue.markFailed(changeId, reason);

      // Notify extension for auto-retry
      try {
        if (connectedClient?.readyState === WebSocket.OPEN) {
          connectedClient.send(JSON.stringify({
            type: 'CHANGE_FAILED',
            changeId,
            reason,
          }));
        }
      } catch (e) {
        console.error('Failed to notify extension:', e);
      }

      return {
        content: [
          {
            type: 'text',
            text: success
              ? `Change ${changeId} marked as failed. The extension may auto-retry.`
              : `Change ${changeId} not found.`,
          },
        ],
      };
    }

    case 'get_change_details': {
      const { changeId } = args as { changeId: string };
      const change = changeQueue.get(changeId);

      if (!change) {
        return {
          content: [
            {
              type: 'text',
              text: `Change ${changeId} not found.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Change details:\n\n${JSON.stringify(change, null, 2)}`,
          },
        ],
      };
    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
  }
});

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
