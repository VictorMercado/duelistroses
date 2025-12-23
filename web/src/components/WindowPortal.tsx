import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface WindowPortalProps {
  children: ReactNode;
  closeWindowPortal: () => void;
  externalWindow: Window;
  title?: string;
}

export default function WindowPortal({ 
  children, 
  closeWindowPortal, 
  externalWindow,
  title = "Control Panel"
}: WindowPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!externalWindow) return;

    const currentWindow = externalWindow;

    // Create a container div in the new window
    const newContainer = currentWindow.document.createElement('div');
    newContainer.className = 'w-full h-full';
    currentWindow.document.body.appendChild(newContainer);
    setContainer(newContainer);

    // Set title
    currentWindow.document.title = title;

    // Copy styles
    const styles = Array.from(document.styleSheets);
    styles.forEach(styleSheet => {
      try {
        if (styleSheet.href) {
          const newLink = currentWindow.document.createElement('link');
          newLink.rel = 'stylesheet';
          newLink.href = styleSheet.href;
          currentWindow.document.head.appendChild(newLink);
        } else if (styleSheet.cssRules) {
          const newStyle = currentWindow.document.createElement('style');
          Array.from(styleSheet.cssRules).forEach(rule => {
            newStyle.appendChild(currentWindow.document.createTextNode(rule.cssText));
          });
          currentWindow.document.head.appendChild(newStyle);
        }
      } catch (e) {
        console.warn("Could not copy stylesheet", e);
      }
    });
    
    // Copy style tags
    Array.from(document.head.querySelectorAll('style')).forEach(style => {
      currentWindow.document.head.appendChild(style.cloneNode(true));
    });

    // Close handler
    const handleBeforeUnload = () => {
      closeWindowPortal();
    };
    currentWindow.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      currentWindow.removeEventListener('beforeunload', handleBeforeUnload);
      if (currentWindow.document.body.contains(newContainer)) {
        currentWindow.document.body.removeChild(newContainer);
      }
    };
  }, [externalWindow, closeWindowPortal, title]);

  if (!container) return null;

  return createPortal(children, container);
}
