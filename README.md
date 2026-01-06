# Visual Feedback Tool

**Click any element on any website, describe what you want changed, and Claude Code makes it happen.**

A Chrome Extension that lets you visually select elements and send feedback directly to Claude Code, which automatically finds the source file, makes the change, commits, and pushes to GitHub.

---

## Quick Start (5 minutes)

### 1. Clone & Install

```bash
git clone https://github.com/coleschaffer/visual-feedback-tool.git
cd visual-feedback-tool

# Install server dependencies
cd server && npm install && cd ..

# Install extension dependencies
cd extension && npm install && npm run build && cd ..
```

### 2. Start the Server

```bash
cd server && node server.js
```

Or run in background:
```bash
cd server && node server.js > server.log 2>&1 &
```

### 3. Load the Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder

### 4. Use It

1. Click the extension icon in Chrome toolbar
2. Click **Connect** to connect to the server
3. Set your **Project folder** path (the codebase you're working on)
4. Toggle **Enable on current page**
5. Click any element, type what you want changed, hit Enter
6. Claude Code finds the file, makes the change, commits & pushes!

---

## Features

### Core Workflow
- **Click to Select** - Click any element on any website to select it
- **Natural Language Feedback** - Just describe what you want: "make this button blue", "increase padding", "change font to bold"
- **Automatic Execution** - Claude Code finds the source file, makes the change, commits, and pushes

### Smart Element Selection
- **Deep Element Detection** - Select nested elements, SVGs, even disabled buttons
- **Keyboard Navigation** - Arrow keys to navigate parent/child elements
- **Spacebar Selection** - Hover + Space to select hard-to-click elements

### Model Selection
- **Opus 4.5** - Most capable, best for complex changes
- **Sonnet 4.5** - Faster and cheaper, great for simple tweaks
- Switch anytime from the extension popup

### Element Memory (Beads System)
- Tracks changes per element across sessions
- When you modify an element again, Claude sees the history:
  ```
  Previous Changes to This Element:
  - [1/3/2026] ✓ "Make the button blue"
  - [1/3/2026] ✓ "Add hover effect"
  ```
- Provides continuity for iterative design work

### @ Element Reference
- Type `@` in the feedback box to reference another element
- Panel becomes transparent so you can select the reference element
- Click any element to insert its reference (e.g., `[.header-button]`)
- Great for "make this the same color as [.navbar-link]" type feedback
- Press `Esc` to cancel reference mode

### Toast Notifications
- **Working Toast** - White toast with blue spinner, "Working..." text, and element name in top left
- **Success Toast** - Green checkmark with "Success!" when task completes, auto-fades after 2.5s
- **Dismissible** - Click X on working toasts to hide (doesn't stop the task)
- **Persistent** - Toasts stay visible even when tool is toggled off with Ctrl
- **Multiple Tasks** - Multiple toasts stack vertically for concurrent tasks
- **Copy Element Name** - Click element name in panel header to copy selector

### Task History
- View all submitted tasks in the History tab
- See status: processing, complete, or failed
- View Claude's full output log
- **GitHub commit links** - Click to view the exact commit

### LSP Integration
- Claude uses Language Server Protocol features to navigate your codebase
- Go to Definition, Find References, Symbol Search
- Works with TypeScript, JavaScript, Python, and more

---

## Architecture

```
┌─────────────────────────────────┐
│      Chrome Extension           │
│  • Element selection overlay    │
│  • Floating feedback panel      │
│  • Task history viewer          │
└──────────────┬──────────────────┘
               │ WebSocket (port 3847)
               ▼
┌─────────────────────────────────┐
│      Local Server               │
│  • Receives feedback            │
│  • Spawns Claude Code           │
│  • Tracks tasks & beads         │
└──────────────┬──────────────────┘
               │ CLI
               ▼
┌─────────────────────────────────┐
│      Claude Code                │
│  • Finds source files           │
│  • Makes code changes           │
│  • Commits & pushes to GitHub   │
└─────────────────────────────────┘
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl` | Toggle enable/disable (works anywhere) |
| `Click` | Select element under cursor |
| `Space` | Select currently hovered element |
| `↑` Arrow Up | Navigate to parent element |
| `↓` Arrow Down | Navigate to child element |
| `←` Arrow Left | Navigate to previous sibling |
| `→` Arrow Right | Navigate to next sibling |
| `@` | Enter element reference mode (in feedback box) |
| `Esc` | Deselect / Close panel / Cancel reference |
| `Enter` | Submit feedback |
| `Option+Enter` | New line in feedback |

---

## Configuration

### Project Folder
Set this to the root of your codebase. Claude Code will run in this directory and search for source files here.

### Model Selection
- **Opus 4.5** (`claude-opus-4-5-20251101`) - Best quality, uses more API credits
- **Sonnet 4.5** (`claude-sonnet-4-5-20241022`) - Faster, cheaper, good for simple changes

### Server Ports
- WebSocket: `3847` (extension ↔ server communication)
- HTTP: `3848` (status & task history API)

---

## File Structure

```
visual-feedback-tool/
├── extension/           # Chrome extension
│   ├── src/
│   │   ├── background/  # Service worker
│   │   ├── content/     # DOM overlay & selection
│   │   ├── popup/       # Extension popup UI
│   │   └── shared/      # Shared types & state
│   └── dist/            # Built extension (load this in Chrome)
├── server/              # Local WebSocket server
│   └── server.js        # Main server file
└── mcp-server/          # MCP integration (optional)
```

---

## Run Server on Startup (macOS)

Create a Launch Agent to run the server automatically:

```bash
# Create the plist
cat > ~/Library/LaunchAgents/com.visualfeedback.server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.visualfeedback.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/visual-feedback-tool/server/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/vf-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/vf-server.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

# Update the path in the plist
sed -i '' "s|/path/to/visual-feedback-tool|$(pwd)|g" ~/Library/LaunchAgents/com.visualfeedback.server.plist

# Load it
launchctl load ~/Library/LaunchAgents/com.visualfeedback.server.plist
```

---

## Development

### Extension Development
```bash
cd extension
npm install
npm run dev    # Watch mode - rebuilds on changes
npm run build  # Production build
```

### Server Development
```bash
cd server
npm install
node server.js
```

---

## Troubleshooting

### Extension won't connect
- Make sure the server is running: `curl http://localhost:3848/status`
- Check the server log: `cat /tmp/vf-server.log`

### Can't select certain elements
- Try hovering and pressing `Space` instead of clicking
- Use `↑`/`↓` arrows to navigate to parent/child elements
- Some elements may be in iframes (not yet supported)

### Changes not appearing in GitHub
- Make sure your project folder has a git remote configured
- Check Claude's output in the History tab for errors

---

## Requirements

- **Node.js** 18+
- **Chrome** browser
- **Claude Code** CLI installed (`~/.local/bin/claude`)
- **Git** configured with GitHub access

---

## License

MIT
