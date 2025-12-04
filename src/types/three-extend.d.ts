import { Object3DNode } from '@react-three/fiber';
import { ShaderMaterial, Texture, Color } from 'three';
import { BaseHolographicMaterial } from '@/shaders/BaseHolographic';
import { GodRaysMaterial } from '@/shaders/GodRays';

declare module '@react-three/fiber' {
  interface ThreeElements {
    baseHolographicMaterial: Object3DNode<ShaderMaterial, typeof BaseHolographicMaterial> & {
      baseTexture?: Texture | null;
      shineTexture?: Texture | null;
      maskTexture?: Texture | null;
      useMask?: number;
      time?: number;
    };
    godRaysMaterial: Object3DNode<ShaderMaterial, typeof GodRaysMaterial> & {
      color?: Color | string;
      time?: number;
      alpha?: number;
    };
  }
}