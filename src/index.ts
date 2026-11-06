// Core WebGPU Engine
export {
  AnachromeRenderer,
  type BloomOptions,
  type ChromaticAberrationOptions,
  type CrtOptions,
  type GrainOptions,
  type HalationOptions,
  type ResolvedGrainOptions,
  type ResolvedOptions,
  type SensorNoiseOptions,
} from "./core/AnachromeRenderer";

export { DomSceneMirror } from "./core/DomSceneMirror";

// Presets
export {
  ANACHROME_PRESETS,
  type AnachromePreset,
} from "./presets/presets";

// Vanilla JS API
export {
  Anachrome,
  type AnachromeMountOptions,
} from "./vanilla";

// React Wrapper
export {
  AnachromeCanvas,
  type AnachromeCanvasProps,
} from "./react/AnachromeCanvas";

