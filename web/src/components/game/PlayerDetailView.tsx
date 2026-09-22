import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { isPlayer, type Player } from "@/types";
import { gameManager } from "@/game/gameManager";
import { useKeyBindings } from "@/hooks/useKeyBindings";
import { isViewersPiece } from "@/game/visibility";

export default function PlayerDetailView() {
  const selectedTilePiece = gameManager.selectedTilePiece;
  const setShowPlayerDetails = useUIStore((state) => state.setShowPlayerDetails);
  const hasSelection = selectedTilePiece && isPlayer(selectedTilePiece);
  const player = hasSelection ? (selectedTilePiece as Player) : null;
  const { keyBindings } = useKeyBindings();
  const isOpen = !!player;

  // Runs on every render, before any early return: hooks may not be skipped
  // when nothing is selected, or React sees the hook order change.
  useEffect(() => {
    if (!isOpen) return;

    const handleCloseDetailView = (event: KeyboardEvent) => {
      if (keyBindings.cancel.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setShowPlayerDetails(false);
      }
    };

    document.addEventListener('keydown', handleCloseDetailView);
    return () => {
      document.removeEventListener('keydown', handleCloseDetailView);
    };
  }, [isOpen, keyBindings, setShowPlayerDetails]);

  if (!player) return null;

  // Placeholder stats for now - relative to whoever is looking.
  const isOpponent = !isViewersPiece(player);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 w-full animate-in fade-in duration-200">
      <div className="bg-gray-900/90 text-white w-full max-w-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden relative p-8">
        <button
          onClick={() => setShowPlayerDetails(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold z-10 transition-colors"
        >
          ✕
        </button>

        <h2 className="text-4xl font-bold mb-6 text-center border-b border-white/10 pb-4">
          {isOpponent ? "Opponent Duelist" : "Your Duelist"}
        </h2>

        <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
                 <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">Deck Leader</div>
                    <div className="text-xl font-bold text-yellow-500">Toon Dark Magician Girl</div>
                 </div>
                 <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">Life Points</div>
                    <div className="text-3xl font-mono text-green-400">4000</div>
                 </div>
            </div>
             <div className="space-y-4">
                 <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">Deck Rating</div>
                    <div className="text-xl font-bold">S</div>
                 </div>
                 <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">Win/Loss</div>
                    <div className="text-xl font-mono">12 / 0</div>
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
}
