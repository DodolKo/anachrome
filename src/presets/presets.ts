import type {
  BloomOptions,
  ChromaticAberrationOptions,
  CrtOptions,
  GrainOptions,
  HalationOptions,
} from "../core/AnachromeRenderer";

export interface AnachromePreset {
  name: string;
  description: string;
  crt?: Partial<CrtOptions>;
  bloom?: Partial<BloomOptions>;
  halation?: Partial<HalationOptions>;
  chromaticAberration?: Partial<ChromaticAberrationOptions>;
  grain?: Partial<GrainOptions>;
}

export const ANACHROME_PRESETS: Record<string, AnachromePreset> = {
  arcade: {
    name: "Arcade Cabinet 1989",
    description: "Authentic curved CRT arcade monitor with scanlines, phosphor glow and blooming highlights.",
    crt: {
      enabled: true,
      curvatureX: 0.12,
      curvatureY: 0.14,
      scale: 1.04,
      vignette: 0.45,
      scanlinesEnabled: true,
      scanlineIntensity: 0.38,
      scanlineDensity: 1.0,
    },
    bloom: {
      enabled: true,
      intensity: 0.65,
      threshold: 0.4,
      softKnee: 0.7,
      radius: 1.4,
      airyScale: 1.2,
      mieGamma: 1.3,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.025,
    },
    halation: {
      enabled: true,
      intensity: 0.5,
      radius: 1.2,
      filmThicknessUm: 135,
      remjetRemoval: 0.7,
    },
    grain: {
      enabled: true,
      iso: 1600,
      intensity: 0.05,
      persistence: 6,
    },
  },

  cinestill: {
    name: "CineStill 800T / Kodak Vision3",
    description: "Photochemical film emulation with distinctive warm halation, organic grain and anamorphic bloom.",
    crt: {
      enabled: false,
    },
    bloom: {
      enabled: true,
      intensity: 0.5,
      threshold: 0.48,
      softKnee: 0.65,
      radius: 1.3,
      airyScale: 1.1,
      mieGamma: 1.4,
      anamorphicSqueeze: 1.6,
      anamorphicTint: 0.5,
    },
    halation: {
      enabled: true,
      intensity: 1.1,
      radius: 1.8,
      filmThicknessUm: 140,
      remjetRemoval: 0.95,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.012,
    },
    grain: {
      enabled: true,
      iso: 800,
      intensity: 0.065,
      microRatio: 0.75,
      mesoRatio: 0.25,
      mesoScale: 0.5,
      persistence: 8,
    },
  },

  cyberpunk: {
    name: "Cyberpunk Neon 2077",
    description: "High-contrast neon bloom, anamorphic lens flares, spectral chromatic split and subtle scanlines.",
    crt: {
      enabled: true,
      curvatureX: 0.03,
      curvatureY: 0.04,
      scale: 1.0,
      vignette: 0.25,
      scanlinesEnabled: true,
      scanlineIntensity: 0.18,
      scanlineDensity: 1.2,
    },
    bloom: {
      enabled: true,
      intensity: 0.85,
      threshold: 0.35,
      softKnee: 0.8,
      radius: 1.8,
      airyScale: 1.35,
      mieGamma: 1.1,
      anamorphicSqueeze: 2.0,
      anamorphicTint: 0.7,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.04,
    },
    halation: {
      enabled: true,
      intensity: 0.8,
      radius: 1.5,
      remjetRemoval: 0.9,
    },
    grain: {
      enabled: true,
      iso: 3200,
      intensity: 0.04,
    },
  },

  matrixTerminal: {
    name: "Matrix Phosphor Terminal",
    description: "Monochromatic phosphor display feel with heavy persistence, intense scanlines and tube distortion.",
    crt: {
      enabled: true,
      curvatureX: 0.15,
      curvatureY: 0.18,
      scale: 1.06,
      vignette: 0.6,
      scanlinesEnabled: true,
      scanlineIntensity: 0.55,
      scanlineDensity: 1.1,
    },
    bloom: {
      enabled: true,
      intensity: 0.9,
      threshold: 0.3,
      radius: 2.0,
    },
    chromaticAberration: {
      enabled: false,
    },
    halation: {
      enabled: false,
    },
    grain: {
      enabled: true,
      iso: 6400,
      intensity: 0.06,
      persistence: 16,
    },
  },

  vhs80s: {
    name: "VHS 1984 Tape",
    description: "Lo-fi analog video tape aesthetic with lateral chromatic bleeding, tape noise and CRT curvature.",
    crt: {
      enabled: true,
      curvatureX: 0.08,
      curvatureY: 0.1,
      scale: 1.02,
      vignette: 0.35,
      scanlinesEnabled: true,
      scanlineIntensity: 0.3,
      scanlineDensity: 0.8,
    },
    bloom: {
      enabled: true,
      intensity: 0.4,
      threshold: 0.5,
      radius: 1.1,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.045,
    },
    halation: {
      enabled: true,
      intensity: 0.65,
      radius: 1.6,
    },
    grain: {
      enabled: true,
      iso: 4800,
      intensity: 0.09,
      microRatio: 0.6,
      mesoRatio: 0.4,
      mesoScale: 0.8,
      persistence: 12,
    },
  },

  subtleCinematic: {
    name: "Subtle Modern Film (Default)",
    description: "Ultra-clean, production-grade photographic grain and gentle highlight halation for modern websites.",
    crt: {
      enabled: false,
    },
    bloom: {
      enabled: true,
      intensity: 0.25,
      threshold: 0.6,
      softKnee: 0.5,
      radius: 1.0,
    },
    halation: {
      enabled: true,
      intensity: 0.4,
      radius: 1.0,
      remjetRemoval: 0.5,
    },
    chromaticAberration: {
      enabled: true,
      strength: 0.006,
    },
    grain: {
      enabled: true,
      iso: 400,
      intensity: 0.035,
      microRatio: 0.85,
      mesoRatio: 0.15,
      persistence: 5,
    },
  },
};

