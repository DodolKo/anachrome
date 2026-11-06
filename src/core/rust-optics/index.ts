import { OPTICS_WASM_BASE64 } from "./wasm-binary";

export interface RustOpticalParams {
  /** Nombre d'Abbe V_d du verre optique (25 = Flint très dispersif vintage, 64 = Crown apochromatique). Par défaut : 34.0 */
  abbeNumber: number;
  /** Ouverture géométrique N = f/D (1.4 = très grande ouverture / fort sphérochromatisme, 8.0 = fermé). Par défaut : 1.8 */
  apertureFStop: number;
  /** Coefficient linéaire de grandissement chromatique latéral. Par défaut : 1.0 */
  seidelK1: number;
  /** Coefficient cubique de distorsion optique de Seidel (r^3). Par défaut : 0.45 */
  seidelK3: number;
  /** Échelle de la tache de diffraction d'Airy + diffusion de Mie. Par défaut : 1.0 */
  airyBloomScale: number;
  /** Exposant de queue lorentzienne de diffusion de Mie (1.2 = halo très vaporeux, 2.0 = serré). Par défaut : 1.45 */
  mieGamma: number;
  /** Ratio de compression anamorphique (1.0 = optique sphérique, 1.5..2.0 = flare horizontal anamorphique). Par défaut : 1.25 */
  anamorphicSqueeze: number;
  /** Épaisseur du support dorsal en triacétate (µm, typ. 125 µm Kodak Vision3). Par défaut : 125.0 */
  filmThicknessUm: number;
  /** Taux d'absence de couche anti-halo Remjet (0.1 = pellicule standard, 1.0 = CineStill 800T). Par défaut : 0.85 */
  remjetRemoval: number;
}

interface OpticsWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  get_lut_ptr: () => number;
  get_lut_byte_size: () => number;
  compute_optical_lut: (
    abbe_vd: number,
    aperture_fstop: number,
    seidel_k1: number,
    seidel_k3: number,
    airy_bloom_scale: number,
    mie_gamma: number,
    anamorphic_squeeze: number,
    film_thickness_um: number,
    remjet_removal: number,
  ) => void;
}

/**
 * Taille exacte en octets du buffer LUT optique généré par Rust (36 vec4f = 144 f32 = 576 octets)
 */
export const OPTICAL_LUT_BYTE_SIZE = 576;

/**
 * Pont vers le moteur de physique optique & photochimique compilé en Rust Vanilla (wasm32-unknown-unknown)
 */
export class RustOpticalCore {
  private exports: OpticsWasmExports | null = null;
  private lutData = new Float32Array(OPTICAL_LUT_BYTE_SIZE / 4);

  constructor() {
    this.initWasm();
  }

  private initWasm(): void {
    try {
      const binaryString =
        typeof atob === "function"
          ? atob(OPTICS_WASM_BASE64)
          : Buffer.from(OPTICS_WASM_BASE64, "base64").toString("binary");

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wasmModule = new WebAssembly.Module(bytes);
      const wasmInstance = new WebAssembly.Instance(wasmModule, {});
      this.exports = wasmInstance.exports as OpticsWasmExports;
    } catch (err) {
      console.error(
        "[RustOpticalCore] Échec de l'instanciation du noyau Rust WASM :",
        err,
      );
    }
  }

  /**
   * Exécute le calcul physique en Rust (Sellmeier + CIE 1931 + Bessel Airy/Mie + Beer-Lambert)
   * et retourne le tableau Float32Array (576 octets alignés sur 16 octets) prêt pour WebGPU.
   */
  computeLut(params: RustOpticalParams): Float32Array {
    if (!this.exports) {
      return this.lutData;
    }

    this.exports.compute_optical_lut(
      params.abbeNumber,
      params.apertureFStop,
      params.seidelK1,
      params.seidelK3,
      params.airyBloomScale,
      params.mieGamma,
      params.anamorphicSqueeze,
      params.filmThicknessUm,
      params.remjetRemoval,
    );

    const ptr = this.exports.get_lut_ptr();
    const byteSize = this.exports.get_lut_byte_size();
    const wasmView = new Float32Array(
      this.exports.memory.buffer,
      ptr,
      byteSize / 4,
    );
    this.lutData.set(wasmView);

    return this.lutData;
  }
}
