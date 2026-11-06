import { RELATIVITY_WASM_BASE64 } from "./wasm-binary";

export interface RustRelativityParams {
  /** Paramètre de spin sans dimension de Kerr a* = Jc / GM^2 (-0.998 à +0.998). Par défaut : 0.92 */
  spin: number;
  /** Rayon externe du disque d'accrétion en multiples de M (G=c=1, r_s = 2M). Par défaut : 18.0 */
  diskOuterRadius: number;
  /** Température maximale au cœur du disque d'accrétion en Kelvin (ex: 9500 K). Par défaut : 9500 */
  diskTemperatureKelvin: number;
}

interface RelativityWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  get_relativity_lut_ptr: () => number;
  get_relativity_lut_byte_size: () => number;
  compute_relativity_lut: (
    spin_a: number,
    disk_outer_r: number,
    peak_temp_kelvin: number,
  ) => void;
}

/**
 * Taille exacte en octets du buffer LUT relativiste généré par Rust (34 vec4f = 136 f32 = 544 octets)
 */
export const RELATIVITY_LUT_BYTE_SIZE = 544;

/**
 * Pont vers le noyau de Relativité Générale (Métrique de Kerr & Corps Noir de Planck)
 * compilé en Rust Vanilla (#![no_std] -> wasm32-unknown-unknown).
 */
export class RustRelativityCore {
  private exports: RelativityWasmExports | null = null;
  private lutData = new Float32Array(RELATIVITY_LUT_BYTE_SIZE / 4);

  constructor() {
    this.initWasm();
  }

  private initWasm(): void {
    try {
      const binaryString =
        typeof atob === "function"
          ? atob(RELATIVITY_WASM_BASE64)
          : Buffer.from(RELATIVITY_WASM_BASE64, "base64").toString("binary");

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wasmModule = new WebAssembly.Module(bytes);
      const wasmInstance = new WebAssembly.Instance(wasmModule, {});
      this.exports = wasmInstance.exports as RelativityWasmExports;
    } catch (err) {
      console.error(
        "[RustRelativityCore] Échec de l'instanciation du noyau Rust WASM :",
        err,
      );
    }
  }

  /**
   * Exécute le calcul relativiste en Rust (Horizons r_±, ISCO de Bardeen-Press-Teukolsky,
   * Sphère de Photons prograde/rétrograde, Profil de Novikov-Thorne et Loi de Planck CIE 1931)
   * et retourne le Float32Array (544 octets alignés sur 16 octets) prêt pour WebGPU.
   */
  computeLut(params: RustRelativityParams): Float32Array {
    if (!this.exports) {
      return this.lutData;
    }

    this.exports.compute_relativity_lut(
      params.spin,
      params.diskOuterRadius,
      params.diskTemperatureKelvin,
    );

    const ptr = this.exports.get_relativity_lut_ptr();
    const byteSize = this.exports.get_relativity_lut_byte_size();
    const wasmView = new Float32Array(
      this.exports.memory.buffer,
      ptr,
      byteSize / 4,
    );
    this.lutData.set(wasmView);

    return this.lutData;
  }
}
