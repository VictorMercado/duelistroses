interface ActionMenuProps {
  onMove: () => void;
  onAttack: () => void;
  onChangePosition: () => void;
  onFlip: () => void;
  onDetails: () => void;
  isDefenseMode: boolean;
}

export default function ActionMenu({
  onMove,
  onAttack,
  onChangePosition,
  onFlip,
  onDetails,
  isDefenseMode,
}: ActionMenuProps) {
  return (
    <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 yugiohGradientBackground bg-opacity-80 p-4 rounded-xl flex gap-4 h-20 backdrop-blur-sm border-2 border-yellow-700 shadow-2xl">
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
        className="px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
      >
        {isDefenseMode ? "Attack" : "Defense"}
      </button>
      <button
        onClick={onFlip}
        className="px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
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
