import { useEffect, useState } from "react";
import type { KeyBindings } from "@/types";
import { useUIStore } from "@/stores/uiStore";
import { DEFAULT_KEYBINDINGS } from "@/const"
import { useKeyBindings } from "@/hooks/useKeyBindings";

interface SettingsModalProps {
}

export default function SettingsModal({ }: SettingsModalProps) {
  const uiStore = useUIStore();
  const {keyBindings, updateKeyBindings} = useKeyBindings();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tempBindings, setTempBindings] = useState<KeyBindings>(keyBindings);

  const handleKeyPress = (e: React.KeyboardEvent, bindingKey: keyof KeyBindings) => {
    // e.preventDefault();
    if (bindingKey === 'cancel') {
      // For cancel, allow multiple keys
      const currentCancel = tempBindings.cancel;
      if (!currentCancel.includes(e.key)) {
        setTempBindings({ ...tempBindings, cancel: [...currentCancel, e.key] });
      }
    } else {
      setTempBindings({ ...tempBindings, [bindingKey]: e.key });
    }
    setEditingKey(null);
  };

  const handleRemoveCancel = (keyToRemove: string) => {
    setTempBindings({
      ...tempBindings,
      cancel: tempBindings.cancel.filter(k => k !== keyToRemove)
    });
  };

  const handleSave = () => {
    updateKeyBindings(tempBindings);
    uiStore.setShowSettings(false);
  };

  const handleReset = () => {
    setTempBindings(DEFAULT_KEYBINDINGS);
    updateKeyBindings(DEFAULT_KEYBINDINGS);
  };

  const handleClose = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setEditingKey(null);
      uiStore.setShowSettings(false);
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleClose);
    return () => {
      document.removeEventListener('keydown', handleClose);
    };
  }, []);
  
  return (
    <div className="absolute top-0 left-0 w-screen h-screen bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-96 border-2 border-yellow-600 shadow-2xl">
        <h2 className="text-2xl font-bold text-yellow-400 mb-4">Settings</h2>
        
        <div className="space-y-3 mb-6">
          <h3 className="text-lg font-semibold text-yellow-300">Key Bindings</h3>
          
          {/* Select */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Select Piece:</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey('select')
              }}
              onKeyDown={(e) => editingKey === 'select' && handleKeyPress(e, 'select')}
              className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600 min-w-[60px]"
            >
              {editingKey === 'select' ? 'Press key...' : tempBindings.select.toUpperCase()}
            </button>
          </div>

          {/* Cancel */}
          <div className="flex justify-between items-start">
            <span className="text-gray-300">Cancel:</span>
            <div className="flex flex-col gap-1">
              {tempBindings.cancel.map((key, idx) => (
                <div key={idx} className="flex gap-1">
                  <span className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 min-w-[60px] text-center">
                    {key === 'Escape' ? 'ESC' : key.toUpperCase()}
                  </span>
                  {tempBindings.cancel.length > 1 && (
                    <button
                      onClick={() => handleRemoveCancel(key)}
                      className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-white text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cancel')
                }}
                onKeyDown={(e) => editingKey === 'cancel' && handleKeyPress(e, 'cancel')}
                className="px-2 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 text-xs hover:bg-gray-600"
              >
                {editingKey === 'cancel' ? 'Press key...' : '+ Add'}
              </button>
            </div>
          </div>

          {/* View Details */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300">View Details:</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey('viewDetails')
              }}
              onKeyDown={(e) => editingKey === 'viewDetails' && handleKeyPress(e, 'viewDetails')}
              className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600 min-w-[60px]"
            >
              {editingKey === 'viewDetails' ? 'Press key...' : tempBindings.viewDetails.toUpperCase()}
            </button>
          </div>

          {/* Play Card */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Play Card:</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey('playCard')
              }}
              onKeyDown={(e) => editingKey === 'playCard' && handleKeyPress(e, 'playCard')}
              className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600 min-w-[60px]"
            >
              {editingKey === 'playCard' ? 'Press key...' : tempBindings.playCard.toUpperCase()}
            </button>
          </div>

          {/* Flip Card */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Flip Card:</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey('flipCard')
              }}
              onKeyDown={(e) => editingKey === 'flipCard' && handleKeyPress(e, 'flipCard')}
              className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600 min-w-[60px]"
            >
              {editingKey === 'flipCard' ? 'Press key...' : tempBindings.flipCard.toUpperCase()}
            </button>
          </div>

          {/* Change Position */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Change Position:</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey('changePosition')
              }}
              onKeyDown={(e) => editingKey === 'changePosition' && handleKeyPress(e, 'changePosition')}
              className="px-3 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600 min-w-[60px]"
            >
              {editingKey === 'changePosition' ? 'Press key...' : tempBindings.changePosition.toUpperCase()}
            </button>
          </div>

          <div className="border-t border-gray-600 my-3 pt-3">
            <h4 className="text-sm font-semibold text-yellow-300 mb-2">Cursor Movement</h4>
            
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-300">Up:</span>
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cursorUp')
                }}
                onKeyDown={(e) => editingKey === 'cursorUp' && handleKeyPress(e, 'cursorUp')}
                className="px-2 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600"
              >
                {editingKey === 'cursorUp' ? 'Press...' : tempBindings.cursorUp.toUpperCase()}
              </button>

              <span className="text-gray-300">Down:</span>
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cursorDown')
                }}
                onKeyDown={(e) => editingKey === 'cursorDown' && handleKeyPress(e, 'cursorDown')}
                className="px-2 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600"
              >
                {editingKey === 'cursorDown' ? 'Press...' : tempBindings.cursorDown.toUpperCase()}
              </button>

              <span className="text-gray-300">Left:</span>
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cursorLeft')
                }}
                onKeyDown={(e) => editingKey === 'cursorLeft' && handleKeyPress(e, 'cursorLeft')}
                className="px-2 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600"
              >
                {editingKey === 'cursorLeft' ? 'Press...' : tempBindings.cursorLeft.toUpperCase()}
              </button>

              <span className="text-gray-300">Right:</span>
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cursorRight')
                }}
                onKeyDown={(e) => editingKey === 'cursorRight' && handleKeyPress(e, 'cursorRight')}
                className="px-2 py-1 bg-gray-700 border border-yellow-500 rounded text-yellow-200 hover:bg-gray-600"
              >
                {editingKey === 'cursorRight' ? 'Press...' : tempBindings.cursorRight.toUpperCase()}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-semibold"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded font-semibold"
          >
            Save
          </button>
          <button
            onClick={() => uiStore.setShowSettings(false)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
