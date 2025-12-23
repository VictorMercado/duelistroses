import { useState, useEffect, useCallback } from 'react';

interface WindowPortalOptions {
  width?: number;
  height?: number;
  autoClose?: boolean;
}

export function useWindowPortal(options: WindowPortalOptions = {}) {
  const [externalWindow, setExternalWindow] = useState<Window | null>(null);

  const openWindow = useCallback(() => {
    const width = options.width || 450;
    const height = options.height || 700;
    const left = window.screenX + window.outerWidth / 2 + width / 2;
    const top = window.screenY + window.outerHeight / 2 - height / 2;

    const newWindow = window.open(
      '',
      '',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (newWindow) {
      setExternalWindow(newWindow);
    }
  }, [options.width, options.height]);

  const closeWindow = useCallback(() => {
    if (externalWindow) {
      externalWindow.close();
      setExternalWindow(null);
    }
  }, [externalWindow]);

  useEffect(() => {
    return () => {
      if (options.autoClose !== false && externalWindow && !externalWindow.closed) {
        externalWindow.close();
      }
    };
  }, [externalWindow, options.autoClose]);

  return { externalWindow, openWindow, closeWindow };
}
