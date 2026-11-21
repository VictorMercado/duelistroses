import { shaderMaterial } from "@react-three/drei";

export const BaseHolographicMaterial = shaderMaterial(
  {
    baseTexture: null,
    shineTexture: null,
    maskTexture: null, // New input for the black/white mask
    useMask: 0.0, // 0 = false, 1 = true (toggle based on if mask exists)
    time: 0,
    // The art's foil: 0 the rainbow holo with its light sweep (ultra,
    // ultimate), 1 the secret rare's fine diagonal lines, 2 the cosmic rare's glitter.
    pattern: 0.0,
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
    uniform float pattern;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Cosmic rare: a scatter of tiny flakes over the art, each catching the
    // light at its own moment and its own viewing angle, in rainbow tints.
    // The layers sit at different depths under the surface: tilting the card
    // slides them against the art and each other (parallax), so the glitter
    // reads as sunk into the card, like the ultra holo's sheen.
    vec3 glitter(vec2 uv, vec3 viewDir, vec3 reflectDir) {
      vec3 total = vec3(0.0);
      // Two layers of flakes, a fine one and a sparser coarse one.
      for (int layer = 0; layer < 2; layer++) {
        float scale = layer == 0 ? 70.0 : 34.0;
        float depth = layer == 0 ? 0.05 : 0.12;
        vec2 grid = (uv + reflectDir.xy * depth) * vec2(scale, scale * 1.08);
        vec2 cell = floor(grid);
        vec2 f = fract(grid) - 0.5;
        float h = hash(cell + float(layer) * 17.0);
        float h2 = hash(cell + 3.7);
        // Only some cells hold a flake; it sits off-centre in its cell.
        float present = step(layer == 0 ? 0.62 : 0.8, h);
        vec2 at = f - (vec2(h, h2) - 0.5) * 0.5;
        // Each flake faces its own way: tilting the card sweeps which ones flash.
        float facing = dot(viewDir.xy, vec2(h - 0.5, h2 - 0.5)) * 14.0;
        float twinkle = pow(max(0.0, sin(h * 6.2831 + time * (1.2 + h2 * 2.5) + facing)), 12.0);
        // A bright dot with a faint four-pointed glint.
        float dotShape = smoothstep(0.22, 0.0, length(at));
        float glint = max(0.0, 1.0 - abs(at.x) * 9.0) * max(0.0, 1.0 - abs(at.y) * 2.2)
                    + max(0.0, 1.0 - abs(at.y) * 9.0) * max(0.0, 1.0 - abs(at.x) * 2.2);
        vec3 tint = 0.65 + 0.35 * cos(6.2831 * (h2 + vec3(0.0, 0.33, 0.67)));
        total += tint * (dotShape + glint * 0.35) * twinkle * present * (layer == 0 ? 0.9 : 1.3);
      }
      return total;
    }

    // Secret rare: the art is etched with fine parallel lines running
    // diagonally, each broken into tiny dashes. They throw rainbow colours that
    // run in bands across the card and slide as it tilts, and broad bands of
    // light come and go across them; a few flakes sparkle on top.
    vec3 secretLines(vec2 uv, vec3 reflectDir) {
      // Across the lines (/ from bottom left to top right), and along them.
      float across = (uv.x - uv.y) * 0.7071;
      float along = (uv.x + uv.y) * 0.7071;
      float lineCoord = across * 75.0;
      // Lines thinner than a pixel would shimmer (moire): fade the pattern to
      // its average as it gets that fine.
      float w = fwidth(lineCoord);
      float fineness = clamp(1.0 - (w - 0.25) * 2.0, 0.0, 1.0);
      float l = abs(fract(lineCoord) - 0.5);
      float line = mix(0.4, smoothstep(0.2 + w, 0.2 - w, l), fineness);
      // Each line is broken into long dashes with short gaps, offset line to
      // line, so the lines read as lines and the gaps never line up in a grid.
      float row = floor(lineCoord);
      float dashCoord = along * (18.0 + 10.0 * hash(vec2(row, 2.0))) + hash(vec2(row, 1.0)) * 7.0;
      float dw = fwidth(dashCoord);
      float dash = mix(0.9, 1.0 - smoothstep(0.42 - dw, 0.47 + dw, abs(fract(dashCoord) - 0.5)), fineness);
      // A slight per-dash variation in brightness, as real foil has.
      float grain = 0.65 + 0.35 * hash(vec2(row, floor(dashCoord)));

      // Rainbow running along the diagonal and shifting with the view.
      float phase = along * 2.2 + dot(reflectDir.xy, vec2(1.6, 1.1)) + time * 0.05;
      vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (phase + vec3(0.0, 0.33, 0.67)));
      // Broad bands of light across the lines, moving as it tilts.
      float band = 0.5 + 0.5 * sin(along * 9.0 + (reflectDir.x + reflectDir.y) * 5.0 + time * 0.4);
      band = 0.25 + 0.75 * band * band;

      vec3 lines = rainbow * line * dash * grain * band * 0.6;
      // A light dusting of sparkles over the lines.
      return lines + glitter(uv, normalize(vViewPosition), reflectDir) * 0.35;
    }

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
      vec3 rainbow = 0.5 + 0.5 * cos(viewDot * 20.0 + vec3(0, 2, 4));
      
      // Calculate mask factor
      // The user wants the shine on the BLACK part of the mask (background).
      // So we invert the mask value.
      float maskVal = texture2D(maskTexture, vUv).r;
      float invertedMaskVal = 1.0 - maskVal;
      
      // If useMask is 0.0, maskFactor is 1.0 (shine everywhere/default behavior)
      // If useMask is 1.0, maskFactor is invertedMaskVal
      float maskFactor = mix(1.0, invertedMaskVal, useMask);

      // --- Light Sweep Effect ---
      // "Blurred thin oval light sweep"
      
      // 1. Moving center position (loops)
      // Moves from bottom-left (-0.5) to top-right (1.5)
      float t = mod(time * 0.5, 2.5) - 0.5;
      vec2 center = vec2(t, t);
      
      // 2. Vector from center
      vec2 p = vUv - center;
      
      // 3. Rotate coordinates -45 degrees to align with diagonal movement
      // pX is perpendicular to movement (length of oval)
      // pY is parallel to movement (width/thinness of oval)
      float pX = p.x * 0.707 - p.y * 0.707;
      float pY = p.x * 0.707 + p.y * 0.707;
      
      // 4. Create Oval Shape using Gaussian falloff
      // High coefficient for pY makes it thin (narrow width)
      // Low coefficient for pX makes it long (oval shape)
      float shape = (pY * pY * 80.0) + (pX * pX * 2.0);
      
      // Exp creates a smooth, blurred gaussian falloff
      float sweep = exp(-shape);
      
      // Add the sweep to the holographic effect
      vec3 sweepColor = vec3(1.0, 1.0, 1.0) * sweep * 0.6;

      // Apply the maskFactor to the shine calculation
      // If maskFactor is 0 (on the dragon), no shine is added.
      vec3 holoEffect = (shine.r * rainbow * 0.6 + sweepColor) * maskFactor;
      // Secret rare trades the rainbow sheen for the glitter, with a fainter sweep.
      if (pattern > 0.5 && pattern < 1.5) holoEffect = (secretLines(vUv, reflectDir) + sweepColor * 0.3) * maskFactor;
      // Under the flakes, a faint sheen of the holo's rainbow, shifting with the
      // view the same way, gives the art its depth.
      if (pattern > 1.5) holoEffect = (glitter(vUv, viewDir, reflectDir) + shine.r * rainbow * 0.22 + sweepColor * 0.35) * maskFactor;
      
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

// A card keeps the shader its material was built with, so a hot update would
// leave the cards on screen drawing the old one: reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
