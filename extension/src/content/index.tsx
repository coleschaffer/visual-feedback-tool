import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Create container for the overlay
function createOverlayContainer(): HTMLElement {
  const existingContainer = document.getElementById('visual-feedback-overlay');
  if (existingContainer) {
    return existingContainer;
  }

  const container = document.createElement('div');
  container.id = 'visual-feedback-overlay';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  `;
  document.body.appendChild(container);

  // Create shadow root for style isolation
  const shadow = container.attachShadow({ mode: 'open' });

  // Inject styles into shadow DOM
  const styleSheet = document.createElement('style');
  styleSheet.textContent = getOverlayStyles();
  shadow.appendChild(styleSheet);

  // Create React mount point inside shadow
  const mountPoint = document.createElement('div');
  mountPoint.id = 'visual-feedback-root';
  shadow.appendChild(mountPoint);

  return mountPoint;
}

function getOverlayStyles(): string {
  return `
    * {
      box-sizing: border-box;
    }

    .vf-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .vf-highlight {
      position: absolute;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.1);
      pointer-events: none;
      transition: all 0.1s ease-out;
    }

    .vf-highlight--hover {
      border-color: #60a5fa;
      background: rgba(96, 165, 250, 0.08);
    }

    .vf-highlight--selected {
      border-color: #1d4ed8;
      border-width: 2px;
      background: rgba(29, 78, 216, 0.12);
    }

    .vf-dimension-badge {
      position: absolute;
      top: -24px;
      left: 0;
      background: #3b82f6;
      color: white;
      font-size: 11px;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }

    .vf-measure-line {
      position: absolute;
      background: #f97316;
      pointer-events: none;
    }

    .vf-measure-line--horizontal {
      height: 1px;
    }

    .vf-measure-line--vertical {
      width: 1px;
    }

    .vf-measure-label {
      position: absolute;
      background: #ea580c;
      color: white;
      font-size: 10px;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
    }

    .vf-breadcrumb-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 4px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      pointer-events: auto;
      z-index: 2147483646;
    }

    .vf-breadcrumb-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      color: #6b7280;
      transition: all 0.15s ease;
    }

    .vf-breadcrumb-item:hover {
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
    }

    .vf-breadcrumb-item--active {
      background: #3b82f6;
      color: white;
    }

    .vf-breadcrumb-separator {
      color: #d1d5db;
      font-size: 10px;
    }

    .vf-panel {
      position: fixed;
      width: 420px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(16px);
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.3);
      pointer-events: auto;
      overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .vf-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      cursor: move;
    }

    .vf-panel-title {
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
    }

    .vf-panel-close {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      color: #6b7280;
      transition: all 0.15s ease;
    }

    .vf-panel-close:hover {
      background: rgba(0, 0, 0, 0.05);
      color: #1f2937;
    }

    .vf-panel-content {
      display: flex;
      min-height: 200px;
    }

    .vf-panel-visual {
      flex: 1;
      padding: 16px;
      border-right: 1px solid rgba(0, 0, 0, 0.08);
    }

    .vf-panel-chat {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }

    .vf-box-model {
      width: 100%;
      aspect-ratio: 4/3;
      position: relative;
      font-size: 10px;
    }

    .vf-box-margin {
      position: absolute;
      inset: 0;
      background: rgba(249, 115, 22, 0.15);
      border: 1px dashed #f97316;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .vf-box-border {
      position: absolute;
      inset: 20%;
      background: rgba(251, 191, 36, 0.15);
      border: 1px solid #fbbf24;
    }

    .vf-box-padding {
      position: absolute;
      inset: 30%;
      background: rgba(34, 197, 94, 0.15);
      border: 1px dashed #22c55e;
    }

    .vf-box-content {
      position: absolute;
      inset: 40%;
      background: rgba(59, 130, 246, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #3b82f6;
    }

    .vf-box-value {
      position: absolute;
      background: white;
      padding: 1px 4px;
      border-radius: 2px;
      font-size: 9px;
      color: #374151;
    }

    .vf-chat-input {
      flex: 1;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      resize: none;
      outline: none;
      min-height: 80px;
      font-family: inherit;
      background: #ffffff;
      color: #1f2937;
    }

    .vf-chat-input::placeholder {
      color: #9ca3af;
    }

    .vf-chat-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .vf-confirm-btn {
      margin-top: 12px;
      width: 100%;
      padding: 10px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .vf-confirm-btn:hover {
      background: #2563eb;
    }

    .vf-confirm-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .vf-confirm-btn--working {
      background: #6b7280;
    }

    .vf-status {
      margin-top: 8px;
      font-size: 11px;
      color: #6b7280;
      text-align: center;
    }

    .vf-status--success {
      color: #22c55e;
    }

    .vf-resize-handle {
      position: absolute;
      width: 10px;
      height: 10px;
      background: #3b82f6;
      border: 2px solid white;
      border-radius: 50%;
      pointer-events: auto;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .vf-resize-handle--nw { top: -5px; left: -5px; cursor: nw-resize; }
    .vf-resize-handle--n { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
    .vf-resize-handle--ne { top: -5px; right: -5px; cursor: ne-resize; }
    .vf-resize-handle--e { top: 50%; right: -5px; transform: translateY(-50%); cursor: e-resize; }
    .vf-resize-handle--se { bottom: -5px; right: -5px; cursor: se-resize; }
    .vf-resize-handle--s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
    .vf-resize-handle--sw { bottom: -5px; left: -5px; cursor: sw-resize; }
    .vf-resize-handle--w { top: 50%; left: -5px; transform: translateY(-50%); cursor: w-resize; }

    .vf-color-picker {
      margin-top: 12px;
    }

    .vf-color-gradient {
      width: 100%;
      height: 120px;
      border-radius: 8px;
      position: relative;
      cursor: crosshair;
    }

    .vf-color-hue {
      width: 100%;
      height: 16px;
      margin-top: 8px;
      border-radius: 8px;
      background: linear-gradient(to right,
        #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
      cursor: pointer;
    }

    .vf-element-info {
      margin-bottom: 12px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.03);
      border-radius: 6px;
      font-size: 11px;
      color: #6b7280;
    }

    .vf-element-info-tag {
      font-weight: 600;
      color: #1f2937;
    }

    /* Spinner animation for element overlay */
    @keyframes vf-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .vf-element-overlay {
      font-family: system-ui, -apple-system, sans-serif;
    }
  `;
}

// Initialize the overlay
function init() {
  console.log('[VF] Visual Feedback Tool content script initializing...');
  const mountPoint = createOverlayContainer();
  const root = createRoot(mountPoint);
  root.render(<App />);
  console.log('[VF] Visual Feedback Tool content script mounted');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
