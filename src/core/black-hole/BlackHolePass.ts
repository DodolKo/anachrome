import {
  RELATIVITY_LUT_BYTE_SIZE,
  RustRelativityCore,
} from "./rust-relativity";
import { blackHoleWGSL } from "./shaders/black-hole.wgsl";
import {
  BLACK_HOLE_QUALITY_PRESETS,
  type BlackHoleOptions,
  DEFAULT_BLACK_HOLE_OPTIONS,
  type ResolvedBlackHoleOptions,
} from "./types";

/**
 * Passe WebGPU autonome de Simulation Relativiste du Trou Noir de Kerr.
 *
 * S'exécute en amont du pipeline optique `RetroRenderer` :
 * - Lit la texture brute du DOM (`domTexture`, contenant les textes "DOKO")
 * - Intègre les géodésiques nulles dans la métrique de Kerr + LUT Rust WASM
 * - Déforme gravitationnellement le DOM et l'espace-temps (Paraboloïde de Flamm 3D + Grille Tensorielle 3D)
 * - Écrit l'image résultante dans `sceneTexture`, qui traverse ensuite :
 *   Pyramide Mipmap HDR -> CRT -> Aberration Chromatique Sellmeier -> Halation CineStill -> Bloom Airy/Mie -> Grain X-Trans.
 */
export class BlackHolePass {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private relativityLutBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private rustRelativity = new RustRelativityCore();
  private needsLutUpdate = true;

  // 32 valeurs 32-bit = 128 octets alignés sur 16 octets
  private uniformData = new ArrayBuffer(128);
  private uniformFloats = new Float32Array(this.uniformData);
  private uniformUints = new Uint32Array(this.uniformData);

  private options: ResolvedBlackHoleOptions = {
    ...DEFAULT_BLACK_HOLE_OPTIONS,
  };

  // État cinématique temps réel (inertie orbitale & parallaxe curseur)
  private targetCursorX = 0;
  private targetCursorY = 0;
  private smoothCursorX = 0;
  private smoothCursorY = 0;

  private orbitVelTheta = 0;
  private orbitVelPhi = 0;
  private isDraggingOrbit = false;
  private lastTickTimeSec = 0;

  init(device: GPUDevice, targetFormat: GPUTextureFormat = "rgba8unorm"): void {
    this.device = device;

    this.uniformBuffer = device.createBuffer({
      label: "BlackHole_Relativistic_Uniforms",
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.relativityLutBuffer = device.createBuffer({
      label: "Rust_Relativity_Physics_LUT",
      size: RELATIVITY_LUT_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: "BlackHole_Kerr_Geodesic_Shader",
      code: blackHoleWGSL,
    });

    shaderModule.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        if (message.type === "error") {
          console.error(
            `[BlackHole WGSL Error] Ligne ${message.lineNum}:${message.linePos} - ${message.message}`,
          );
        }
      }
    });

    this.pipeline = device.createRenderPipeline({
      label: "BlackHole_Kerr_RenderPipeline",
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs_black_hole" },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_black_hole",
        targets: [{ format: targetFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.needsLutUpdate = true;
  }

  recreateBindGroup(
    linearSampler: GPUSampler,
    domTextureView: GPUTextureView,
  ): void {
    if (
      !this.device ||
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.relativityLutBuffer
    ) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: "BlackHole_Kerr_BindGroup",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.relativityLutBuffer } },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: domTextureView },
      ],
    });
  }

  getOptions(): ResolvedBlackHoleOptions {
    return { ...this.options };
  }

  setOptions(next: Partial<BlackHoleOptions>): void {
    const prevSpin = this.options.spin;
    const prevOuterR = this.options.diskOuterRadius;
    const prevTemp = this.options.diskTemperature;

    let presetPatch: Partial<BlackHoleOptions> = {};
    if (next.quality && next.quality !== this.options.quality) {
      const found = BLACK_HOLE_QUALITY_PRESETS.find(
        (p) => p.id === next.quality,
      );
      if (found) {
        presetPatch = found.patch;
      }
    }

    const mutualGridPatch: Partial<BlackHoleOptions> = {};
    if (
      next.flammGridEnabled === true &&
      next.tensorGridEnabled === undefined
    ) {
      mutualGridPatch.tensorGridEnabled = false;
    } else if (
      next.tensorGridEnabled === true &&
      next.flammGridEnabled === undefined
    ) {
      mutualGridPatch.flammGridEnabled = false;
    } else if (
      next.flammGridEnabled === true &&
      next.tensorGridEnabled === true
    ) {
      mutualGridPatch.flammGridEnabled = false;
    }

    this.options = {
      ...this.options,
      ...presetPatch,
      ...next,
      ...mutualGridPatch,
    };

    if (
      this.options.spin !== prevSpin ||
      this.options.diskOuterRadius !== prevOuterR ||
      this.options.diskTemperature !== prevTemp
    ) {
      this.needsLutUpdate = true;
    }
  }

  setCursorNormalized(nx: number, ny: number): void {
    this.targetCursorX = Math.max(-1, Math.min(1, nx));
    this.targetCursorY = Math.max(-1, Math.min(1, ny));
  }

  setDraggingOrbit(dragging: boolean): void {
    this.isDraggingOrbit = dragging;
  }

  /**
   * Ajoute une impulsion angulaire orbitale (Drag souris / doigt) avec inertie physique
   */
  addOrbitImpulse(deltaPhiDeg: number, deltaThetaDeg: number): void {
    this.options.cameraPhi = (this.options.cameraPhi + deltaPhiDeg) % 360;
    this.options.cameraTheta = Math.max(
      -82,
      Math.min(82, this.options.cameraTheta + deltaThetaDeg),
    );
    this.orbitVelPhi = deltaPhiDeg * 0.45;
    this.orbitVelTheta = deltaThetaDeg * 0.45;
  }

  /**
   * Zoom radial vers ou depuis l'horizon des événements
   */
  addZoomDelta(deltaDistanceM: number): void {
    this.options.cameraDistance = Math.max(
      6.5,
      Math.min(38.0, this.options.cameraDistance + deltaDistanceM),
    );
  }

  private updateRustRelativityLut(): void {
    if (!this.device || !this.relativityLutBuffer || !this.needsLutUpdate) {
      return;
    }
    this.needsLutUpdate = false;

    const lutFloats = this.rustRelativity.computeLut({
      spin: this.options.spin,
      diskOuterRadius: this.options.diskOuterRadius,
      diskTemperatureKelvin: this.options.diskTemperature,
    });

    this.device.queue.writeBuffer(
      this.relativityLutBuffer,
      0,
      lutFloats.buffer,
      lutFloats.byteOffset,
      lutFloats.byteLength,
    );
  }

  /**
   * Met à jour la cinématique orbitale, écrit les uniforms et encode la passe GPU vers `targetSceneView`.
   */
  encodePass(
    encoder: GPUCommandEncoder,
    targetSceneView: GPUTextureView,
    width: number,
    height: number,
    timeSec: number,
  ): void {
    if (
      !this.device ||
      !this.pipeline ||
      !this.bindGroup ||
      !this.uniformBuffer
    ) {
      return;
    }

    const dt =
      this.lastTickTimeSec > 0
        ? Math.min(0.1, Math.max(0.001, timeSec - this.lastTickTimeSec))
        : 0.016;
    this.lastTickTimeSec = timeSec;

    // 1. Amortissement exponentiel fluide du curseur (parallaxe gravitationnelle)
    const smoothFactor = 1.0 - Math.exp(-dt * 8.5);
    this.smoothCursorX +=
      (this.targetCursorX - this.smoothCursorX) * smoothFactor;
    this.smoothCursorY +=
      (this.targetCursorY - this.smoothCursorY) * smoothFactor;

    // 2. Inertie orbitale après relâchement du drag + dérive orbitale autonome
    if (!this.isDraggingOrbit) {
      if (
        Math.abs(this.orbitVelPhi) > 0.001 ||
        Math.abs(this.orbitVelTheta) > 0.001
      ) {
        this.options.cameraPhi =
          (this.options.cameraPhi + this.orbitVelPhi) % 360;
        this.options.cameraTheta = Math.max(
          -82,
          Math.min(82, this.options.cameraTheta + this.orbitVelTheta),
        );
        const damping = Math.exp(-dt * 5.5);
        this.orbitVelPhi *= damping;
        this.orbitVelTheta *= damping;
      } else if (Math.abs(this.options.autoOrbitSpeed) > 0.0005) {
        this.options.cameraPhi =
          (this.options.cameraPhi +
            this.options.autoOrbitSpeed * dt * (180 / Math.PI)) %
          360;
      }
    }

    // 3. Mise à jour éventuelle de la LUT relativiste Rust WASM
    this.updateRustRelativityLut();

    // 4. Écriture des 28 valeurs 32-bit (112 octets)
    const f32 = this.uniformFloats;
    const u32 = this.uniformUints;

    f32[0] = width;
    f32[1] = height;
    f32[2] = timeSec;
    f32[3] = this.options.mass;

    f32[4] = this.options.spin;
    f32[5] = this.options.cameraTheta;
    f32[6] = this.options.cameraPhi;
    f32[7] = this.options.cameraRoll;

    f32[8] = this.options.cameraDistance;
    f32[9] = this.smoothCursorX;
    f32[10] = this.smoothCursorY;
    f32[11] = this.options.cursorParallax;

    f32[12] = this.options.lensingStrength;
    f32[13] = this.options.domLensingStrength;
    f32[14] = this.options.photonRingIntensity;
    u32[15] = this.options.diskEnabled ? 1 : 0;

    f32[16] = this.options.diskIntensity;
    f32[17] = this.options.diskOuterRadius;
    f32[18] = this.options.dopplerStrength;
    f32[19] = this.options.turbulenceScale;

    u32[20] = this.options.jetsEnabled ? 1 : 0;
    f32[21] = this.options.jetsIntensity;
    u32[22] = this.options.flammGridEnabled ? 1 : 0;
    f32[23] = this.options.flammGridIntensity;

    u32[24] = this.options.tensorGridEnabled ? 1 : 0;
    f32[25] = this.options.tensorGridIntensity;
    f32[26] = this.options.gridDensity;
    f32[27] = this.options.starfieldIntensity;

    u32[28] = Math.max(
      20,
      Math.min(128, Math.round(this.options.raymarchSteps || 64)),
    );
    f32[29] = Math.max(0.35, Math.min(1.0, this.options.renderScale || 0.75));
    f32[30] = 0.0;
    f32[31] = 0.0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const pass = encoder.beginRenderPass({
      label: "BlackHole_Kerr_Relativistic_Pass",
      colorAttachments: [
        {
          view: targetSceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }
    if (this.relativityLutBuffer) {
      this.relativityLutBuffer.destroy();
      this.relativityLutBuffer = null;
    }
    this.pipeline = null;
    this.bindGroup = null;
    this.device = null;
  }
}
