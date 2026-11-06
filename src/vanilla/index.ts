import {
  AnachromeRenderer,
  type BloomOptions,
  type ChromaticAberrationOptions,
  type CrtOptions,
  type GrainOptions,
  type HalationOptions,
  type SensorNoiseOptions,
} from "../core/AnachromeRenderer";
import { ANACHROME_PRESETS, type AnachromePreset } from "../presets/presets";

export interface AnachromeMountOptions extends SensorNoiseOptions {
  preset?: keyof typeof ANACHROME_PRESETS | string;
  autoResize?: boolean;
}

export class Anachrome {
  private renderer: AnachromeRenderer | null = null;
  private canvas: HTMLCanvasElement;

  constructor(canvasOrSelector: HTMLCanvasElement | string, options?: AnachromeMountOptions) {
    let canvasEl: HTMLCanvasElement | null = null;

    if (typeof canvasOrSelector === "string") {
      canvasEl = document.querySelector<HTMLCanvasElement>(canvasOrSelector);
      if (!canvasEl) {
        throw new Error(`[Anachrome] Canvas element not found with selector: "${canvasOrSelector}"`);
      }
    } else {
      canvasEl = canvasOrSelector;
    }

    this.canvas = canvasEl;

    // Merge preset if provided
    let mergedOptions: SensorNoiseOptions = { ...(options || {}) };
    if (options?.preset && ANACHROME_PRESETS[options.preset]) {
      const p = ANACHROME_PRESETS[options.preset];
      mergedOptions = {
        ...mergedOptions,
        crt: { ...(p.crt || {}), ...(mergedOptions.crt || {}) },
        bloom: { ...(p.bloom || {}), ...(mergedOptions.bloom || {}) },
        halation: { ...(p.halation || {}), ...(mergedOptions.halation || {}) },
        chromaticAberration: { ...(p.chromaticAberration || {}), ...(mergedOptions.chromaticAberration || {}) },
        grain: { ...(p.grain || {}), ...(mergedOptions.grain || {}) },
      };
    }

    if (Anachrome.isSupported()) {
      this.renderer = new AnachromeRenderer(this.canvas, mergedOptions);
    } else {
      console.warn("[Anachrome] WebGPU is not supported on this browser or platform.");
    }
  }

  /**
   * Teste si WebGPU est supporté par le navigateur de l'utilisateur.
   */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
  }

  /**
   * Helper statique pour initialiser rapidement un overlay Anachrome sur un canvas.
   */
  static mount(canvasOrSelector: HTMLCanvasElement | string, options?: AnachromeMountOptions): Anachrome {
    return new Anachrome(canvasOrSelector, options);
  }

  /**
   * Applique un preset à chaud (ex: 'arcade', 'cinestill', 'cyberpunk', 'vhs80s').
   */
  setPreset(presetKey: keyof typeof ANACHROME_PRESETS | string): this {
    const p = ANACHROME_PRESETS[presetKey];
    if (!p) {
      console.warn(`[Anachrome] Unknown preset: "${presetKey}". Available presets: ${Object.keys(ANACHROME_PRESETS).join(", ")}`);
      return this;
    }

    this.renderer?.updateOptions({
      crt: p.crt,
      bloom: p.bloom,
      halation: p.halation,
      chromaticAberration: p.chromaticAberration,
      grain: p.grain,
    });
    return this;
  }

  /**
   * Met à jour dynamiquement n'importe quel paramètre.
   */
  setOptions(options: Partial<SensorNoiseOptions>): this {
    this.renderer?.updateOptions(options);
    return this;
  }

  /**
   * Récupère l'instance brute du renderer WebGPU sous-jacent.
   */
  getRenderer(): AnachromeRenderer | null {
    return this.renderer;
  }

  /**
   * Libère toutes les ressources WebGPU, détruit les textures et nettoie les observers.
   */
  destroy(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }
}

