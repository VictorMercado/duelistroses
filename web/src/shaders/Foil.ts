import { shaderMaterial } from "@react-three/drei";
import { Vector2 } from "three";

/**
 * Holographic foil for the parts of a card other than its art: the level
 * stars (rare and up), the attribute and the border round the art (ultimate). It draws
 * its map exactly as an unlit MeshBasicMaterial would (tone mapping and the
 * output colour space included), then adds a rainbow sheen that shifts with
 * the viewing angle and a light sweep.
 *
 * The sweep is worked out in card space (`cardOffset` is where this mesh sits on
 * the card), so the stars, the attribute and the frame catch one band of
 * light crossing the whole card together.
 *
 * With `alphaPremultiplied` (an icon uploaded with premultiplied alpha, see
 * useIconTexture) the sheen is scaled by coverage so the cut-out stays clean;
 * draw it with `transparent premultipliedAlpha`.
 */
export const FoilMaterial = shaderMaterial(
  {
    foilMap: null,
    shineTexture: null,
    time: 0,
    strength: 1.0,
    alphaPremultiplied: 0.0,
    cardOffset: new Vector2(0, 0),
    // Foil only above this height on the card (0 bottom, 1 top); 0 for all of it.
    above: 0.0,
  },
  `
    uniform vec2 cardOffset;
    varying vec2 vUv;
    varying vec2 vCard;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      // Where on the card (0..1 across its 0.68 x 0.98 face) this vertex is.
      vCard = (position.xy + cardOffset) / vec2(0.68, 0.98) + 0.5;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  `
    uniform sampler2D foilMap;
    uniform sampler2D shineTexture;
    uniform float time;
    uniform float strength;
    uniform float alphaPremultiplied;
    uniform float above;
    varying vec2 vUv;
    varying vec2 vCard;
    varying vec3 vViewPosition;
    varying vec3 vNormal;

    void main() {
      vec4 base = texture2D(foilMap, vUv);
      if (base.a < 0.01) discard;
      vec3 viewDir = normalize(vViewPosition);
      vec3 reflectDir = reflect(-viewDir, vNormal);
      float shine = texture2D(shineTexture, vCard * 0.8 + reflectDir.xy * 0.5).r;
      float viewDot = dot(viewDir, vNormal);
      // Bands of colour run across the card and slide as it tilts.
      vec3 rainbow = 0.5 + 0.5 * cos(viewDot * 20.0 + (vCard.x + vCard.y) * 7.0 + vec3(0.0, 2.0, 4.0));

      // The same diagonal sweep as the art's holo, across the whole card.
      float t = mod(time * 0.5, 2.5) - 0.5;
      vec2 p = vCard - vec2(t, t);
      float pX = p.x * 0.707 - p.y * 0.707;
      float pY = p.x * 0.707 + p.y * 0.707;
      float sweep = exp(-(pY * pY * 80.0 + pX * pX * 2.0));

      vec3 holo = ((0.35 + shine * 0.65) * rainbow * 0.55 + vec3(sweep * 0.6)) * strength;
      holo *= smoothstep(above - 0.004, above + 0.004, vCard.y);
      float coverage = mix(1.0, base.a, alphaPremultiplied);
      vec3 color = base.rgb + holo * coverage;
      gl_FragColor = vec4(color, base.a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
);

// A card keeps the shader its material was built with, so a hot update would
// leave the cards on screen drawing the old one: reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
