import { shaderMaterial } from "@react-three/drei";

export const BaseHolographicMaterial = shaderMaterial(
  {
    baseTexture: null,
    shineTexture: null,
    maskTexture: null, // New input for the black/white mask
    useMask: 0.0, // 0 = false, 1 = true (toggle based on if mask exists)
    time: 0,
  },
  // Vertex Shader (Unchanged)
  `
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  // Fragment Shader (Updated)
  `
    uniform sampler2D baseTexture;
    uniform sampler2D shineTexture;
    uniform sampler2D maskTexture;
    uniform float useMask;
    uniform float time;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;

    void main() {
      vec4 baseColor = texture2D(baseTexture, vUv);
      
      // Calculate view vector
      vec3 viewDir = normalize(vViewPosition);
      
      // Calculate reflection vector
      vec3 reflectDir = reflect(-viewDir, vNormal);
      
      // Simple holographic effect based on view angle
      // We map the reflection vector to UV coordinates for the shine texture
      vec2 shineUv = vUv + reflectDir.xy * 0.5;
      
      vec4 shine = texture2D(shineTexture, shineUv);
      
      // Create a rainbow effect based on view angle
      float viewDot = dot(viewDir, vNormal);
      vec3 rainbow = 0.5 + 0.5 * cos(viewDot * 10.0 + vec3(0, 2, 4));
      
      // Calculate mask factor
      // The user wants the shine on the BLACK part of the mask (background).
      // So we invert the mask value.
      float maskVal = texture2D(maskTexture, vUv).r;
      float invertedMaskVal = 1.0 - maskVal;
      
      // If useMask is 0.0, maskFactor is 1.0 (shine everywhere/default behavior)
      // If useMask is 1.0, maskFactor is invertedMaskVal
      float maskFactor = mix(1.0, invertedMaskVal, useMask);

      // --- Light Sweep Effect ---
      // Create a diagonal band that moves across the card
      // (vUv.x + vUv.y) creates a diagonal gradient
      // time * 0.5 controls the speed
      float sweep = sin((vUv.x + vUv.y) * 5.0 - time * 2.0);
      // Sharpen the sine wave to make it a distinct band
      sweep = smoothstep(0.9, 1.0, sweep);
      
      // Add the sweep to the holographic effect
      // It should also be masked
      vec3 sweepColor = vec3(1.0, 1.0, 1.0) * sweep * 0.5;

      // Apply the maskFactor to the shine calculation
      // If maskFactor is 0 (on the dragon), no shine is added.
      vec3 holoEffect = (shine.r * rainbow * 0.5 + sweepColor) * maskFactor;
      
      vec3 finalColor = baseColor.rgb + holoEffect;

      gl_FragColor = vec4(finalColor, baseColor.a);
    }
  `
);
// export const BaseHolographicMaterial = shaderMaterial(
//   {
//     baseTexture: null,
//     shineTexture: null,
//   },
//   // Vertex Shader: Standard, but passes view data to fragment
//   `
//     varying vec2 vUv;
//     varying vec3 vViewPosition;
//     varying vec3 vNormal;
//     void main() {
//       vUv = uv;
//       vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
//       // The view position relative to the camera
//       vViewPosition = -mvPosition.xyz;
//       vNormal = normalize(normalMatrix * normal);
//       gl_Position = projectionMatrix * mvPosition;
//     }
//   `,
//   // Fragment Shader: Calculates the shiny rainbow effect
//   `
//     uniform sampler2D baseTexture;
//     uniform sampler2D shineTexture;
//     varying vec2 vUv;
//     varying vec3 vViewPosition;
//     varying vec3 vNormal;

//     void main() {
//       // 1. Get the base artwork color
//       vec4 baseColor = texture2D(baseTexture, vUv);

//       // 2. Calculate the view direction (vector from camera to pixel)
//       vec3 viewDir = normalize(vViewPosition);

//       // 3. Calculate sheen intensity based on angle
//       // dot product determines how "facing" the camera the surface is
//       float viewShift = dot(viewDir, vNormal);

//       // 4. Shift UVs for the shine texture based on view angle to simulate depth
//       vec2 shineUv = vUv + vec2(viewShift * 0.5, viewShift * 0.5); // 0.5 is the shift speed
      
//       // 5. Sample the shine mask
//       vec4 shine = texture2D(shineTexture, shineUv);

//       // 6. Create a holographic rainbow gradient based on the angle
//       vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (viewShift + vec3(0.0, 0.33, 0.67)));

//       // 7. Blend: Add the shine (masked by the texture) to the base color
//       // Multiplier 0.6 controls the brightness of the holo effect
//       vec3 finalColor = baseColor.rgb + (shine.r * rainbow * 0.4);

//       gl_FragColor = vec4(finalColor, baseColor.a);
//     }
//   `
// );
