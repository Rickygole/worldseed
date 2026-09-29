/** Place labels drawn in the deck layer (layout and collision live in labelLayout.ts). */
import { WebMercatorViewport, type Layer } from "@deck.gl/core";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";

import type { Padding } from "@/lib/ui/mapDirector";
import { ON_TOP } from "./terrainLayers";
import { LABEL_SIZE, OFFSET_Y, type CameraLike, type LabelDef } from "./labelLayout";

export type { LabelDef } from "./labelLayout";


/** Builds the projection for a camera and viewport. */
export function makeProjector(cam: CameraLike, width: number, height: number, pad: Padding): (lng: number, lat: number, z: number) => [number, number] {
  const vp = new WebMercatorViewport({ width, height, ...cam, padding: pad });
  return (lng, lat, z) => {
    const p = vp.project([lng, lat, z]);
    return [p[0], p[1]];
  };
}

export function labelLayers(defs: readonly LabelDef[], shown: Map<string, number>, fontFamily: string): Layer[] {
  const vis = defs.filter((d) => (shown.get(d.id) ?? 0) > 0.03).map((d) => ({ ...d, a: shown.get(d.id) ?? 0 }));
  if (vis.length === 0) return [];
  type V = (typeof vis)[number];
  const key = vis.map((d) => d.a.toFixed(2)).join();
  const text = (id: string, data: V[], strong: boolean) =>
    new TextLayer<V>({
      id,
      data,
      getText: (d) => d.text,
      getPosition: (d) => [d.lng, d.lat, d.z],
      getSize: LABEL_SIZE,
      sizeUnits: "pixels",
      getColor: (d) => [d.color[0], d.color[1], d.color[2], d.color[3] * d.a],
      getPixelOffset: [0, OFFSET_Y],
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily,
      fontWeight: 600,
      fontSettings: { sdf: true, radius: 6, buffer: 4 },
      outlineWidth: 3,
      outlineColor: [7, 11, 18, 235],
      characterSet: "auto",
      // Crossing and option labels sit on a dark chip so they read over any terrain color.
      background: strong,
      getBackgroundColor: (d) => [10, 14, 20, 214 * d.a],
      backgroundPadding: [5, 2],
      backgroundBorderRadius: 4,
      parameters: ON_TOP,
      pickable: false,
      updateTriggers: { getColor: key, getBackgroundColor: key, getText: data.map((d) => d.text).join("|") },
    });
  return [
    new ScatterplotLayer<V>({
      id: "label-anchors",
      data: vis,
      getPosition: (d) => [d.lng, d.lat, d.z],
      getRadius: 2.4,
      radiusUnits: "pixels",
      filled: true,
      stroked: true,
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 235 * d.a],
      getLineColor: [7, 11, 18, 200],
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      parameters: ON_TOP,
      pickable: false,
      updateTriggers: { getFillColor: key },
    }),
    text("place-labels", vis.filter((d) => !d.strong), false),
    text("link-labels", vis.filter((d) => d.strong), true),
  ];
}
