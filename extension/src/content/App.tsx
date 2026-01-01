import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../shared/store';
import { ElementHighlight } from './overlay/ElementHighlight';
import { BreadcrumbBar } from './overlay/BreadcrumbBar';
import { FloatingPanel } from './overlay/FloatingPanel';
import { getElementInfo } from './selection/ElementTracker';
import type { ElementInfo } from '../shared/types';

// Store selected elements with their fixed positions
interface SelectedElementWithPosition extends ElementInfo {
  fixedRect: DOMRect; // Position at time of selection (won't move on scroll)
}

export function App() {
  const {
    isActive,
    hoveredElement,
    setActive,
    hoverElement,
  } = useStore();

  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [selectedElements, setSelectedElements] = useState<SelectedElementWithPosition[]>([]);

  // Handle mouse move for hover detection
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isActive || isDraggingPanel) return;

    const target = e.target as HTMLElement;

    // Ignore our own overlay elements
    if (target.closest('#visual-feedback-overlay')) return;

    const elementInfo = getElementInfo(target);
    hoverElement(elementInfo);
  }, [isActive, isDraggingPanel, hoverElement]);

  // Handle click to select element (add to list)
  const handleClick = useCallback((e: MouseEvent) => {
    if (!isActive) return;

    const target = e.target as HTMLElement;

    // Ignore our own overlay elements
    if (target.closest('#visual-feedback-overlay')) return;

    e.preventDefault();
    e.stopPropagation();

    const elementInfo = getElementInfo(target);

    // Store with fixed position at time of click
    const elementWithFixedPos: SelectedElementWithPosition = {
      ...elementInfo,
      fixedRect: elementInfo.rect, // Capture position now
    };

    setSelectedElements(prev => [...prev, elementWithFixedPos]);
  }, [isActive]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (selectedElements.length > 0) {
        setSelectedElements([]);
      } else if (isActive) {
        setActive(false);
      }
    }
  }, [isActive, selectedElements.length, setActive]);

  // Set up event listeners
  useEffect(() => {
    if (isActive) {
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);

      // Add body class for cursor change
      document.body.style.cursor = 'crosshair';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.cursor = '';
    };
  }, [isActive, handleMouseMove, handleClick, handleKeyDown]);

  // Listen for messages from background script
  useEffect(() => {
    const handleMessage = (message: { type: string; active?: boolean }) => {
      console.log('[VF] Received message:', message);
      if (message.type === 'TOGGLE_ACTIVE') {
        console.log('[VF] Toggling active state from', isActive, 'to', !isActive);
        setActive(!isActive);
      } else if (message.type === 'SET_ACTIVE' && message.active !== undefined) {
        console.log('[VF] Setting active state to', message.active);
        setActive(message.active);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    console.log('[VF] Message listener registered, current isActive:', isActive);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [isActive, setActive]);

  if (!isActive) return null;

  // Remove a selected element by index
  const removeSelectedElement = (index: number) => {
    setSelectedElements(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="vf-overlay">
      {/* Breadcrumb bar at top - show for first selected element */}
      {selectedElements.length > 0 && (
        <BreadcrumbBar
          element={selectedElements[0]}
          onSelectPath={() => {}}
        />
      )}

      {/* Hover highlight - only show when no panels are open */}
      {hoveredElement && selectedElements.length === 0 && (
        <ElementHighlight element={hoveredElement} type="hover" />
      )}

      {/* Selected elements - each with highlight and panel */}
      {selectedElements.map((element, index) => (
        <div key={`${element.selector}-${index}`}>
          {/* Use fixedRect for position */}
          <ElementHighlight
            element={{ ...element, rect: element.fixedRect }}
            type="selected"
          />
          <FloatingPanel
            element={{ ...element, rect: element.fixedRect }}
            onDragStart={() => setIsDraggingPanel(true)}
            onDragEnd={() => setIsDraggingPanel(false)}
            onClose={() => removeSelectedElement(index)}
          />
        </div>
      ))}
    </div>
  );
}
