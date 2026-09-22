import { Text } from "@react-three/drei";
import { useUIStore } from "@/stores/uiStore";

export default function StaticAxisHelper() {
  const uiStore = useUIStore();
  return (
    <>
      {
        uiStore.showStaticAxisHelper && (
          <group position={[-6, 0, 0]}>
            <mesh>
              <Text
                position={[-0.6, 0, 0]}
                color="red"
                fontSize={0.2}
              >X</Text>
              <boxGeometry args={[1, 0.01, 0.01]} />
              <meshBasicMaterial color="red" />
            </mesh>
            <mesh>
              <Text
                position={[0, -0.6, 0]}
                color="green"
                fontSize={0.2}
              >Y</Text>
              <boxGeometry args={[0.01, 1, 0.01]} />
              <meshBasicMaterial color="green" />
            </mesh>
            <mesh>
              <Text
                position={[0, 0, 0.6]}
                color="blue"
                fontSize={0.2}
              >Z</Text>
              <boxGeometry args={[0.01, 0.01, 1]} />
              <meshBasicMaterial color="blue" />
            </mesh>
          </group>
        )
      }
    </>
  );
}
