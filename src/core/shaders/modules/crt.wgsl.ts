/**
 * Module : Bombage d'Écran (Tube Cathodique / Courbure Anisotrope X/Y) & Scanlines Physiques
 *
 * Origine physique & géométrique modélisée :
 * 1. Distorsion en Barillet Anisotrope (Brown-Conrady / Tube Cathodique Sphérique ou Cylindrique) :
 *    - Permet un réglage 100 % indépendant sur l'axe X (`curvatureX`) et sur l'axe Y (`curvatureY`).
 *    - Si `curvatureY > 0` et `curvatureX == 0` : courbure purement verticale (les lignes horizontales
 *      se courbent sur l'axe Y tandis que les colonnes verticales restent strictement droites).
 *    - Si `curvatureX > 0` et `curvatureY == 0` : courbure cylindrique horizontale (type Sony Trinitron).
 *    - Si `curvatureX > 0` et `curvatureY > 0` : bombage intégral d'écran cathodique (tube CRT sphérique/torique).
 * 2. Masque de Tube & Vignette Optique de Bord (Bezel & Glass Edge Attenuation) :
 *    - Assombrissement progressif aux grands angles d'incidence (loi en cos^4(θ) + arrondi de masque cathodique)
 *      et occultation propre hors du domaine [0, 1] de la dalle courbée.
 * 3. Scanlines à Largeur de Faisceau Modulée par la Luminance (Beam-Width Blooming) :
 *    - Sur un véritable moniteur cathodique (Sony BVM / PVM), un faisceau d'électrons intense
 *      s'élargit verticalement sous l'effet de la charge d'espace, comblant l'interligne sombre
 *      dans les hautes lumières.
 *    - Ce modèle préserve à 100 % l'effet "Whoa" des calculs optiques de base (Bloom d'Airy/Mie,
 *      Halation CineStill et Aberration Chromatique Spectrale) sans jamais les hacher ni les assombrir.
 */
export const crtChunk = /* wgsl */ `
struct CrtWarpResult {
  uv: vec2f,
  inBounds: f32,
  bezelMask: f32,
  vignetteFactor: f32,
};

/**
 * Projette les coordonnées UV écran [0, 1] sur la surface bombée du tube (axe X et/ou axe Y).
 *
 * @param uv          Coordonnées UV normalisées [0, 1]
 * @param curvatureX  Intensité du bombage sur l'axe X (0.0 = plat sur X)
 * @param curvatureY  Intensité du bombage sur l'axe Y (0.0 = plat sur Y)
 * @param scale       Facteur d'échelle / overscan (1.0 = bords naturels du tube)
 * @param vignette    Intensité du vignettage de bord de tube (0.0 à 1.0)
 */
fn warpCrtScreen(
  uv: vec2f,
  curvatureX: f32,
  curvatureY: f32,
  scale: f32,
  vignette: f32
) -> CrtWarpResult {
  var res: CrtWarpResult;

  // Coordonnées centrées dans [-1.0, +1.0]
  let p = (uv - vec2f(0.5)) * 2.0;
  let px2 = p.x * p.x;
  let py2 = p.y * p.y;

  // Distorsion en barillet anisotrope séparable :
  // - curvatureX courbe les lignes verticales en fonction de y^2 (+ profil convexe x^2)
  // - curvatureY courbe les lignes horizontales en fonction de x^2 (+ profil convexe y^2)
  let factorX = 1.0 + curvatureX * (py2 + 0.35 * px2);
  let factorY = 1.0 + curvatureY * (px2 + 0.35 * py2);

  let safeScale = max(0.25, scale);
  let warpedP = vec2f(p.x * factorX, p.y * factorY) / safeScale;
  let warpedUv = warpedP * 0.5 + vec2f(0.5);

  // Masque de bord doux (anti-aliasing géométrique du cadre du tube cathodique)
  let edgeDist = max(abs(warpedP.x), abs(warpedP.y));
  let inBounds = 1.0 - smoothstep(0.996, 1.004, edgeDist);

  // Arrondi subtil des coins du tube lorsque les deux axes sont bombés
  let bothCurved = min(curvatureX, curvatureY);
  let cornerR = clamp(bothCurved * 0.65, 0.0, 0.18);
  let q = abs(warpedP) - vec2f(1.0 - cornerR);
  let cornerDist = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - cornerR;
  let bezelMask = (1.0 - smoothstep(-0.008, 0.006, cornerDist)) * inBounds;

  // Vignettage optique naturel du verre bombé : atténuation douce vers les bords courbés
  let r2 = dot(warpedP, warpedP);
  let vigCurve = clamp(1.0 - vignette * 0.42 * r2 * r2, 0.0, 1.0);

  res.uv = warpedUv;
  res.inBounds = inBounds;
  res.bezelMask = bezelMask;
  res.vignetteFactor = vigCurve;
  return res;
}

/**
 * Calcule la modulation des Scanlines Cathodiques avec élargissement dynamique du faisceau
 * d'électrons (Beam-Width Blooming) dans les hautes lumières pour ne jamais dénaturer
 * le Bloom Optique, l'Halation ni l'Aberration Chromatique.
 *
 * @param warpedUv          Coordonnées UV après bombage
 * @param resolution        Résolution physique du framebuffer
 * @param scanlineIntensity Force des scanlines [0.0, 1.0]
 * @param scanlineDensity   Densité / fréquence verticale (1.0 = standard PVM)
 * @param localLuminance    Énergie lumineuse optique locale [0.0, 1.0] (fusionne les lignes sur les pics HDR)
 */
fn computeCrtScanlineModulation(
  warpedUv: vec2f,
  resolution: vec2f,
  scanlineIntensity: f32,
  scanlineDensity: f32,
  localLuminance: f32
) -> f32 {
  let clampedIntensity = clamp(scanlineIntensity, 0.0, 1.0);
  if (clampedIntensity <= 0.0001) {
    return 1.0;
  }

  // Fréquence spatiale bornée sous la limite de Nyquist pour éviter tout moiré matériel
  let density = clamp(scanlineDensity, 0.20, 2.0);
  let lineCoord = warpedUv.y * resolution.y * (0.35 * density);

  // Profil de spot gaussien / cosinus surélevé du faisceau d'électrons
  let wave = 0.5 + 0.5 * cos(lineCoord * 3.14159265);

  // Élargissement du faisceau par la luminance (Beam-Width Blooming) :
  // Plus un pixel émet de lumière (cœur des lettres, Bloom, Halation), plus le spot s'élargit
  // et comble l'interligne, préservant 100 % du rendu "Whoa" des hautes lumières.
  let beamSaturation = smoothstep(0.15, 0.92, localLuminance);
  let shapedWave = pow(wave, mix(1.15, 0.30, beamSaturation));

  // Atténuation minimale bornée : ne détruit jamais les ombres ni les halos photochimiques
  let effectiveDepth = clampedIntensity * 0.45 * (1.0 - beamSaturation * 0.72);
  return mix(1.0, shapedWave, effectiveDepth);
}
`;
