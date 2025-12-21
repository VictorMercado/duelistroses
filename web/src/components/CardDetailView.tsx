import { isCard, type Card } from "@/types";

import { useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Vector3, Group } from "three";
import YugiohCard from "@/components/YugiohCard";
import { useUIStore } from "@/stores/uiStore";
import { useGameStore } from "@/stores/gameStore";
import { gameManager } from "@/game/gameManager";
import { useKeyBindings } from "@/hooks/useKeyBindings";

interface CardDetailViewProps {
}

function CardTilter({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  const { gl } = useThree();
  const isTouch = useRef(false);
  const targetRotation = useRef({ x: 0, y: 0 });
  const lastTouch = useRef({ x: 0, y: 0 });

  useEffect(() => {
    isTouch.current = window.matchMedia("(pointer: coarse)").matches;

    if (isTouch.current) {
      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        /* Prevent Pull-to-Refresh or scroll on the canvas */
        e.preventDefault(); 
        if (e.touches.length > 0) {
          const cx = e.touches[0].clientX;
          const cy = e.touches[0].clientY;
          const dx = cx - lastTouch.current.x;
          const dy = cy - lastTouch.current.y;

          // Provide simple sensitivity scaling
          // Moving finger right (dx > 0) -> Rotate Y positive
          // Moving finger down (dy > 0) -> Rotate X positive
          targetRotation.current.y += dx * 0.005;
          targetRotation.current.x += dy * 0.005;

          lastTouch.current = { x: cx, y: cy };
        }
      };

      // Passive: false is required to use preventDefault
      gl.domElement.addEventListener("touchstart", handleTouchStart, { passive: false });
      gl.domElement.addEventListener("touchmove", handleTouchMove, { passive: false });

      return () => {
        gl.domElement.removeEventListener("touchstart", handleTouchStart);
        gl.domElement.removeEventListener("touchmove", handleTouchMove);
      };
    }
  }, [gl.domElement]);

  useFrame((state) => {
    if (group.current) {
      if (isTouch.current) {
         // Touch Mode: Interpolate to the dragged rotation
         group.current.rotation.x += (targetRotation.current.x - group.current.rotation.x) * 0.1;
         group.current.rotation.y += (targetRotation.current.y - group.current.rotation.y) * 0.1;
      } else {
         // Desktop Mode: Tilt based on mouse pointer position from center
         const { x, y } = state.pointer;
         const targetRotationX = -y * 0.5; // Max tilt up/down
         const targetRotationY = x * 0.5;  // Max tilt left/right

         group.current.rotation.x += (targetRotationX - group.current.rotation.x) * 0.1;
         group.current.rotation.y += (targetRotationY - group.current.rotation.y) * 0.1;
      }
    }
  });

  return <group ref={group}>{children}</group>;
}

export default function CardDetailView({ }: CardDetailViewProps) {
  const setShowDetails = useUIStore((state) => state.setShowDetails);
  const gameStore = useGameStore();
  const { keyBindings } = useKeyBindings();

  const isHandOpen = gameStore.showHand || (gameStore.summoningState && gameStore.summoningState.phase === 'card');
  const handCard = isHandOpen && gameStore.handSelectedIndex >= 0 
    ? gameStore.handCards[gameStore.handSelectedIndex] 
    : null;

  const hasSelection = gameManager.selectedTilePiece && isCard(gameManager.selectedTilePiece);
  const card = handCard || (hasSelection ? (gameManager.selectedTilePiece as Card) : null);
  const isOpponentFaceDown = card && card.owner === 'opponent' && card.isFaceDown;

  // Create a preview version of the card that is always face up and centered
  const previewCard: Card | null = card ? {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: !!isOpponentFaceDown,
    isDefenseMode: false,
  } : null;

  const handleCloseDetailView = (event: KeyboardEvent) => {
    if (keyBindings.cancel.includes(event.key)) {
      event.stopPropagation();
      setShowDetails(false);
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleCloseDetailView);
    return () => {
      document.removeEventListener('keydown', handleCloseDetailView);
    };
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 w-full">
      <div className="bg-gray-900 text-white w-full h-full xl:w-[70%] lg:h-[70%] rounded-2xl shadow-2xl border border-white/10 flex flex-col lg:flex-row lg:flex-row-reverse overflow-hidden relative">
        <button
          onClick={() => setShowDetails(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold z-10"
        >
          ✕
        </button>

        {/* Left Side: Details */}
        <div className="w-full lg:w-1/2 p-8 flex flex-col">
          <h2 className="text-4xl font-bold mb-2">
            {isOpponentFaceDown ? '????' : card?.name}
          </h2>
          <div className="flex gap-2">
            <div className="text-sm text-gray-400 mb-6 uppercase tracking-wider">
              {card?.type}
            </div>
            <div className="text-sm text-gray-400 mb-6 uppercase tracking-wider font-bold" style={{ color: card?.rarity === 'common' ? 'inherit' : '#ffbb00' }}>
              {card?.rarity}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            {
              card?.attack !== -1 && (
                <>
                  <div className="bg-red-900/30 p-4 rounded-lg border border-red-500/20">
                    <div className="text-red-400 text-xs uppercase font-bold">Attack</div>
                    <div className="text-2xl font-mono">{isOpponentFaceDown ? '????' : card?.attack}</div>
                  </div>
                  <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500/20">
                    <div className="text-blue-400 text-xs uppercase font-bold">Defense</div>
                    <div className="text-2xl font-mono">{isOpponentFaceDown ? '????' : card?.defense}</div>
                  </div>
                </>
              )
            }
          </div>

          <div className="flex-grow">
            <h3 className="text-lg font-bold mb-2 border-b border-white/10 pb-1">Description</h3>
            <p className="text-gray-300 leading-relaxed">
              {isOpponentFaceDown ? '????' : card?.description}
            </p>
          </div>
        </div>
        {/* Right Side: 3D Card Preview */}
        <div className={`w-full flex-grow lg:w-1/2 bg-gray-800 flex items-center justify-center border-r border-white/10 relative `}>
          <Canvas camera={{ position: [0, 0, 2], fov: 45 }}>
              <ambientLight intensity={1} />
              <pointLight position={[5, 5, 5]} intensity={2} />
              {previewCard && (
                <CardTilter>
                  <YugiohCard 
                      card={previewCard} 
                      onSelect={() => {}} 
                      isPreview={true}
                  />
                </CardTilter>
              )}
          </Canvas>
        </div>
      </div>
    </div>
  );
}
