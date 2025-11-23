interface ActionMenuProps {
  onMove: () => void;
  onAttack: () => void;
  onChangePosition: () => void;
  onFlip: () => void;
  onDetails: () => void;
  onCommit: () => void;
  onCancel: () => void;
  isDefenseMode: boolean;
  isFaceDown: boolean;
  hasMoved: boolean;
  hasChangedMode: boolean;
}

export default function ActionMenu({
  onMove,
  onAttack,
  onChangePosition,
  onFlip,
  onDetails,
  onCommit,
  onCancel,
  isDefenseMode,
  isFaceDown,
  hasMoved,
  hasChangedMode,
}: ActionMenuProps) {
  const canCommit = hasMoved || hasChangedMode;
  const canChangeMode = !hasMoved;
  // Allow flipping in either direction during staging, just not after moving
  const canFlip = !hasMoved;
  
  return (
    <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 yugiohGradientBackground bg-opacity-80 p-4 rounded-xl flex gap-4 h-20 backdrop-blur-sm border-2 border-yellow-700 shadow-2xl">
      {/* Commit Action Button - Green, prominent */}
      <button
        onClick={onCommit}
        disabled={!canCommit}
        className={`px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
          canCommit
            ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
            : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
        title={!canCommit ? "No action taken" : "Commit the action (Enter)"}
      >
        ✓ Commit
      </button>
      
      {/* Cancel Button - Red */}
      <button
        onClick={onCancel}
        className="px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
        title="Cancel and revert changes (Esc)"
      >
        ✕ Cancel
      </button>
      
      <div className="w-8 flex items-center h-full justify-center">
        <span className="h-full w-1 bg-black"></span>
      </div>
      
      <button
        onClick={onMove}
        className="px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
      >
        Move
      </button>
      <button
        onClick={onAttack}
        className="px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
      >
        Attack
      </button>
      
      <div className="w-8 flex items-center h-full justify-center">
        <span className="h-full w-1 bg-black"></span>
      </div>
      
      <button
        onClick={onChangePosition}
        disabled={!canChangeMode}
        className={`px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
          canChangeMode
            ? 'border-yellow-700 hover:border-yellow-300'
            : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
        title={!canChangeMode ? "Can't change position after moving" : ""}
      >
        {isDefenseMode ? "Attack" : "Defense"}
      </button>
      <button
        onClick={onFlip}
        disabled={!canFlip}
        className={`px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
          canFlip
            ? 'border-yellow-700 hover:border-yellow-300'
            : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
        title={!canFlip ? "Can't flip after moving" : "Toggle face-up/face-down"}
      >
        Flip
      </button>
      <button
        onClick={onDetails}
        className="px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
      >
        Details
      </button>
    </div>
  );
}
