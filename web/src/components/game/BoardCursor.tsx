interface BoardCursorProps {
  position: { x: number; y: number };
  visible: boolean;
}

export default function BoardCursor({ position, visible }: BoardCursorProps) {
  if (!visible) return null;

  return (
    <mesh position={[position.x, position.y, 0.3]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="white" opacity={0.35} transparent depthWrite={false} />
    </mesh>
  );
}
