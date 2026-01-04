import { useEffect, useCallback, useState, useRef } from 'react';
import { useStore } from '../shared/store';
import { ElementHighlight } from './overlay/ElementHighlight';
import { FloatingPanel } from './overlay/FloatingPanel';
import { getElementInfo } from './selection/ElementTracker';
import type { ElementInfo } from '../shared/types';

export function App() {
  const {
    isActive,
    hoveredElement,
    setActive,
    hoverElement,
  } = useStore();

  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
  const [currentRect, setCurrentRect] = useState<DOMRect | null>(null);
  const [isReferencing, setIsReferencing] = useState(false);
  const [referencedElement, setReferencedElement] = useState<ElementInfo | null>(null);

  // Task overlay state (persists after panel closes)
  const [pendingTask, setPendingTask] = useState<{
    taskId: string;
    rect: DOMRect;
    status: 'working' | 'done' | 'error';
    fading: boolean;
  } | null>(null);

  const selectedDomElement = useRef<HTMLElement | null>(null);
  const hoveredDomElement = useRef<Element | null>(null);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Get the deepest element at a point (works with SVG, disabled elements, etc.)
  const getElementAtPoint = useCallback((x: number, y: number): Element | null => {
    // Collect ALL elements in the document and find ones containing the point
    const allElements = document.querySelectorAll('*');
    const matches: { el: Element; depth: number }[] = [];

    for (const el of allElements) {
      // Skip our overlay
      if (el.closest('#visual-feedback-overlay')) continue;
      if (el.id === 'visual-feedback-overlay') continue;

      // Get bounding rect
      const rect = el.getBoundingClientRect();

      // Skip elements with no size
      if (rect.width === 0 || rect.height === 0) continue;

      // Check if point is inside
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        // Calculate depth (how nested is this element)
        let depth = 0;
        let p = el.parentElement;
        while (p) {
          depth++;
          p = p.parentElement;
        }

        matches.push({ el, depth });
      }
    }

    // Sort by depth (deepest first) and return the deepest
    if (matches.length > 0) {
      matches.sort((a, b) => b.depth - a.depth);
      return matches[0].el;
    }

    return null;
  }, []);

  // Handle mouse move for hover detection
  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Always track mouse position
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    // Allow hover detection during reference mode
    if (!isActive || isDraggingPanel || (selectedElement && !isReferencing)) return;

    const target = getElementAtPoint(e.clientX, e.clientY);
    if (!target) return;

    // Store the DOM element reference for spacebar selection
    hoveredDomElement.current = target;

    // Handle both HTML and SVG elements
    const htmlTarget = target instanceof HTMLElement ? target : target as unknown as HTMLElement;
    const elementInfo = getElementInfo(htmlTarget);
    hoverElement(elementInfo);
  }, [isActive, isDraggingPanel, selectedElement, isReferencing, hoverElement, getElementAtPoint]);

  // Handle click to select element (one at a time)
  const handleClick = useCallback((e: MouseEvent) => {
    // In reference mode, set the referenced element
    if (isReferencing) {
      const target = getElementAtPoint(e.clientX, e.clientY);
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      const htmlTarget = target instanceof HTMLElement ? target : target as unknown as HTMLElement;
      const elementInfo = getElementInfo(htmlTarget);
      setReferencedElement(elementInfo);
      return;
    }

    if (!isActive || selectedElement) return;

    const target = getElementAtPoint(e.clientX, e.clientY);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();

    // Handle both HTML and SVG elements
    const htmlTarget = target instanceof HTMLElement ? target : target as unknown as HTMLElement;
    const elementInfo = getElementInfo(htmlTarget);

    // Store DOM element reference for scroll tracking
    selectedDomElement.current = htmlTarget;
    setSelectedElement(elementInfo);
    setCurrentRect(target.getBoundingClientRect());
  }, [isActive, selectedElement, isReferencing, getElementAtPoint]);

  // Update rect continuously using RAF for smooth tracking
  useEffect(() => {
    if (!selectedDomElement.current) return;

    let rafId: number;
    let lastRect = '';

    const updateRect = () => {
      if (selectedDomElement.current) {
        const rect = selectedDomElement.current.getBoundingClientRect();
        // Only update state if rect actually changed (avoid unnecessary renders)
        const rectStr = `${rect.top},${rect.left},${rect.width},${rect.height}`;
        if (rectStr !== lastRect) {
          lastRect = rectStr;
          setCurrentRect(rect);
        }
      }
      rafId = requestAnimationFrame(updateRect);
    };

    rafId = requestAnimationFrame(updateRect);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [selectedElement]);

  // Clear DOM ref when element is deselected
  const clearSelection = useCallback(() => {
    selectedDomElement.current = null;
    setSelectedElement(null);
    setCurrentRect(null);
    setIsReferencing(false);
    setReferencedElement(null);
  }, []);

  // Reference mode handlers
  const handleStartReference = useCallback(() => {
    setIsReferencing(true);
    setReferencedElement(null);
  }, []);

  const handleEndReference = useCallback(() => {
    setIsReferencing(false);
    // Don't clear referencedElement here - FloatingPanel will handle it
  }, []);

  // Handle task submission - show overlay and close panel
  const handleTaskSubmitted = useCallback((taskId: string, rect: DOMRect) => {
    setPendingTask({ taskId, rect, status: 'working', fading: false });
    clearSelection(); // Close the panel
  }, [clearSelection]);

  // Listen for task completion updates
  useEffect(() => {
    if (!pendingTask) return;

    const handleTaskUpdate = (message: { type: string; task?: { id: string; status: string } }) => {
      if (message.type === 'TASK_UPDATE' && message.task && message.task.id === pendingTask.taskId) {
        if (message.task.status === 'complete') {
          // Play sound and show success
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
          } catch {}

          setPendingTask(prev => prev ? { ...prev, status: 'done' } : null);
          // Start fading after showing success
          setTimeout(() => {
            setPendingTask(prev => prev ? { ...prev, fading: true } : null);
          }, 1500);
          // Remove overlay after fade
          setTimeout(() => {
            setPendingTask(null);
          }, 3000);
        } else if (message.task.status === 'failed') {
          setPendingTask(prev => prev ? { ...prev, status: 'error' } : null);
          setTimeout(() => {
            setPendingTask(null);
          }, 3000);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleTaskUpdate);
    return () => {
      chrome.runtime.onMessage.removeListener(handleTaskUpdate);
    };
  }, [pendingTask?.taskId]);

  // Handle keyboard shortcuts (when active)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (selectedElement) {
        clearSelection();
      } else if (isActive) {
        setActive(false);
      }
    }

    // Spacebar selects the currently hovered element
    if (e.key === ' ' && isActive && !selectedElement) {
      e.preventDefault();
      e.stopPropagation();

      // Use stored DOM element reference
      const target = hoveredDomElement.current;
      if (target) {
        const htmlTarget = target instanceof HTMLElement ? target : target as unknown as HTMLElement;
        const elementInfo = getElementInfo(htmlTarget);
        selectedDomElement.current = htmlTarget;
        setSelectedElement(elementInfo);
        setCurrentRect(target.getBoundingClientRect());
      }
    }

    // Arrow Up - go to parent element
    if (e.key === 'ArrowUp' && isActive && !selectedElement && hoveredDomElement.current) {
      e.preventDefault();
      const parent = hoveredDomElement.current.parentElement;
      if (parent && parent !== document.body && !parent.closest('#visual-feedback-overlay')) {
        hoveredDomElement.current = parent;
        const htmlTarget = parent instanceof HTMLElement ? parent : parent as unknown as HTMLElement;
        const elementInfo = getElementInfo(htmlTarget);
        hoverElement(elementInfo);
      }
    }

    // Arrow Down - go to child element at mouse position (or first visible child)
    if (e.key === 'ArrowDown' && isActive && !selectedElement && hoveredDomElement.current) {
      e.preventDefault();
      const { x, y } = lastMousePos.current;

      // Find children that contain the mouse point
      const children = Array.from(hoveredDomElement.current.children);
      let foundChild: Element | null = null;

      // First try to find a child that contains the mouse position
      for (const child of children) {
        if (child.closest('#visual-feedback-overlay')) continue;
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          foundChild = child;
          break;
        }
      }

      // If no child at mouse position, find the first visible child
      if (!foundChild) {
        for (const child of children) {
          if (child.closest('#visual-feedback-overlay')) continue;
          const rect = child.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            foundChild = child;
            break;
          }
        }
      }

      if (foundChild) {
        hoveredDomElement.current = foundChild;
        const htmlTarget = foundChild instanceof HTMLElement ? foundChild : foundChild as unknown as HTMLElement;
        const elementInfo = getElementInfo(htmlTarget);
        hoverElement(elementInfo);
      }
    }

    // Arrow Left/Right - cycle through sibling elements
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isActive && !selectedElement && hoveredDomElement.current) {
      e.preventDefault();
      const parent = hoveredDomElement.current.parentElement;
      if (!parent || parent === document.body) return;

      const siblings = Array.from(parent.children).filter(child => {
        if (child.closest('#visual-feedback-overlay')) return false;
        const rect = child.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const currentIndex = siblings.indexOf(hoveredDomElement.current);
      if (currentIndex === -1) return;

      let nextIndex: number;
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % siblings.length;
      } else {
        nextIndex = (currentIndex - 1 + siblings.length) % siblings.length;
      }

      const nextSibling = siblings[nextIndex];
      if (nextSibling) {
        hoveredDomElement.current = nextSibling;
        const htmlTarget = nextSibling instanceof HTMLElement ? nextSibling : nextSibling as unknown as HTMLElement;
        const elementInfo = getElementInfo(htmlTarget);
        hoverElement(elementInfo);
      }
    }
  }, [isActive, selectedElement, setActive, clearSelection, hoverElement]);

  // Global toggle shortcut - always active
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + V to toggle enable/disable
      if (e.key === 'v' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setActive(!isActive);
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [isActive, setActive]);

  // Set up event listeners
  useEffect(() => {
    let styleEl: HTMLStyleElement | null = null;

    if (isActive) {
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);

      // Inject aggressive style override to enable clicking on ALL elements
      styleEl = document.createElement('style');
      styleEl.id = 'vf-pointer-override';
      styleEl.textContent = `
        *, *::before, *::after,
        *:disabled, [disabled], [aria-disabled="true"],
        button:disabled, input:disabled, select:disabled, textarea:disabled {
          pointer-events: auto !important;
          cursor: crosshair !important;
        }
      `;
      document.head.appendChild(styleEl);

      document.body.style.cursor = 'crosshair';
      document.body.classList.add('vf-tool-active');
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.cursor = '';
      document.body.classList.remove('vf-tool-active');

      // Remove injected style
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
      const existingStyle = document.getElementById('vf-pointer-override');
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, [isActive, handleMouseMove, handleClick, handleKeyDown]);

  // Listen for messages from background script
  useEffect(() => {
    const handleMessage = (message: { type: string; active?: boolean; status?: string }) => {
      if (message.type === 'SET_ACTIVE' && message.active !== undefined) {
        setActive(message.active);
      } else if (message.type === 'CONNECTION_STATUS') {
        // Could update UI to show connection status
        console.log('[VF] Connection status:', message.status);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [setActive]);

  if (!isActive) return null;

  return (
    <div className="vf-overlay">
      {/* Hover highlight - show when no element selected OR during reference mode */}
      {hoveredElement && (!selectedElement || isReferencing) && (
        <ElementHighlight element={hoveredElement} type="hover" />
      )}

      {/* Selected element with highlight and panel */}
      {selectedElement && currentRect && (
        <>
          <ElementHighlight
            element={{ ...selectedElement, rect: currentRect }}
            type="selected"
          />
          <FloatingPanel
            element={{ ...selectedElement, rect: currentRect }}
            onDragStart={() => setIsDraggingPanel(true)}
            onDragEnd={() => setIsDraggingPanel(false)}
            onClose={clearSelection}
            onStartReference={handleStartReference}
            onEndReference={handleEndReference}
            referencedElement={referencedElement}
            onTaskSubmitted={handleTaskSubmitted}
          />
        </>
      )}

      {/* Task progress overlay (persists after panel closes) */}
      {pendingTask && (
        <div
          style={{
            position: 'fixed',
            left: pendingTask.rect.left,
            top: pendingTask.rect.top,
            width: pendingTask.rect.width,
            height: pendingTask.rect.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: pendingTask.status === 'done'
              ? 'rgba(34, 197, 94, 0.85)'
              : pendingTask.status === 'error'
              ? 'rgba(239, 68, 68, 0.85)'
              : 'rgba(59, 130, 246, 0.85)',
            borderRadius: '4px',
            zIndex: 2147483645,
            pointerEvents: 'none',
            transition: 'opacity 1s ease-out',
            opacity: pendingTask.fading ? 0 : 1,
          }}
        >
          {/* Spinner for working state */}
          {pendingTask.status === 'working' && (
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid rgba(255,255,255,0.3)',
              borderTopColor: 'white',
              borderRadius: '50%',
              animation: 'vf-spin 1s linear infinite',
            }} />
          )}
          {/* Checkmark for done state */}
          {pendingTask.status === 'done' && (
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {/* X for error state */}
          {pendingTask.status === 'error' && (
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
