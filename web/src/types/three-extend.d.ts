import { Object3DNode } from '@react-three/fiber';
import { ShaderMaterial, Texture, Color, Vector2 } from 'three';
import { BaseHolographicMaterial } from '@/shaders/BaseHolographic';
import { GodRaysMaterial } from '@/shaders/GodRays';
import { FoilMaterial } from '@/shaders/Foil';

declare module '@react-three/fiber' {
  interface ThreeElements {
    baseHolographicMaterial: Object3DNode<ShaderMaterial, typeof BaseHolographicMaterial> & {
      baseTexture?: Texture | null;
      shineTexture?: Texture | null;
      maskTexture?: Texture | null;
      useMask?: number;
      time?: number;
      pattern?: number;
    };
    foilMaterial: Object3DNode<ShaderMaterial, typeof FoilMaterial> & {
      foilMap?: Texture | null;
      shineTexture?: Texture | null;
      time?: number;
      strength?: number;
      alphaPremultiplied?: number;
      above?: number;
      cardOffset?: Vector2 | [number, number];
    };
    godRaysMaterial: Object3DNode<ShaderMaterial, typeof GodRaysMaterial> & {
      color?: Color | string;
      time?: number;
      alpha?: number;
    };
  }
}