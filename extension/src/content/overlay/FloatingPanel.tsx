import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ElementInfo, VisualChange } from '../../shared/types';
import { useStore, generateChangeId } from '../../shared/store';
import { captureElementScreenshot } from '../selection/ScreenshotCapture';

interface FloatingPanelProps {
  element: ElementInfo;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClose: () => void;
}

export function FloatingPanel({
  element,
  onDragStart,
  onDragEnd,
  onClose,
}: FloatingPanelProps) {
  const { panelPosition, addChange } = useStore();
  const [feedback, setFeedback] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done'>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Initialize position from store
  useEffect(() => {
    if (panelPosition) {
      setPosition({ x: panelPosition.x, y: panelPosition.y });
    }
  }, [panelPosition]);

  // Handle panel dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.vf-panel-header')) {
      setIsDragging(true);
      onDragStart();
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    }
  }, [position, onDragStart]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      onDragEnd();
    }
  }, [isDragging, onDragEnd]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Handle confirm
  const handleConfirm = async () => {
    if (!feedback.trim()) return;

    setStatus('working');

    // Play subtle sound
    playConfirmSound();

    // Capture element screenshot
    const screenshot = await captureElementScreenshot(element.rect);

    const change: VisualChange = {
      id: generateChangeId(),
      element: {
        ...element,
        screenshot,
      },
      feedback: feedback.trim(),
      visualAdjustments: {},
      cssFramework: 'unknown', // Will be detected
      originalUnits: {},
      timestamp: new Date().toISOString(),
      status: 'confirmed',
    };

    addChange(change);

    // Send to background script for MCP
    chrome.runtime.sendMessage({
      type: 'CONFIRM_CHANGE',
      change,
    });

    // Quick feedback then auto-close
    setStatus('done');
    setTimeout(() => {
      onClose(); // Auto-close panel after sending
    }, 500);
  };

  const panelStyle: React.CSSProperties = {
    left: position.x,
    top: position.y,
    cursor: isDragging ? 'grabbing' : undefined,
  };

  return (
    <div
      ref={panelRef}
      className="vf-panel"
      style={panelStyle}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="vf-panel-header">
        <div className="vf-panel-title">
          <span className="vf-element-info-tag">{element.tag}</span>
          {element.id && <span style={{ color: '#a855f7' }}>#{element.id}</span>}
        </div>
        <button className="vf-panel-close" onClick={onClose} style={{ color: '#6b7280', fontSize: '16px' }}>
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="vf-panel-content">
        <div className="vf-panel-chat">
          <div className="vf-element-info">
            {element.smartSummary || `${element.tag} element, ${Math.round(element.rect.width)}×${Math.round(element.rect.height)}px`}
          </div>

          <textarea
            className="vf-chat-input"
            placeholder="Describe what you want to change..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleConfirm();
              }
            }}
          />

          <button
            className={`vf-confirm-btn ${status === 'working' ? 'vf-confirm-btn--working' : ''}`}
            onClick={handleConfirm}
            disabled={status === 'working' || !feedback.trim()}
            style={{ background: status === 'done' ? '#22c55e' : '#22c55e' }}
          >
            {status === 'idle' && 'Confirm'}
            {status === 'working' && 'Sending...'}
            {status === 'done' && '✓ Sent'}
          </button>

        </div>
      </div>
    </div>
  );
}

// Play subtle confirmation sound
function playConfirmSound() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch {
    // Audio not available
  }
}
