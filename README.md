# Visual Feedback Tool

A Chrome Extension + MCP Server that lets you visually edit web elements and send feedback directly to Claude Code.

## Features

- **Click to Select**: Click any element on any website to select it
- **Visual Controls**: Box model diagram, resize handles, color picker
- **Measure Distances**: Always-visible distance measurements between elements
- **Breadcrumb Navigation**: Fixed bar at top showing element path
- **Live Preview**: See changes applied in real-time before confirming
- **Claude Code Integration**: Changes sent directly to Claude Code via MCP

## Architecture

```
┌─────────────────────────────┐
│     Chrome Extension        │
│  - DOM overlay & controls   │
│  - Element selection        │
│  - Visual adjustments       │
└─────────────┬───────────────┘
              │ WebSocket
              ▼
┌─────────────────────────────┐
│      MCP Server             │
│  - Token authentication     │
│  - Change queue             │
│  - MCP tools                │
└─────────────┬───────────────┘
              │ stdio
              ▼
┌─────────────────────────────┐
│      Claude Code            │
│  - Receives visual feedback │
│  - Applies changes to code  │
└─────────────────────────────┘
```

## Quick Start

### 1. Install MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Add to Claude Code config

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "visual-feedback": {
      "command": "node",
      "args": ["/path/to/visual-feedback-tool/mcp-server/dist/index.js"]
    }
  }
}
```

### 3. Build Extension

```bash
cd extension
npm install
npm run build
```

### 4. Generate Icons

```bash
cd dist/icons
magick -size 16x16 xc:'#3b82f6' icon16.png
magick -size 32x32 xc:'#3b82f6' icon32.png
magick -size 48x48 xc:'#3b82f6' icon48.png
magick -size 128x128 xc:'#3b82f6' icon128.png
magick -size 16x16 xc:'#22c55e' icon-active16.png
magick -size 32x32 xc:'#22c55e' icon-active32.png
magick -size 48x48 xc:'#22c55e' icon-active48.png
magick -size 128x128 xc:'#22c55e' icon-active128.png
```

### 5. Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/dist` folder

### 6. Connect

1. Start Claude Code (MCP server starts automatically)
2. Copy the token displayed in the terminal
3. Click the extension icon and enter the token

## Usage

1. **Enable**: Click the extension icon or use the popup toggle
2. **Hover**: Move over elements to see highlights and measurements
3. **Select**: Click an element to select it
4. **Adjust**: Use visual controls or type feedback
5. **Confirm**: Click "Confirm & Send to Claude"

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Deselect element / Disable extension |
| `Cmd+Z` | Undo visual changes |
| `Cmd+Enter` | Confirm and send to Claude |

## MCP Tools

The MCP server provides these tools to Claude Code:

- `get_visual_feedback` - Get pending visual changes
- `mark_change_applied` - Mark a change as applied
- `mark_change_failed` - Mark a change as failed (triggers retry)
- `get_change_details` - Get details for a specific change

## Development

### Extension

```bash
cd extension
npm install
npm run dev   # Watch mode
npm run build # Production build
```

### MCP Server

```bash
cd mcp-server
npm install
npm run dev   # Watch mode with tsx
npm run build # Compile TypeScript
```

## License

MIT
