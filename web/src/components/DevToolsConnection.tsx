import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

export function DevToolsConnection() {
  const { gl, scene } = useThree();

  useEffect(() => {
    // Check if the extension is installed and available
    if (typeof window.__THREE_DEVTOOLS__ !== 'undefined') {
      // Tell the extension about our scene and renderer
      window.__THREE_DEVTOOLS__.dispatchEvent(
        new CustomEvent('observe', { detail: scene })
      );
      window.__THREE_DEVTOOLS__.dispatchEvent(
        new CustomEvent('observe', { detail: gl })
      );
    }
  }, [gl, scene]);

  return null;
};