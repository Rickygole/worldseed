/**
 * Deck.gl lighting for the extruded terrain: a soft ambient, a key light from the upper north-west (so the
 * north-west faces of tall hexagons catch light and the relief reads), and a low cool fill from the opposite
 * side so shaded faces never go black. Colors stay near white so the token colors (teal, amber, magenta)
 * are still the colors you read.
 */
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";

export function createLighting(): LightingEffect {
  const ambient = new AmbientLight({ color: [255, 255, 255], intensity: 0.62 });
  const key = new DirectionalLight({ color: [255, 246, 236], intensity: 1.35, direction: [1.0, -1.6, -2.4] });
  const fill = new DirectionalLight({ color: [150, 180, 255], intensity: 0.35, direction: [-1.4, 1.0, -1.2] });
  const effect = new LightingEffect({ ambient, key, fill });
  return effect;
}

/** Material for the terrain columns: mostly diffuse, a faint cool specular on the tops. */
export const TERRAIN_MATERIAL = { ambient: 0.5, diffuse: 0.72, shininess: 28, specularColor: [90, 105, 130] as [number, number, number] };
