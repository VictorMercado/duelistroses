import { shaderMaterial } from "@react-three/drei";
import { Color } from "three";

export const GodRaysMaterial = shaderMaterial(
  {
    color: new Color(1, 1, 0),
    time: 0,
    alpha: 1.0,
  },
  // Vertex Shader
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  `
    uniform vec3 color;
    uniform float time;
    uniform float alpha;
    varying vec2 vUv;

    // --- Configuration Variables ---
    // Controls the number of rays in the first layer
    const float RAY_DENSITY_1 = 20.0; 
    // Controls the rotation speed of the first layer
    const float RAY_SPEED_1 = 2.0;    
    
    // Controls the number of rays in the second layer
    const float RAY_DENSITY_2 = 10.0; 
    // Controls the rotation speed of the second layer
    const float RAY_SPEED_2 = 1.0;    

    // Controls how far the rays extend from the center (0.0 to 1.0)
    const float FADE_DISTANCE = 0.6;  
    
    // Controls the softness of the center hole
    const float CENTER_SOFTNESS = 0.4; 
    
    // Global intensity multiplier to control brightness
    const float INTENSITY_MULTIPLIER = 0.5; 

    void main() {
      // 1. Center UVs to (0,0) so rays emanate from the middle
      vec2 uv = vUv - 0.5;
      
      // 2. Convert to Polar Coordinates
      // Distance from center
      float dist = length(uv);
      // Angle around the center
      float angle = atan(uv.y, uv.x);
      
      // 3. Generate Rays
      // Layer 1: High density, fast rotation
      float rays = sin(angle * RAY_DENSITY_1 + time * RAY_SPEED_1) * 0.5 + 0.5;
      
      // Layer 2: Lower density, reverse slower rotation for complexity
      rays += sin(angle * RAY_DENSITY_2 - time * RAY_SPEED_2) * 0.3;
      
      // 4. Apply Fading
      // Fade out as we get further from the center
      float fade = 1.0 - smoothstep(0.0, FADE_DISTANCE, dist);
      
      // 5. Combine and Mask
      float intensity = rays * fade * alpha * INTENSITY_MULTIPLIER;
      
      // Soften the center to avoid a hard point (donut hole effect)
      intensity *= smoothstep(0.0, CENTER_SOFTNESS, dist);

      gl_FragColor = vec4(color, intensity);
    }
  `
);
