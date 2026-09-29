/**
 * A scatterplot whose discs fade smoothly to nothing at the edge (a soft glow instead of a hard circle).
 * Used with additive blending: the wide translucent glow under a thin bright shape. Data-encoding only:
 * callers size and brighten it from a value (a tall hexagon, a tunnel portal), never for decoration.
 */
import { ScatterplotLayer, type ScatterplotLayerProps } from "@deck.gl/layers";

export const ADDITIVE = {
  blend: true,
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one",
  blendColorOperation: "add",
  blendAlphaOperation: "add",
  depthCompare: "always",
  depthWriteEnabled: false,
} as const;

export default class SoftGlowLayer<DataT = unknown> extends ScatterplotLayer<DataT> {
  static layerName = "SoftGlowLayer";
  static defaultProps = ScatterplotLayer.defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        ...(shaders.inject ?? {}),
        "fs:DECKGL_FILTER_COLOR": `
          float glowD = clamp(length(geometry.uv), 0.0, 1.0);
          float glowK = 1.0 - glowD;
          color.a *= glowK * glowK;
        `,
      },
    };
  }
}

export type SoftGlowProps<DataT> = ScatterplotLayerProps<DataT>;
