import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '@/stores/gameStore';
import { useUIStore } from '@/stores/uiStore';
import { useInputStore } from '@/stores/inputStore';

declare global {
  interface Window {
    gameStore: any;
    uiStore: any;
    inputStore: any;
  }
}

// Helper to display a collapsible store entry with Lazy Rendering
function JsonEntry({ label, value }: { label: string, value: any }) {
  const [expanded, setExpanded] = useState(false);

  if (typeof value === 'function') {
    return null;
  }

  if (value && typeof value === 'object') {
     const isArray = Array.isArray(value);
     // For performance, we don't recursive stringify anymore.
     // We just access keys.
     const keys = Object.keys(value);
     const size = isArray ? value.length : keys.length;
     const summaryType = isArray ? `Array[${size}]` : `Object`;
     const isEmpty = size === 0;

     return (
       <div style={{ marginLeft: '4px' }}>
         <div 
            onClick={() => !isEmpty && setExpanded(!expanded)} 
            style={{ 
                cursor: isEmpty ? 'default' : 'pointer', 
                color: '#66d9ef', 
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'center',
                userSelect: 'none'
            }}
         >
           <span style={{ marginRight: '4px', visibility: isEmpty ? 'hidden' : 'visible', fontSize: '10px' }}>
                {expanded ? '▼' : '▶'}
           </span> 
           <span style={{ marginRight: '6px' }}>{label}:</span>
           <span style={{ color: '#888' }}>{summaryType}</span>
         </div>
         
         {expanded && (
           <div style={{ marginLeft: '14px', borderLeft: '1px solid #333', paddingLeft: '4px' }}>
             {keys.slice(0, 50).map(key => ( // Limit to 50 items to prevent massive renders
               <JsonEntry key={key} label={key} value={value[key]} />
             ))}
             {keys.length > 50 && (
                 <div style={{ color: '#666', padding: '4px', fontStyle: 'italic' }}>... {keys.length - 50} more items ...</div>
             )}
           </div>
         )}
       </div>
     );
  }

  let displayValue = String(value);
  if (typeof value === 'string') displayValue = `"${value}"`;

  return (
    <div style={{ marginLeft: '22px', fontFamily: 'monospace', display: 'flex' }}>
       <span style={{ color: '#a6e22e', marginRight: '6px' }}>{label}:</span> 
       <span style={{ color: '#ce9178', wordBreak: 'break-all' }}>{displayValue}</span>
    </div>
  );
}

function StoreViewer({ name, data }: { name: string, data: any }) {
  const containerStyle = {
    border: '1px solid #333',
    padding: '10px',
    borderRadius: '5px',
    backgroundColor: '#000',
    overflow: 'auto',
  };

  const titleStyle = {
    color: '#fff',
    borderBottom: '1px solid #333',
    paddingBottom: '5px',
    marginBottom: '10px',
    fontSize: '1.2em',
    fontWeight: 'bold' as const,
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{name}</div>
      {Object.entries(data).map(([key, value]) => (
        <JsonEntry key={key} label={key} value={value} />
      ))}
    </div>
  );
}

function DebugContent() {
  // We use local state and setInterval to throttle updates and avoid blocking the main thread
  // with high-frequency re-renders (like cursor movement).
  const [data, setData] = useState({
    game: useGameStore.getState(),
    input: useInputStore.getState(),
    ui: useUIStore.getState(),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setData({
        game: useGameStore.getState(),
        input: useInputStore.getState(),
        ui: useUIStore.getState(),
      });
    }, 500); // 2 FPS update rate
    return () => clearInterval(interval);
  }, []);

  const mainContainerStyle = {
    padding: '20px',
    backgroundColor: '#111',
    color: '#0f0',
    height: '100vh',
    overflow: 'auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
  };

  return (
    <div style={mainContainerStyle}>
      <StoreViewer name="Game Store (Throttled)" data={data.game} />
      <StoreViewer name="Input Store (Throttled)" data={data.input} />
      <StoreViewer name="UI Store (Throttled)" data={data.ui} />
    </div>
  );
}

export default function DevTools() {
  // Keep console exposure by assigning hooks to window, but don't subscribe this component to updates!
  useEffect(() => {
    window.gameStore = useGameStore;
    window.uiStore = useUIStore;
    window.inputStore = useInputStore;
    return () => {
      delete window.gameStore;
      delete window.uiStore;
      delete window.inputStore;
    };
  }, []);

  const [externalWindow, setExternalWindow] = useState<Window | null>(null);

  const openWindow = () => {
    const newWindow = window.open('', '', 'width=1200,height=800,left=200,top=200');
    if (newWindow) {
      newWindow.document.title = "Duelist Roses Debugger";
      // Add some basic reset CSS
      const style = newWindow.document.createElement('style');
      style.textContent = `
        body { margin: 0; background: #111; }
        ::-webkit-scrollbar { width: 10px; background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 5px; }
      `;
      newWindow.document.head.appendChild(style);
      
      setExternalWindow(newWindow);

      newWindow.onbeforeunload = () => {
        setExternalWindow(null);
      };
    }
  };

  return (
    <>
      <button 
        onClick={openWindow}
        className="fixed bottom-4 right-4 z-[9999] bg-gray-800 text-green-400 px-3 py-1 rounded border border-gray-600 font-mono text-xs opacity-50 hover:opacity-100 transition-opacity"
      >
        {externalWindow ? 'Debugger Active' : 'Open Debugger'}
      </button>
      
      {externalWindow && createPortal(
        <DebugContent />,
        externalWindow.document.body
      )}
    </>
  );
}
