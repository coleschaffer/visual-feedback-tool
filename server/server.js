#!/usr/bin/env node

const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WS_PORT = 3847;
const HTTP_PORT = 3848;
const CLAUDE_PATH = os.homedir() + '/.local/bin/claude';
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'visual-feedback-screenshots');
const TASKS_FILE = path.join(os.homedir(), '.visual-feedback-server', 'tasks.json');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Beads-style element memory system
// Stores context about previous changes to elements for continuity

function getBeadsDir(projectPath) {
  return path.join(projectPath, '.beads', 'elements');
}

function ensureBeadsDir(projectPath) {
  const beadsDir = getBeadsDir(projectPath);
  if (!fs.existsSync(beadsDir)) {
    fs.mkdirSync(beadsDir, { recursive: true });
  }
  return beadsDir;
}

// Generate a stable ID for an element based on its properties
function generateElementId(element) {
  const key = [
    element.tag,
    element.id || '',
    (element.classes || []).sort().join('.'),
    element.selector || ''
  ].join('|');
  // Simple hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'el-' + Math.abs(hash).toString(16).slice(0, 8);
}

// Load bead history for an element
function loadElementBead(projectPath, element) {
  const beadsDir = getBeadsDir(projectPath);
  const elementId = generateElementId(element);
  const beadFile = path.join(beadsDir, `${elementId}.json`);

  if (fs.existsSync(beadFile)) {
    try {
      return JSON.parse(fs.readFileSync(beadFile, 'utf8'));
    } catch (err) {
      console.error('Failed to load bead:', err.message);
    }
  }
  return null;
}

// Save bead after a change
function saveElementBead(projectPath, element, feedback, taskId, success) {
  const beadsDir = ensureBeadsDir(projectPath);
  const elementId = generateElementId(element);
  const beadFile = path.join(beadsDir, `${elementId}.json`);

  let bead = loadElementBead(projectPath, element) || {
    id: elementId,
    element: {
      tag: element.tag,
      id: element.id,
      classes: element.classes,
      selector: element.selector
    },
    changes: []
  };

  // Add new change to history (keep last 10)
  bead.changes.push({
    taskId,
    feedback,
    timestamp: new Date().toISOString(),
    success
  });
  if (bead.changes.length > 10) {
    bead.changes = bead.changes.slice(-10);
  }

  try {
    fs.writeFileSync(beadFile, JSON.stringify(bead, null, 2));
  } catch (err) {
    console.error('Failed to save bead:', err.message);
  }
}

// Format bead history for prompt context
function formatBeadContext(bead) {
  if (!bead || !bead.changes || bead.changes.length === 0) {
    return null;
  }

  const lines = [
    `## Previous Changes to This Element`,
    `This element has been modified ${bead.changes.length} time(s) before. Recent history:`
  ];

  // Show last 3 changes
  const recentChanges = bead.changes.slice(-3);
  for (const change of recentChanges) {
    const date = new Date(change.timestamp).toLocaleDateString();
    const status = change.success ? '✓' : '✗';
    lines.push(`- [${date}] ${status} "${change.feedback}"`);
  }

  lines.push('', 'Consider this context when making your changes.');
  return lines.join('\n');
}

console.log('Starting Visual Feedback Server...');

// Task storage with file persistence
const tasks = new Map();
const MAX_TASKS = 50;

// Load tasks from file on startup
function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      for (const task of data) {
        tasks.set(task.id, task);
      }
      console.log(`Loaded ${tasks.size} tasks from disk`);
    }
  } catch (err) {
    console.error('Failed to load tasks:', err.message);
  }
}

// Save tasks to file
function saveTasks() {
  try {
    const data = Array.from(tasks.values());
    fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save tasks:', err.message);
  }
}

// Load existing tasks
loadTasks();

function addTask(task) {
  tasks.set(task.id, task);
  if (tasks.size > MAX_TASKS) {
    const oldest = Array.from(tasks.keys())[0];
    tasks.delete(oldest);
  }
  saveTasks();
}

// Broadcast task updates to all connected clients
function broadcastTaskUpdate(task) {
  const message = JSON.stringify({ type: 'task_update', task });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// Build rich prompt with all context
function buildPrompt(feedback, element, pageUrl, beadContext) {
  const lines = [
    `# Visual Feedback Request`,
    ``,
    `## User Feedback`,
    `"${feedback}"`,
    ``,
    `## Target Element`,
    `- **Tag:** <${element.tag}>`,
    `- **Selector:** ${element.selector || 'N/A'}`,
  ];

  if (element.id) {
    lines.push(`- **ID:** #${element.id}`);
  }

  if (element.classes && element.classes.length > 0) {
    lines.push(`- **Classes:** .${element.classes.join(', .')}`);
  }

  // Add element path (breadcrumb)
  if (element.path && element.path.length > 0) {
    const pathStr = element.path.map(p => p.selector || p.tag).join(' > ');
    lines.push(`- **DOM Path:** ${pathStr}`);
  }

  // Add computed styles if available
  if (element.computedStyles) {
    const styles = element.computedStyles;
    lines.push(``, `## Current Styles`);
    if (styles.width) lines.push(`- Width: ${styles.width}`);
    if (styles.height) lines.push(`- Height: ${styles.height}`);
    if (styles.backgroundColor) lines.push(`- Background: ${styles.backgroundColor}`);
    if (styles.color) lines.push(`- Text Color: ${styles.color}`);
    if (styles.fontSize) lines.push(`- Font Size: ${styles.fontSize}`);
    if (styles.display) lines.push(`- Display: ${styles.display}`);
    if (styles.position) lines.push(`- Position: ${styles.position}`);
  }

  if (pageUrl) {
    lines.push(``, `## Page URL`, pageUrl);
  }

  // Add bead context if available (previous changes to this element)
  if (beadContext) {
    lines.push(``, beadContext);
  }

  lines.push(
    ``,
    `## Instructions`,
    `1. Use Language Server Protocol (LSP) features to efficiently navigate the codebase:`,
    `   - Use "Go to Definition" to find where components/elements are defined`,
    `   - Use "Find References" to locate all usages`,
    `   - Use symbol search to quickly find relevant files`,
    `2. Find the source file containing this element using the selector, classes, and DOM path as hints`,
    `3. Make the requested change`,
    `4. Commit the change with a descriptive message`,
    `5. Push to GitHub`,
    `6. **IMPORTANT**: After pushing, output the commit hash in this exact format:`,
    `   COMMIT_HASH: <full-40-character-hash>`,
    `   This is required for tracking purposes.`
  );

  return lines.join('\n');
}

// Save screenshot and return path
function saveScreenshot(base64Data, taskId) {
  if (!base64Data) return null;

  try {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const filePath = path.join(SCREENSHOT_DIR, `${taskId}.png`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error('Failed to save screenshot:', err.message);
    return null;
  }
}

// Simple HTTP server for status and task history
const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'running', wsPort: WS_PORT }));
  } else if (req.url === '/tasks') {
    const taskList = Array.from(tasks.values()).reverse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(taskList));
  } else if (req.url.startsWith('/tasks/') && req.url.endsWith('/log')) {
    const id = req.url.replace('/tasks/', '').replace('/log', '');
    const task = tasks.get(id);
    if (task) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ log: task.log || '' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`HTTP server on port ${HTTP_PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('Received:', msg.type);

      if (msg.type === 'visual_feedback') {
        const { id, feedback, element, projectPath, pageUrl, model } = msg.payload;
        const taskId = id || Date.now().toString();
        const selectedModel = model || 'claude-opus-4-5-20251101';

        console.log(`\nFeedback: "${feedback}"`);
        console.log(`Project: ${projectPath}`);
        console.log(`Model: ${selectedModel}`);
        console.log(`Element: <${element.tag}> ${element.selector || ''}`);
        if (pageUrl) console.log(`Page: ${pageUrl}`);

        // Create task record
        const task = {
          id: taskId,
          feedback,
          element: {
            tag: element.tag,
            classes: element.classes || [],
            selector: element.selector,
            id: element.id
          },
          projectPath,
          pageUrl,
          model: selectedModel,
          status: 'processing',
          startedAt: new Date().toISOString(),
          completedAt: null,
          log: '',
          exitCode: null,
          commitHash: null,
          commitUrl: null
        };
        addTask(task);
        broadcastTaskUpdate(task);

        // Load bead context for this element (previous changes)
        const bead = loadElementBead(projectPath, element);
        const beadContext = formatBeadContext(bead);
        if (beadContext) {
          console.log('Found previous changes to this element');
        }

        // Build rich prompt
        const prompt = buildPrompt(feedback, element, pageUrl, beadContext);

        console.log('\n--- Prompt ---');
        console.log(prompt);
        console.log('--- End Prompt ---\n');

        console.log(`Spawning Claude (${selectedModel})...`);

        // Build args (note: Claude CLI doesn't support --image flag yet)
        const args = [
          '--model', selectedModel,
          '-p', prompt,
          '--dangerously-skip-permissions'
        ];

        const child = spawn(CLAUDE_PATH, args, {
          cwd: projectPath,
          env: {
            HOME: os.homedir(),
            PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + os.homedir() + '/.local/bin',
            USER: process.env.USER,
            TERM: 'xterm-256color',
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.on('data', (d) => {
          const text = d.toString();
          process.stdout.write(text);
          task.log += text;
        });

        child.stderr.on('data', (d) => {
          const text = d.toString();
          process.stderr.write(text);
          task.log += text;
        });

        child.on('error', (err) => {
          console.log('\nSpawn error:', err.message);
          task.status = 'failed';
          task.completedAt = new Date().toISOString();
          task.log += `\nError: ${err.message}`;
          saveTasks();
          broadcastTaskUpdate(task);
          ws.send(JSON.stringify({ success: false, error: err.message, taskId: task.id }));
        });

        child.on('close', (code) => {
          console.log(`\nClaude exited with code ${code}`);
          task.status = code === 0 ? 'complete' : 'failed';
          task.completedAt = new Date().toISOString();
          task.exitCode = code;

          // Try to extract commit hash and GitHub URL from log
          // Look for our explicit format first, then fall back to common git output patterns
          const commitMatch = task.log.match(/COMMIT_HASH:\s*([a-f0-9]{40})/i) ||
                              task.log.match(/\[([a-f0-9]{7,40})\]/i) ||
                              task.log.match(/commit\s+([a-f0-9]{7,40})/i);
          if (commitMatch) {
            task.commitHash = commitMatch[1];
            // Try to get GitHub remote URL
            const remoteMatch = task.log.match(/github\.com[:/]([^/]+\/[^/\s.]+)/i);
            if (remoteMatch) {
              const repo = remoteMatch[1].replace(/\.git$/, '');
              task.commitUrl = `https://github.com/${repo}/commit/${task.commitHash}`;
            }
          }

          // Save bead for element context tracking
          saveElementBead(projectPath, element, feedback, taskId, code === 0);

          saveTasks();
          broadcastTaskUpdate(task);
          ws.send(JSON.stringify({ success: code === 0, taskId: task.id }));
        });

        console.log('Claude process started, PID:', child.pid);
        ws.send(JSON.stringify({ type: 'task_started', taskId: task.id }));

      } else if (msg.type === 'get_tasks') {
        const taskList = Array.from(tasks.values()).reverse();
        ws.send(JSON.stringify({ type: 'tasks', tasks: taskList }));
      }
    } catch (err) {
      console.log('Error:', err.message);
      ws.send(JSON.stringify({ success: false, error: err.message }));
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
  ws.send(JSON.stringify({ type: 'ready' }));
});

console.log(`WebSocket server on port ${WS_PORT}`);
console.log('Ready!\n');
