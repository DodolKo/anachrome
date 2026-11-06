export type BlackHoleQualityTier = "ultra" | "high" | "medium" | "low";

export interface BlackHoleOptions {
  /** Active ou débranche complètement la simulation relativiste du Trou Noir. Par défaut : true */
  enabled?: boolean;
  /**
   * Palier de qualité de rendu et d'échelle de résolution interne du Raymarcher Kerr :
   * - `"ultra"`  : 100% résolution native, 88 pas RK2-Verlet, Flamm 3D + Cage 3D + Disque + Jets
   * - `"high"`   : 75% résolution interne (56% des pixels), 64 pas RK2-Verlet, Flamm 3D + Cage 3D + Disque
   * - `"medium"` : 60% résolution interne (36% des pixels), 48 pas RK2-Verlet, Puits de Flamm 2D/3D (Cage 3D off)
   * - `"low"`    : 50% résolution interne (25% des pixels), 34 pas RK2-Verlet, Disque laminaire pur (Grilles 2D/3D off)
   * Par défaut : `"high"`
   */
  quality?: BlackHoleQualityTier;
  /**
   * Échelle de résolution interne du raymarching du Trou Noir (0.35 à 1.0).
   * Permet de gagner +100% à +300% de FPS sans altérer un seul calcul relativiste par rayon !
   * Par défaut : 0.75
   */
  renderScale?: number;
  /**
   * Nombre maximal de pas d'intégration symplectique RK2-Verlet par rayon (24 à 112).
   * Par défaut : 64
   */
  raymarchSteps?: number;
  /** Masse apparente M du Trou Noir (échelle du rayon de Schwarzschild r_s = 2M). Par défaut : 1.0 */
  mass?: number;
  /** Spin sans dimension de Kerr a* = Jc / GM^2 (-0.998 à +0.998). Crée l'ombre en "D" et le Frame-Dragging. Par défaut : 0.94 */
  spin?: number;

  /** Inclinaison polaire de la caméra par rapport au plan équatorial en degrés (-85° à +85°). Par défaut : 11.5° */
  cameraTheta?: number;
  /** Azimut orbital de la caméra en degrés (0° à 360°). Par défaut : 24.0° */
  cameraPhi?: number;
  /** Angle d'inclinaison cinématique (Roll) du plan équatorial à l'écran en degrés (-90° à +90°). Par défaut : -15.0° */
  cameraRoll?: number;
  /** Distance radiale de la caméra en multiples de M (7.0 à 40.0). Par défaut : 18.0 */
  cameraDistance?: number;
  /** Vitesse de rotation orbitale automatique (rad/s). Par défaut : 0.08 */
  autoOrbitSpeed?: number;
  /** Intensité de la parallaxe gravitationnelle au mouvement de la souris (0.0 à 1.0). Par défaut : 0.35 */
  cursorParallax?: number;

  /** Force de la déflexion géodésique d'Einstein des rayons lumineux (0.0 à 2.0). Par défaut : 1.0 */
  lensingStrength?: number;
  /** Force de la lentille gravitationnelle appliquée au DOM ("DOKO") en arrière-plan (0.0 à 2.0). Par défaut : 1.15 */
  domLensingStrength?: number;
  /** Intensité des anneaux photoniques relativistes n=1 et n=2 sur la sphère de photons (0.0 à 3.0). Par défaut : 1.45 */
  photonRingIntensity?: number;

  /** Active le disque d'accrétion relativiste de Novikov-Thorne. Par défaut : true */
  diskEnabled?: boolean;
  /** Intensité énergétique HDR du disque d'accrétion (pilote le Bloom Airy/Mie et l'Halation). Par défaut : 1.55 */
  diskIntensity?: number;
  /** Température de crête du corps noir de Planck en Kelvin (2500 K à 28000 K). Par défaut : 9200 K */
  diskTemperature?: number;
  /** Rayon externe du disque d'accrétion en multiples de M (8.0 à 30.0). Par défaut : 18.0 */
  diskOuterRadius?: number;
  /** Force du Beaming Doppler relativiste & Redshift gravitationnel I_obs = g^4 I_emit (0.0 à 1.5). Par défaut : 1.0 */
  dopplerStrength?: number;
  /** Échelle et contraste des filaments magnéto-rotationnels (MRI) képlériens (0.2 à 2.5). Par défaut : 1.15 */
  turbulenceScale?: number;

  /** Active les jets relativistes polaires de Blandford-Znajek. Par défaut : true */
  jetsEnabled?: boolean;
  /** Intensité synchrotron des jets polaires hélicoïdaux (0.0 à 2.5). Par défaut : 0.78 */
  jetsIntensity?: number;

  /** Active le Paraboloïde de Flamm 3D z(r) = -2√(r_s(r - r_s)) (puits gravitationnel équatorial). Par défaut : true */
  flammGridEnabled?: boolean;
  /** Intensité lumineuse du Paraboloïde de Flamm 3D (0.0 à 2.0). Par défaut : 0.78 */
  flammGridIntensity?: number;
  /** Active la grille tensorielle cubique 3D (x,y,z) contractée vers la singularité. Par défaut : true */
  tensorGridEnabled?: boolean;
  /** Intensité lumineuse de la grille tensorielle 3D (0.0 à 2.0). Par défaut : 0.42 */
  tensorGridIntensity?: number;
  /** Densité spatiale des lignes de coordonnées d'espace-temps (0.4 à 2.5). Par défaut : 1.0 */
  gridDensity?: number;
  /** Intensité du champ d'étoiles lointain déformé en anneaux d'Einstein (0.0 à 2.0). Par défaut : 0.85 */
  starfieldIntensity?: number;
}

export type ResolvedBlackHoleOptions = Required<BlackHoleOptions>;

export const DEFAULT_BLACK_HOLE_OPTIONS: ResolvedBlackHoleOptions = {
  enabled: false,
  quality: "high",
  renderScale: 0.75,
  raymarchSteps: 64,
  mass: 1.0,
  spin: 0.9,
  cameraTheta: 14.0,
  cameraPhi: 24.0,
  cameraRoll: -12.0,
  cameraDistance: 19.5,
  autoOrbitSpeed: 0.06,
  cursorParallax: 0.35,
  lensingStrength: 1.0,
  domLensingStrength: 0.78,
  photonRingIntensity: 1.05,
  diskEnabled: true,
  diskIntensity: 1.12,
  diskTemperature: 8600,
  diskOuterRadius: 13.5,
  dopplerStrength: 0.88,
  turbulenceScale: 0.38,
  jetsEnabled: false,
  jetsIntensity: 0.45,
  flammGridEnabled: false,
  flammGridIntensity: 0.68,
  tensorGridEnabled: true,
  tensorGridIntensity: 0.52,
  gridDensity: 0.85,
  starfieldIntensity: 0.55,
};

export interface BlackHoleQualityPreset {
  id: BlackHoleQualityTier;
  name: string;
  badge: string;
  subtitle: string;
  /** Patch d'options appliqué sans écraser les paramètres astrophysiques (spin, caméra, masse, température) */
  patch: Partial<BlackHoleOptions>;
}

/**
 * Presets de Qualité & Performance (Gain de FPS) :
 * - "fps-boost" / "high" : Gagne ~2x de FPS en abaissant l'échelle de résolution interne (0.72x)
 *   sans altérer les équations relativistes
 * - "medium" : Coupe la Grille 3D et les Jets
 * - "low" : Coupe les Grilles 2D/3D et les Jets pour les GPU intégrés / mobiles
 * - "ultra" : Résolution 100% native Retina + 88 pas RK2-Verlet
 */
export const BLACK_HOLE_QUALITY_PRESETS: BlackHoleQualityPreset[] = [
  {
    id: "ultra",
    name: "Ultra • Natif 100%",
    badge: "100% • 88 pas",
    subtitle:
      "Résolution Retina 1:1, 88 pas RK2-Verlet, Grille 3D haute densité + Disque",
    patch: {
      quality: "ultra",
      renderScale: 1.0,
      raymarchSteps: 88,
      flammGridEnabled: false,
      tensorGridEnabled: true,
    },
  },
  {
    id: "high",
    name: "High • Boost FPS (Physique 100%)",
    badge: "75% • 64 pas",
    subtitle: "Gagne +85% de FPS via sub-sampling 0.75× avec Grille 3D active",
    patch: {
      quality: "high",
      renderScale: 0.75,
      raymarchSteps: 64,
      flammGridEnabled: false,
      tensorGridEnabled: true,
    },
  },
  {
    id: "medium",
    name: "Medium • Sans Cage 3D",
    badge: "60% • 48 pas",
    subtitle: "Coupe la Grille Tensorielle 3D et les Jets, conserve le Disque",
    patch: {
      quality: "medium",
      renderScale: 0.6,
      raymarchSteps: 48,
      flammGridEnabled: false,
      tensorGridEnabled: false,
      jetsEnabled: false,
    },
  },
  {
    id: "low",
    name: "Eco • Sans Grilles 2D/3D",
    badge: "50% • 34 pas",
    subtitle:
      "Désactive toutes les grilles 2D/3D et les jets • Focus Disque & Lentille DOM à 60 FPS",
    patch: {
      quality: "low",
      renderScale: 0.5,
      raymarchSteps: 34,
      flammGridEnabled: false,
      tensorGridEnabled: false,
      jetsEnabled: false,
      starfieldIntensity: 0.25,
    },
  },
];

export interface BlackHolePreset {
  id: string;
  name: string;
  subtitle: string;
  options: ResolvedBlackHoleOptions;
}

export const BLACK_HOLE_PRESETS: BlackHolePreset[] = [
  {
    id: "sculptural-light",
    name: "Light • Formes Pures",
    subtitle:
      "Disque laminaire sculptural + Grille 3D continue haute définition",
    options: DEFAULT_BLACK_HOLE_OPTIONS,
  },
  {
    id: "fps-exact-physics",
    name: "Boost FPS • Calculs Intacts",
    subtitle:
      "Échelle interne 0.68× + 64 pas RK2 : mêmes équations de Kerr & grille 3D avec +115% de FPS",
    options: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
      quality: "high",
      renderScale: 0.68,
      raymarchSteps: 64,
    },
  },
  {
    id: "spacetime-lab",
    name: "Labo Géodésique (Grille 2D)",
    subtitle: "Focus Paraboloïde de Flamm 2D z(r)=2√(rs(r-rs))",
    options: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
      spin: 0.88,
      cameraTheta: 24.0,
      cameraRoll: -9.0,
      cameraDistance: 20.5,
      diskIntensity: 0.65,
      turbulenceScale: 0.25,
      flammGridEnabled: true,
      flammGridIntensity: 1.15,
      tensorGridEnabled: false,
      tensorGridIntensity: 0.9,
      gridDensity: 0.95,
      jetsEnabled: false,
      jetsIntensity: 0.35,
    },
  },
  {
    id: "gargantua-kerr",
    name: "Gargantua (Kerr a*=0.94)",
    subtitle: "Disque Novikov-Thorne + Grille Tensorielle 3D",
    options: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
      spin: 0.94,
      cameraTheta: 11.5,
      cameraRoll: -15.0,
      cameraDistance: 18.0,
      diskIntensity: 1.38,
      diskOuterRadius: 16.0,
      turbulenceScale: 0.72,
      photonRingIntensity: 1.25,
      flammGridEnabled: false,
      flammGridIntensity: 0.65,
      tensorGridEnabled: true,
      tensorGridIntensity: 0.45,
    },
  },
  {
    id: "m87-eht",
    name: "M87* EHT (Doppler Extrême)",
    subtitle:
      "Ombre asymétrique en D, fort beaming relativiste g^4 & plasma chaud",
    options: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
      spin: 0.985,
      cameraTheta: 17.0,
      cameraRoll: -22.0,
      cameraDistance: 16.5,
      diskTemperature: 5400,
      diskIntensity: 1.55,
      dopplerStrength: 1.25,
      turbulenceScale: 0.55,
      photonRingIntensity: 1.45,
      jetsEnabled: true,
      jetsIntensity: 0.75,
      flammGridEnabled: false,
      flammGridIntensity: 0.35,
      tensorGridEnabled: false,
      tensorGridIntensity: 0.25,
    },
  },
  {
    id: "schwarzschild-pure",
    name: "Schwarzschild Pur (a*=0)",
    subtitle:
      "Trou noir statique sans spin (r_ISCO = 6M, ombre sphérique 3√3 M)",
    options: {
      ...DEFAULT_BLACK_HOLE_OPTIONS,
      spin: 0.0,
      cameraTheta: 11.0,
      cameraRoll: 0.0,
      dopplerStrength: 0.8,
      turbulenceScale: 0.25,
      jetsEnabled: false,
      jetsIntensity: 0.0,
      flammGridEnabled: true,
      flammGridIntensity: 0.85,
      tensorGridEnabled: false,
      tensorGridIntensity: 0.55,
    },
  },
];
