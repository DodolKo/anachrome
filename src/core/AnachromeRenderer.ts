import {
  type BlackHoleOptions,
  DEFAULT_BLACK_HOLE_OPTIONS,
  type ResolvedBlackHoleOptions,
} from "./black-hole/types";
import { BlackHolePass } from "./black-hole/BlackHolePass";
import { DomSceneMirror } from "./DomSceneMirror";
import { OPTICAL_LUT_BYTE_SIZE, RustOpticalCore } from "./rust-optics";
import { bloomPyramidWGSL } from "./shaders/modules/bloom.wgsl";
import { postprocessWGSL } from "./shaders/postprocess.wgsl";

export interface BloomOptions {
  /** Active ou débranche complètement le module de Bloom optique. Par défaut : true */
  enabled?: boolean;
  /** Intensité énergétique globale du Bloom (0.0 à 2.0). Par défaut : 0.45 */
  intensity?: number;
  /** Seuil de luminance HDR d'extraction des hautes lumières (0.1 à 1.5). Par défaut : 0.52 */
  threshold?: number;
  /** Douceur du genou d'extraction quadratique C2 (0.1 à 1.0). Par défaut : 0.65 */
  softKnee?: number;
  /** Rayon spatial de diffusion de la pyramide Mipmap (0.5 à 3.0). Par défaut : 1.25 */
  radius?: number;
  /** Échelle de la tache de diffraction d'Airy J_1(x) calculée en Rust. Par défaut : 1.1 */
  airyScale?: number;
  /** Exposant γ de diffusion de Mie dans les verres optiques (1.1 = halo large, 2.2 = serré). Par défaut : 1.42 */
  mieGamma?: number;
  /** Facteur d'étirement anamorphique horizontal (1.0 = sphérique, 1.4..2.0 = flare cinéma). Par défaut : 1.35 */
  anamorphicSqueeze?: number;
  /** Teinte bleutée/cyan du traitement antireflet multicouche MgF2 / Zeiss T* (0.0 à 1.0). Par défaut : 0.45 */
  anamorphicTint?: number;
}

export interface HalationOptions {
  /** Active ou débranche complètement le module d'Halation photochimique. Par défaut : true */
  enabled?: boolean;
  /** Intensité de la rétrodiffusion rouge-orangée sur le support dorsal (0.0 à 2.0). Par défaut : 0.72 */
  intensity?: number;
  /** Rayon d'étalement dans le support en triacétate (0.5 à 3.0). Par défaut : 1.35 */
  radius?: number;
  /** Épaisseur physique du support dorsal en triacétate en µm (typ. 125 µm Kodak Vision3). Par défaut : 135.0 */
  filmThicknessUm?: number;
  /** Taux d'absence de couche anti-halo Remjet (0.1 = Kodak standard, 1.0 = CineStill 800T pur). Par défaut : 0.92 */
  remjetRemoval?: number;
}

export interface ChromaticAberrationOptions {
  /** Active ou débranche complètement le module d'Aberration Chromatique spectrale. Par défaut : true */
  enabled?: boolean;
  /** Force de l'Aberration Chromatique Latérale (TCA) vers les 4 coins (0.0 à 0.08). Par défaut : 0.018 */
  strength?: number;
  /** Force du Sphérochromatisme Axial (LCA) en pixels de cercle de confusion (0.0 à 4.0). Par défaut : 1.25 */
  axialStrength?: number;
  /** Nombre d'Abbe V_d du verre optique pour l'équation de Sellmeier en Rust (22 = très dispersif, 64 = apochromatique). Par défaut : 31.0 */
  abbeNumber?: number;
  /** Ouverture géométrique f-stop (ex: 1.4, 2.0, 2.8, 5.6). Par défaut : 1.4 */
  apertureFStop?: number;
  /** Coefficient linéaire de grandissement chromatique de Seidel k1. Par défaut : 0.85 */
  seidelK1?: number;
  /** Coefficient cubique de distorsion radiale de Seidel k3 (amplifie la dispersion dans les 4 coins). Par défaut : 0.75 */
  seidelK3?: number;
  /** Force d'occultation du bord HTML brut sous le spectre réfracté (0.0 à 1.0). Par défaut : 1.0 */
  domMaskStrength?: number;
}

export interface CrtOptions {
  /** Active ou débranche complètement le module de bombage d'écran / tube cathodique. Par défaut : true */
  enabled?: boolean;
  /** Bombage horizontal sur l'axe X (0.0 = plat sur X, 0.08..0.25 = tube galbé X). Par défaut : 0.065 */
  curvatureX?: number;
  /** Bombage vertical sur l'axe Y (0.0 = plat sur Y, 0.08..0.25 = tube galbé Y). Par défaut : 0.085 */
  curvatureY?: number;
  /** Facteur d'échelle / overscan du tube (0.85 à 1.20, 1.0 = bords naturels). Par défaut : 1.0 */
  scale?: number;
  /** Vignettage optique aux bords du verre cathodique (0.0 à 1.0). Par défaut : 0.28 */
  vignette?: number;
  /** Active ou débranche les scanlines cathodiques Beam-Aware (qui préservent le Bloom/Halation). Par défaut : false */
  scanlinesEnabled?: boolean;
  /** Intensité / profondeur des scanlines (0.0 à 1.0). Par défaut : 0.25 */
  scanlineIntensity?: number;
  /** Finesse / densité verticale des scanlines (0.25 à 2.0). Par défaut : 1.0 */
  scanlineDensity?: number;
}

export interface GrainOptions {
  /** Active ou débranche complètement le module de grain capteur Fujifilm X-Trans. Par défaut : true */
  enabled?: boolean;
  /** Alias rétrocompatible pour `enabled` */
  grainEnabled?: boolean;
  /** Sensibilité du capteur (de 20 à 64000 : grossit et densifie organiquement le grain style Fujifilm). Par défaut : 800 */
  iso?: number;
  /** Vitesse / cadence du grain en images par seconde (18.0, 24.0 cinéma, 30.0, 48.0). Par défaut : 24.0 */
  fps?: number;
  /** Micro-persistance temporelle anti-saccade entre deux trames de grain (0.0 à 1.0). Par défaut : 0.55 */
  persistence?: number;
  /** Intensité globale perçue du grain (0.065 par défaut). */
  intensity?: number;
  /** Bruit chromatique : 0.0 = pur monochrome, 0.05..1.0 = grain couleur X-Trans. Par défaut : 0.15 */
  chromaAmount?: number;
  /** Échelle / finesse de base du grain (1.0 = pixel physique natif 1:1). Par défaut : 1.0 */
  grainScale?: number;
  /** Alias pour `grainScale` */
  scale?: number;
  /** Ratio micro-grain haute fréquence (0.75 par défaut). */
  microRatio?: number;
  /** Ratio meso-grain moyenne fréquence (0.25 par défaut). */
  mesoRatio?: number;
  /** Échelle des amas organiques de dématriçage (0.50 par défaut). */
  mesoScale?: number;
}

export interface ResolvedGrainOptions {
  enabled: boolean;
  iso: number;
  fps: number;
  persistence: number;
  intensity: number;
  chromaAmount: number;
  grainScale: number;
  microRatio: number;
  mesoRatio: number;
  mesoScale: number;
}

export interface SensorNoiseOptions {
  /** Configuration modulaire du Grain Capteur Fujifilm X-Trans */
  grain?: GrainOptions;

  /** @deprecated Utiliser `grain.enabled` */
  grainEnabled?: boolean;
  /** @deprecated Utiliser `grain.grainScale` */
  grainScale?: number;
  /** @deprecated Utiliser `grain.fps` */
  fps?: number;
  /** @deprecated Utiliser `grain.persistence` */
  persistence?: number;
  /** @deprecated Utiliser `grain.intensity` */
  intensity?: number;
  /** @deprecated Utiliser `grain.microRatio` */
  microRatio?: number;
  /** @deprecated Utiliser `grain.mesoRatio` */
  mesoRatio?: number;
  /** @deprecated Utiliser `grain.mesoScale` */
  mesoScale?: number;
  /** @deprecated Utiliser `grain.iso` */
  iso?: number;
  /** @deprecated Utiliser `grain.chromaAmount` */
  chromaAmount?: number;

  /** Configuration modulaire indépendante du Bloom Optique (Airy + Mie + Anamorphic) */
  bloom?: BloomOptions;
  /** Configuration modulaire indépendante de l'Halation Argentique (Kodak Vision3 / CineStill 800T) */
  halation?: HalationOptions;
  /** Configuration modulaire indépendante de l'Aberration Chromatique Spectrale (Sellmeier + CIE 1931) */
  chromaticAberration?: ChromaticAberrationOptions;
  /** Configuration modulaire indépendante du Bombage d'Écran (CRT X/Y) & Scanlines */
  crt?: CrtOptions;
  /** Configuration modulaire indépendante de la Simulation Relativiste du Trou Noir de Kerr */
  blackHole?: BlackHoleOptions;
}

export interface ResolvedOptions {
  grainEnabled: boolean;
  grainScale: number;
  fps: number;
  persistence: number;
  intensity: number;
  microRatio: number;
  mesoRatio: number;
  mesoScale: number;
  iso: number;
  chromaAmount: number;
  grain?: ResolvedGrainOptions;
  bloom: Required<BloomOptions>;
  halation: Required<HalationOptions>;
  chromaticAberration: Required<ChromaticAberrationOptions>;
  crt: Required<CrtOptions>;
  blackHole: ResolvedBlackHoleOptions;
}

const MIP_CHAIN_COUNT = 5;

/**
 * Moteur de Rendu Optique & Photochimique WebGPU + Rust WASM :
 * - Étage 1 : Aberration Chromatique Spectrale Continue (12 bandes Sellmeier + CIE 1931 + Seidel r^3/r^5 + LCA)
 * - Étage 2 : Halation Photochimique Tricouche (Beer-Lambert + Réflexion Totale de Fresnel + Hurter-Driffield)
 * - Étage 3 : Bloom Optique Pyramidal HDR rgba16float (Diffraction d'Airy Bessel J_1 + Diffusion de Mie + Flare Anamorphique)
 * - Étage 4 : Sensor Noise Fujifilm X-Trans 6x6 (PCG3D + Box-Muller + Persistance Temporelle C2)
 *
 * Chaque étage est 100% indépendant et peut être débranché à chaud sans coût GPU superflu.
 */
export class AnachromeRenderer {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = "bgra8unorm";

  // Noyau physique Rust compilé en WebAssembly (wasm32-unknown-unknown)
  private rustOptics = new RustOpticalCore();
  private domMirror: DomSceneMirror | null = null;
  private blackHolePass = new BlackHolePass();

  // Pipelines de rendu
  private mainPipeline: GPURenderPipeline | null = null;
  private prefilterPipeline: GPURenderPipeline | null = null;
  private downsamplePipeline: GPURenderPipeline | null = null;

  // Samplers & Buffers
  private linearSampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private opticalLutBuffer: GPUBuffer | null = null;
  private mipUniformBuffers: GPUBuffer[] = [];

  // Textures de scène & Pyramide Mipmap HDR (rgba16float)
  private domTexture: GPUTexture | null = null;
  private sceneTexture: GPUTexture | null = null;
  private sceneWidth = 0;
  private sceneHeight = 0;
  private mipTextures: GPUTexture[] = [];
  private mipDimensions: Array<[number, number]> = [];
  private needsDomCopyToScene = true;

  // BindGroups
  private mainBindGroup: GPUBindGroup | null = null;
  private mipBindGroups: GPUBindGroup[] = [];

  // Données Uniforms principales (144 octets alignés sur 16 octets = 36 valeurs 32-bit)
  private uniformBufferData = new ArrayBuffer(144);
  private uniformFloats = new Float32Array(this.uniformBufferData);
  private uniformUints = new Uint32Array(this.uniformBufferData);

  private static activeInstance: AnachromeRenderer | null = null;
  private static listeners = new Set<
    (renderer: AnachromeRenderer | null) => void
  >();

  static getActiveInstance(): AnachromeRenderer | null {
    return AnachromeRenderer.activeInstance;
  }

  static subscribe(
    listener: (renderer: AnachromeRenderer | null) => void,
  ): () => void {
    AnachromeRenderer.listeners.add(listener);
    listener(AnachromeRenderer.activeInstance);
    return () => {
      AnachromeRenderer.listeners.delete(listener);
    };
  }

  private static notifyListeners(): void {
    for (const listener of AnachromeRenderer.listeners) {
      listener(AnachromeRenderer.activeInstance);
    }
  }

  private rafId: number | null = null;
  private isDestroyed = false;

  private pendingDeviceWidth = 0;
  private pendingDeviceHeight = 0;
  private hasDevicePixelSize = false;

  private needsRender = true;
  private needsOpticsLutUpdate = true;
  private needsPyramidUpdate = true;

  private lastFrameTime = 0;
  private currentFrameIndex = 1;
  private currentTemporalBlend = 1.0;

  private options: ResolvedOptions = {
    grainEnabled: true,
    grainScale: 1.0,
    fps: 24.0,
    persistence: 0.55,
    intensity: 0.065,
    microRatio: 0.75,
    mesoRatio: 0.25,
    mesoScale: 0.5,
    iso: 800,
    chromaAmount: 0.15,
    grain: {
      enabled: true,
      grainScale: 1.0,
      fps: 24.0,
      persistence: 0.55,
      intensity: 0.065,
      microRatio: 0.75,
      mesoRatio: 0.25,
      mesoScale: 0.5,
      iso: 800,
      chromaAmount: 0.15,
    },
    bloom: {
      enabled: true,
      intensity: 0.45,
      threshold: 0.52,
      softKnee: 0.65,
      radius: 1.25,
      airyScale: 1.1,
      mieGamma: 1.42,
      anamorphicSqueeze: 1.35,
      anamorphicTint: 0.45,
    },
    halation: {
      enabled: true,
      intensity: 0.72,
      radius: 1.35,
      filmThicknessUm: 135.0,
      remjetRemoval: 0.92,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.018,
      axialStrength: 1.25,
      abbeNumber: 31.0,
      apertureFStop: 1.4,
      seidelK1: 0.85,
      seidelK3: 0.75,
      domMaskStrength: 1.0,
    },
    crt: {
      enabled: true,
      curvatureX: 0.065,
      curvatureY: 0.085,
      scale: 1.0,
      vignette: 0.28,
      scanlinesEnabled: false,
      scanlineIntensity: 0.25,
      scanlineDensity: 1.0,
    },
    blackHole: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
    },
  };

  constructor(canvas: HTMLCanvasElement, options?: SensorNoiseOptions) {
    this.canvas = canvas;
    if (options) {
      this.setOptions(options);
    }
    AnachromeRenderer.activeInstance = this;
    AnachromeRenderer.notifyListeners();
  }

  getBlackHolePass(): BlackHolePass {
    return this.blackHolePass;
  }

  syncBlackHoleStateFromPass(): void {
    this.options.blackHole = this.blackHolePass.getOptions();
    this.needsPyramidUpdate = true;
    this.needsRender = true;
    AnachromeRenderer.notifyListeners();
  }

  getOptions(): ResolvedOptions {
    const grain: ResolvedGrainOptions = {
      enabled: this.options.grainEnabled,
      iso: this.options.iso,
      fps: this.options.fps,
      persistence: this.options.persistence,
      intensity: this.options.intensity,
      chromaAmount: this.options.chromaAmount,
      grainScale: this.options.grainScale,
      microRatio: this.options.microRatio,
      mesoRatio: this.options.mesoRatio,
      mesoScale: this.options.mesoScale,
    };
    return {
      ...this.options,
      grain,
      bloom: { ...this.options.bloom },
      halation: { ...this.options.halation },
      chromaticAberration: { ...this.options.chromaticAberration },
      crt: { ...this.options.crt },
      blackHole: { ...this.options.blackHole },
    };
  }

  updateOptions(options: Partial<SensorNoiseOptions>): void {
    this.setOptions(options);
  }

  setOptions(options: Partial<SensorNoiseOptions>): void {
    const prevBloom = this.options.bloom;
    const prevHalation = this.options.halation;
    const prevCA = this.options.chromaticAberration;
    const prevCrt = this.options.crt;
    const prevBH = this.options.blackHole;

    const grainOpt = options.grain;
    const grainEnabledVal =
      grainOpt?.enabled ?? grainOpt?.grainEnabled ?? options.grainEnabled;
    const grainScaleVal =
      grainOpt?.grainScale ?? grainOpt?.scale ?? options.grainScale;
    const fpsVal = grainOpt?.fps ?? options.fps;
    const persistenceVal = grainOpt?.persistence ?? options.persistence;
    const intensityVal = grainOpt?.intensity ?? options.intensity;
    const microRatioVal = grainOpt?.microRatio ?? options.microRatio;
    const mesoRatioVal = grainOpt?.mesoRatio ?? options.mesoRatio;
    const mesoScaleVal = grainOpt?.mesoScale ?? options.mesoScale;
    const isoVal = grainOpt?.iso ?? options.iso;
    const chromaAmountVal = grainOpt?.chromaAmount ?? options.chromaAmount;

    const nextGrainEnabled =
      grainEnabledVal !== undefined ? grainEnabledVal : this.options.grainEnabled;
    const nextGrainScale =
      grainScaleVal !== undefined ? grainScaleVal : this.options.grainScale;
    const nextFps = fpsVal !== undefined ? fpsVal : this.options.fps;
    const nextPersistence =
      persistenceVal !== undefined ? persistenceVal : this.options.persistence;
    const nextIntensity =
      intensityVal !== undefined ? intensityVal : this.options.intensity;
    const nextMicroRatio =
      microRatioVal !== undefined ? microRatioVal : this.options.microRatio;
    const nextMesoRatio =
      mesoRatioVal !== undefined ? mesoRatioVal : this.options.mesoRatio;
    const nextMesoScale =
      mesoScaleVal !== undefined ? mesoScaleVal : this.options.mesoScale;
    const nextIso = isoVal !== undefined ? isoVal : this.options.iso;
    const nextChromaAmount =
      chromaAmountVal !== undefined ? chromaAmountVal : this.options.chromaAmount;

    this.options = {
      ...this.options,
      grainEnabled: nextGrainEnabled,
      grainScale: nextGrainScale,
      fps: nextFps,
      persistence: nextPersistence,
      intensity: nextIntensity,
      microRatio: nextMicroRatio,
      mesoRatio: nextMesoRatio,
      mesoScale: nextMesoScale,
      iso: nextIso,
      chromaAmount: nextChromaAmount,
      grain: {
        enabled: nextGrainEnabled,
        grainScale: nextGrainScale,
        fps: nextFps,
        persistence: nextPersistence,
        intensity: nextIntensity,
        microRatio: nextMicroRatio,
        mesoRatio: nextMesoRatio,
        mesoScale: nextMesoScale,
        iso: nextIso,
        chromaAmount: nextChromaAmount,
      },
      bloom: {
        ...prevBloom,
        ...(options.bloom || {}),
      },
      halation: {
        ...prevHalation,
        ...(options.halation || {}),
      },
      chromaticAberration: {
        ...prevCA,
        ...(options.chromaticAberration || {}),
      },
      crt: {
        ...prevCrt,
        ...(options.crt || {}),
      },
      blackHole: {
        ...prevBH,
        ...(options.blackHole || {}),
      },
    };

    this.blackHolePass.setOptions(options.blackHole || this.options.blackHole);
    this.options.blackHole = this.blackHolePass.getOptions();
    if (!this.options.blackHole.enabled && prevBH.enabled) {
      this.needsDomCopyToScene = true;
    }

    const effectiveScale = this.options.blackHole.enabled
      ? Math.max(0.35, Math.min(1.0, this.options.blackHole.renderScale))
      : 1.0;
    const prevEffectiveScale = prevBH.enabled
      ? Math.max(0.35, Math.min(1.0, prevBH.renderScale))
      : 1.0;

    if (
      Math.abs(effectiveScale - prevEffectiveScale) > 0.005 &&
      this.canvas.width > 0 &&
      this.canvas.height > 0
    ) {
      this.recreateSceneTargetOnly(this.canvas.width, this.canvas.height);
    }

    this.needsOpticsLutUpdate = true;
    this.needsPyramidUpdate = true;
    this.needsRender = true;
    AnachromeRenderer.notifyListeners();
  }

  async init(): Promise<boolean> {
    if (typeof window === "undefined" || !navigator.gpu) {
      console.warn("[AnachromeRenderer] WebGPU non supporté par ce navigateur.");
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter || this.isDestroyed) return false;

      this.device = await adapter.requestDevice();
      if (this.isDestroyed) {
        this.device.destroy();
        return false;
      }

      this.device.onuncapturederror = (e) => {
        if (!this.isDestroyed) {
          console.error(
            "[AnachromeRenderer] Erreur WebGPU :",
            e.error?.message || e.error,
          );
        }
      };

      this.context = this.canvas.getContext("webgpu");
      if (!this.context) return false;

      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "premultiplied",
      });

      const ignoreRoot = this.canvas.parentElement || this.canvas;
      this.domMirror = new DomSceneMirror(ignoreRoot);

      this.setupPipelines();

      if (this.pendingDeviceWidth > 0 && this.pendingDeviceHeight > 0) {
        this.applyDeviceSize(this.pendingDeviceWidth, this.pendingDeviceHeight);
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width || window.innerWidth;
        const cssH = rect.height || window.innerHeight;
        this.resize(cssW, cssH);
      }

      this.startLoop();
      return true;
    } catch (err) {
      console.error("[AnachromeRenderer] Échec de l'initialisation WebGPU :", err);
      return false;
    }
  }

  private setupPipelines(): void {
    if (!this.device) return;

    this.linearSampler = this.device.createSampler({
      label: "Optical_Linear_Sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.uniformBuffer = this.device.createBuffer({
      label: "Retro_Main_Uniforms",
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.opticalLutBuffer = this.device.createBuffer({
      label: "Rust_Optical_Physics_LUT",
      size: OPTICAL_LUT_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.mipUniformBuffers = [];
    for (let i = 0; i < MIP_CHAIN_COUNT; i++) {
      this.mipUniformBuffers.push(
        this.device.createBuffer({
          label: `HDR_Mip_Uniform_${i}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      );
    }

    // 1. Compilation du Shader de Pyramide HDR (Downsample 13-taps Jiménez + Hurter-Driffield)
    const pyramidModule = this.device.createShaderModule({
      label: "HDR_Optical_Pyramid_Shader",
      code: bloomPyramidWGSL,
    });

    pyramidModule.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        if (message.type === "error") {
          console.error(
            `[Pyramid WGSL Error] Ligne ${message.lineNum}:${message.linePos} - ${message.message}`,
          );
        }
      }
    });

    this.prefilterPipeline = this.device.createRenderPipeline({
      label: "HDR_Prefilter_Pipeline",
      layout: "auto",
      vertex: { module: pyramidModule, entryPoint: "vs_mip" },
      fragment: {
        module: pyramidModule,
        entryPoint: "fs_prefilter_downsample",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.downsamplePipeline = this.device.createRenderPipeline({
      label: "HDR_Downsample_Pipeline",
      layout: "auto",
      vertex: { module: pyramidModule, entryPoint: "vs_mip" },
      fragment: {
        module: pyramidModule,
        entryPoint: "fs_mip_downsample",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });

    // 2. Compilation du Shader Principal de Composition Optique & Grain X-Trans
    const mainModule = this.device.createShaderModule({
      label: "Retro_Optical_Postprocess_Shader",
      code: postprocessWGSL,
    });

    mainModule.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        if (message.type === "error") {
          console.error(
            `[Postprocess WGSL Error] Ligne ${message.lineNum}:${message.linePos} - ${message.message}`,
          );
        }
      }
    });

    this.mainPipeline = this.device.createRenderPipeline({
      label: "Retro_Main_RenderPipeline",
      layout: "auto",
      vertex: { module: mainModule, entryPoint: "vs_main" },
      fragment: {
        module: mainModule,
        entryPoint: "fs_main",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });

    // 3. Initialisation de la passe 3D amont : Trou Noir Relativiste de Kerr
    this.blackHolePass.init(this.device, "rgba8unorm");
    this.blackHolePass.setOptions(this.options.blackHole);
  }

  private recreateRenderTargets(width: number, height: number): void {
    if (
      !this.device ||
      !this.mainPipeline ||
      !this.prefilterPipeline ||
      !this.downsamplePipeline ||
      !this.linearSampler ||
      !this.uniformBuffer ||
      !this.opticalLutBuffer
    ) {
      return;
    }

    if (this.domTexture) {
      this.domTexture.destroy();
    }
    if (this.sceneTexture) {
      this.sceneTexture.destroy();
    }
    for (const tex of this.mipTextures) {
      tex.destroy();
    }
    this.mipTextures = [];
    this.mipDimensions = [];
    this.mipBindGroups = [];

    // Texture brute recevant la rastérisation du miroir DOM ("DOKO")
    this.domTexture = this.device.createTexture({
      label: "DOM_Raw_Mirror_Texture",
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.blackHolePass.recreateBindGroup(
      this.linearSampler,
      this.domTexture.createView(),
    );

    // Pyramide Mipmap HDR 5 niveaux en virgule flottante 16-bit (rgba16float)
    let mipW = width;
    let mipH = height;
    for (let i = 0; i < MIP_CHAIN_COUNT; i++) {
      mipW = Math.max(1, Math.floor(mipW / 2));
      mipH = Math.max(1, Math.floor(mipH / 2));
      this.mipDimensions.push([mipW, mipH]);

      const mipTex = this.device.createTexture({
        label: `HDR_Pyramid_Mip_${i}_${mipW}x${mipH}`,
        size: [mipW, mipH],
        format: "rgba16float",
        usage:
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.mipTextures.push(mipTex);
    }

    this.recreateSceneTargetOnly(width, height);

    if (this.domMirror) {
      this.domMirror.resize(width, height);
    }
    this.needsPyramidUpdate = true;
    this.needsRender = true;
  }

  /**
   * Recrée uniquement `sceneTexture` (et les BindGroups qui la lisent : `mipBindGroups[0]` et `mainBindGroup`)
   * à l'échelle `blackHole.renderScale` lorsque le Trou Noir est actif, ou en 1:1 s'il est coupé.
   * Permet de diviser par 2 à 4 le nombre de rayons intégrés sur GPU sans toucher au reste du pipeline.
   */
  private recreateSceneTargetOnly(width: number, height: number): void {
    if (
      !this.device ||
      !this.mainPipeline ||
      !this.prefilterPipeline ||
      !this.downsamplePipeline ||
      !this.linearSampler ||
      !this.uniformBuffer ||
      !this.opticalLutBuffer ||
      this.mipTextures.length < MIP_CHAIN_COUNT
    ) {
      return;
    }

    const scale = this.options.blackHole.enabled
      ? Math.max(0.35, Math.min(1.0, this.options.blackHole.renderScale))
      : 1.0;

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    if (this.sceneTexture) {
      this.sceneTexture.destroy();
    }

    this.sceneWidth = targetW;
    this.sceneHeight = targetH;

    this.sceneTexture = this.device.createTexture({
      label: `DOM_Scene_Source_Texture_${targetW}x${targetH}`,
      size: [targetW, targetH],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.needsDomCopyToScene = true;
    this.mipBindGroups = [];

    for (let i = 0; i < MIP_CHAIN_COUNT; i++) {
      const pipeline =
        i === 0 ? this.prefilterPipeline : this.downsamplePipeline;
      const srcView =
        i === 0
          ? this.sceneTexture.createView()
          : this.mipTextures[i - 1].createView();

      this.mipBindGroups.push(
        this.device.createBindGroup({
          label: `HDR_Mip_BindGroup_${i}`,
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.mipUniformBuffers[i] } },
            { binding: 1, resource: srcView },
            { binding: 2, resource: this.linearSampler },
          ],
        }),
      );
    }

    this.mainBindGroup = this.device.createBindGroup({
      label: "Retro_Main_BindGroup",
      layout: this.mainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.opticalLutBuffer } },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: this.sceneTexture.createView() },
        { binding: 4, resource: this.mipTextures[0].createView() },
        { binding: 5, resource: this.mipTextures[1].createView() },
        { binding: 6, resource: this.mipTextures[2].createView() },
        { binding: 7, resource: this.mipTextures[3].createView() },
        { binding: 8, resource: this.mipTextures[4].createView() },
      ],
    });
  }

  private updateRustOpticalLut(): void {
    if (!this.device || !this.opticalLutBuffer || !this.needsOpticsLutUpdate) {
      return;
    }
    this.needsOpticsLutUpdate = false;

    const lutFloats = this.rustOptics.computeLut({
      abbeNumber: this.options.chromaticAberration.abbeNumber,
      apertureFStop: this.options.chromaticAberration.apertureFStop,
      seidelK1: this.options.chromaticAberration.seidelK1,
      seidelK3: this.options.chromaticAberration.seidelK3,
      airyBloomScale: this.options.bloom.airyScale,
      mieGamma: this.options.bloom.mieGamma,
      anamorphicSqueeze: this.options.bloom.anamorphicSqueeze,
      filmThicknessUm: this.options.halation.filmThicknessUm,
      remjetRemoval: this.options.halation.remjetRemoval,
    });

    this.device.queue.writeBuffer(
      this.opticalLutBuffer,
      0,
      lutFloats.buffer,
      lutFloats.byteOffset,
      lutFloats.byteLength,
    );
  }

  private updateMipUniforms(): void {
    if (!this.device || this.mipDimensions.length < MIP_CHAIN_COUNT) return;

    const mipBuf = new ArrayBuffer(32);
    const f32 = new Float32Array(mipBuf);
    const u32 = new Uint32Array(mipBuf);

    for (let i = 0; i < MIP_CHAIN_COUNT; i++) {
      const srcW =
        i === 0
          ? this.sceneWidth || this.canvas.width
          : this.mipDimensions[i - 1][0];
      const srcH =
        i === 0
          ? this.sceneHeight || this.canvas.height
          : this.mipDimensions[i - 1][1];

      f32[0] = 1.0 / Math.max(1, srcW);
      f32[1] = 1.0 / Math.max(1, srcH);
      f32[2] = this.options.bloom.threshold;
      f32[3] = this.options.bloom.softKnee;
      f32[4] = this.options.bloom.anamorphicSqueeze;
      u32[5] = i;
      u32[6] = this.options.chromaticAberration.enabled ? 1 : 0;
      f32[7] = this.options.chromaticAberration.strength;

      this.device.queue.writeBuffer(this.mipUniformBuffers[i], 0, mipBuf);
    }
  }

  private applyDeviceSize(deviceWidth: number, deviceHeight: number): void {
    const width = Math.max(1, Math.round(deviceWidth));
    const height = Math.max(1, Math.round(deviceHeight));

    this.pendingDeviceWidth = width;
    this.pendingDeviceHeight = height;

    if (this.isDestroyed || !this.context || !this.device) return;

    if (
      this.canvas.width !== width ||
      this.canvas.height !== height ||
      !this.sceneTexture
    ) {
      this.canvas.width = width;
      this.canvas.height = height;

      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "premultiplied",
      });

      this.recreateRenderTargets(width, height);
    }
  }

  resizeDevicePixels(deviceWidth: number, deviceHeight: number): void {
    this.hasDevicePixelSize = true;
    this.applyDeviceSize(deviceWidth, deviceHeight);
  }

  resize(cssWidth: number, cssHeight: number): void {
    if (this.hasDevicePixelSize) return;
    const dpr = window.devicePixelRatio || 1;
    this.applyDeviceSize(cssWidth * dpr, cssHeight * dpr);
  }

  /**
   * Force la re-capture immédiate de la scène DOM au prochain rafraîchissement
   */
  refreshDomScene(): void {
    this.domMirror?.markDirty();
    this.needsRender = true;
  }

  private startLoop(): void {
    const render = (timeMs: number) => {
      if (
        this.isDestroyed ||
        !this.device ||
        !this.context ||
        !this.mainPipeline ||
        !this.prefilterPipeline ||
        !this.downsamplePipeline ||
        !this.mainBindGroup ||
        !this.uniformBuffer ||
        !this.sceneTexture
      ) {
        return;
      }

      if (this.canvas.width > 0 && this.canvas.height > 0) {
        const bhEnabled = this.options.blackHole.enabled;
        const anyOpticalEnabled =
          bhEnabled ||
          this.options.bloom.enabled ||
          this.options.halation.enabled ||
          this.options.chromaticAberration.enabled ||
          this.options.crt.enabled;

        // 1. Synchronisation DOM -> Texture GPU (uniquement si un effet optique est actif et que le DOM a muté)
        if (anyOpticalEnabled && this.domMirror && this.domTexture) {
          const domUpdated = this.domMirror.syncToGpuTexture(
            this.device,
            this.domTexture,
          );
          if (domUpdated) {
            this.needsDomCopyToScene = true;
            this.needsPyramidUpdate = true;
            this.needsRender = true;
          }
        }

        // Si la simulation relativiste du Trou Noir est active, le plasma MRI et l'orbite évoluent en continu
        if (bhEnabled) {
          this.needsPyramidUpdate = true;
          this.needsRender = true;
        }

        // 2. Cadence temporelle du grain Fujifilm X-Trans
        if (this.options.grainEnabled) {
          const targetFps = this.options.fps;
          const persistence = Math.min(
            1.0,
            Math.max(0.0, this.options.persistence),
          );

          if (targetFps > 0) {
            const frameInterval = 1000 / targetFps;
            if (this.lastFrameTime === 0) {
              this.lastFrameTime = timeMs;
            }
            let elapsed = timeMs - this.lastFrameTime;

            if (elapsed >= frameInterval) {
              const steps = Math.min(Math.floor(elapsed / frameInterval), 10);
              this.currentFrameIndex = (this.currentFrameIndex + steps) >>> 0;
              this.lastFrameTime = timeMs - (elapsed % frameInterval);
              elapsed = timeMs - this.lastFrameTime;
              this.needsRender = true;
            }

            if (persistence > 0.001 && this.currentFrameIndex > 0) {
              const phase = Math.min(
                1.0,
                Math.max(0.0, elapsed / frameInterval),
              );
              const rawT = Math.min(1.0, phase / persistence);
              const nextBlend = rawT * rawT * (3.0 - 2.0 * rawT);
              if (Math.abs(nextBlend - this.currentTemporalBlend) > 0.002) {
                this.currentTemporalBlend = nextBlend;
                this.needsRender = true;
              }
            } else if (this.currentTemporalBlend !== 1.0) {
              this.currentTemporalBlend = 1.0;
              this.needsRender = true;
            }
          } else {
            this.currentFrameIndex = (this.currentFrameIndex + 1) >>> 0;
            this.currentTemporalBlend = 1.0;
            this.needsRender = true;
          }
        }

        // 3. Soumission GPU uniquement lorsque l'état visuel ou temporel a évolué
        if (this.needsRender) {
          this.needsRender = false;

          // Mise à jour éventuelle de la LUT physique via le module Rust WASM
          this.updateRustOpticalLut();

          const bgColors = this.domMirror
            ? this.domMirror.getBackgroundColor()
            : ([0.0392, 0.0392, 0.0392] as [number, number, number]);

          // Écriture des 36 valeurs 32-bit (144 octets alignés)
          this.uniformFloats[0] = this.canvas.width;
          this.uniformFloats[1] = this.canvas.height;
          this.uniformFloats[2] = timeMs * 0.001;
          this.uniformUints[3] = this.currentFrameIndex;

          this.uniformFloats[4] = this.options.grainScale;
          this.uniformFloats[5] = this.options.fps;
          this.uniformFloats[6] = this.options.intensity;
          this.uniformFloats[7] = this.options.microRatio;

          this.uniformFloats[8] = this.options.mesoRatio;
          this.uniformFloats[9] = this.options.mesoScale;
          this.uniformFloats[10] = this.options.iso;
          this.uniformFloats[11] = this.options.chromaAmount;

          this.uniformFloats[12] = this.currentTemporalBlend;
          this.uniformUints[13] = this.options.grainEnabled ? 1 : 0;
          this.uniformUints[14] = this.options.bloom.enabled ? 1 : 0;
          this.uniformUints[15] = this.options.halation.enabled ? 1 : 0;

          this.uniformUints[16] = this.options.chromaticAberration.enabled
            ? 1
            : 0;
          this.uniformFloats[17] = this.options.chromaticAberration.strength;
          this.uniformFloats[18] =
            this.options.chromaticAberration.axialStrength;
          this.uniformFloats[19] = this.options.bloom.intensity;

          this.uniformFloats[20] = this.options.bloom.radius;
          this.uniformFloats[21] = this.options.bloom.anamorphicTint;
          this.uniformFloats[22] = this.options.halation.intensity;
          this.uniformFloats[23] = this.options.halation.radius;

          this.uniformFloats[24] = bgColors[0];
          this.uniformFloats[25] = bgColors[1];
          this.uniformFloats[26] = bgColors[2];
          this.uniformFloats[27] =
            this.options.chromaticAberration.domMaskStrength;

          this.uniformUints[28] =
            (this.options.crt.enabled ? 1 : 0) | (bhEnabled ? 2 : 0);
          this.uniformFloats[29] = this.options.crt.curvatureX;
          this.uniformFloats[30] = this.options.crt.curvatureY;
          this.uniformFloats[31] = this.options.crt.scale;

          this.uniformFloats[32] = this.options.crt.vignette;
          this.uniformUints[33] = this.options.crt.scanlinesEnabled ? 1 : 0;
          this.uniformFloats[34] = this.options.crt.scanlineIntensity;
          this.uniformFloats[35] = this.options.crt.scanlineDensity;

          this.device.queue.writeBuffer(
            this.uniformBuffer,
            0,
            this.uniformBufferData,
          );

          const encoder = this.device.createCommandEncoder({
            label: "Retro_Optical_CommandEncoder",
          });

          // 3b. Passe 3D Amont : Trou Noir Relativiste de Kerr (ou copie directe du miroir DOM si désactivé)
          if (bhEnabled) {
            this.blackHolePass.encodePass(
              encoder,
              this.sceneTexture.createView(),
              this.sceneWidth || this.canvas.width,
              this.sceneHeight || this.canvas.height,
              timeMs * 0.001,
            );
          } else if (this.needsDomCopyToScene && this.domTexture) {
            this.needsDomCopyToScene = false;
            encoder.copyTextureToTexture(
              { texture: this.domTexture },
              { texture: this.sceneTexture },
              [
                Math.min(
                  this.canvas.width,
                  this.sceneWidth || this.canvas.width,
                ),
                Math.min(
                  this.canvas.height,
                  this.sceneHeight || this.canvas.height,
                ),
                1,
              ],
            );
          }

          // 4. Exécution conditionnelle de la Pyramide HDR 5 niveaux (uniquement si Bloom ou Halation actif et modifié)
          const needsPyramidPass =
            (this.options.bloom.enabled || this.options.halation.enabled) &&
            this.needsPyramidUpdate;

          if (needsPyramidPass) {
            this.needsPyramidUpdate = false;
            this.updateMipUniforms();

            for (let i = 0; i < MIP_CHAIN_COUNT; i++) {
              const mipPass = encoder.beginRenderPass({
                label: `HDR_Pyramid_Pass_Mip_${i}`,
                colorAttachments: [
                  {
                    view: this.mipTextures[i].createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: "clear",
                    storeOp: "store",
                  },
                ],
              });

              mipPass.setPipeline(
                i === 0 ? this.prefilterPipeline : this.downsamplePipeline,
              );
              mipPass.setBindGroup(0, this.mipBindGroups[i]);
              mipPass.draw(3);
              mipPass.end();
            }
          }

          // 5. Passe finale plein écran de composition optique, photochimique & capteur
          const currentTexture = this.context.getCurrentTexture();
          const mainPass = encoder.beginRenderPass({
            label: "Retro_Optical_Composite_Pass",
            colorAttachments: [
              {
                view: currentTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });

          mainPass.setPipeline(this.mainPipeline);
          mainPass.setBindGroup(0, this.mainBindGroup);
          mainPass.draw(3);
          mainPass.end();

          this.device.queue.submit([encoder.finish()]);
        }
      }

      this.rafId = requestAnimationFrame(render);
    };

    this.rafId = requestAnimationFrame(render);
  }

  destroy(): void {
    this.isDestroyed = true;
    if (AnachromeRenderer.activeInstance === this) {
      AnachromeRenderer.activeInstance = null;
      AnachromeRenderer.notifyListeners();
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.domMirror) {
      this.domMirror.destroy();
      this.domMirror = null;
    }

    this.blackHolePass.destroy();

    if (this.domTexture) {
      this.domTexture.destroy();
      this.domTexture = null;
    }

    if (this.sceneTexture) {
      this.sceneTexture.destroy();
      this.sceneTexture = null;
    }

    for (const tex of this.mipTextures) {
      tex.destroy();
    }
    this.mipTextures = [];

    for (const buf of this.mipUniformBuffers) {
      buf.destroy();
    }
    this.mipUniformBuffers = [];

    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }

    if (this.opticalLutBuffer) {
      this.opticalLutBuffer.destroy();
      this.opticalLutBuffer = null;
    }

    if (this.device) {
      this.device.onuncapturederror = null;
      this.device.destroy();
      this.device = null;
    }

    this.mainPipeline = null;
    this.prefilterPipeline = null;
    this.downsamplePipeline = null;
    this.mainBindGroup = null;
    this.mipBindGroups = [];
    this.context = null;
  }
}
