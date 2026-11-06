/**
 * Module 3 : Géométrie de l'Espace-Temps Courbe (Paraboloïde de Flamm 3D + Grille Tensorielle 3D + Champ d'Étoiles)
 *
 * Version épurée haute précision ("Light & Sculptural") :
 * 1. Paraboloïde de Flamm 3D (z(r) = -2√(r_s(r - r_s))) :
 *    Ancré proprement sous le plan équatorial (Y <= 0) et plongeant verticalement vers l'horizon r_+,
 *    avec des lignes analytiques ultra-fines permettant de lire parfaitement la courbure du puits.
 * 2. Grille Tensorielle 3D Continue (Intersections analytiques exactes des plans de coordonnées) :
 *    Élimine tout pointillé ou segment brisé en calculant l'intersection exacte du segment de rayon
 *    [w0 -> w1] avec les plans du réseau 3D contracté par la métrique g_μν.
 * 3. Champ d'Étoiles Profond Minimaliste :
 *    Étoiles fines et ponctuelles déformées par lentille gravitationnelle près de la sphère de photons.
 */
export const spacetimeGridChunk = /* wgsl */ `
/**
 * Cote verticale 3D du Paraboloïde de Flamm en unités de M :
 * La nappe est quasi-horizontale loin du trou noir (sous le plan équatorial à Y ≈ -0.45M)
 * et plonge en entonnoir relativiste-exact vers la gorge de l'horizon r_+.
 */
fn flammParaboloidHeightM(rInM: f32, rPlusM: f32, rMaxM: f32) -> f32 {
  let rs = 2.0;
  let rClamped = clamp(rInM, rPlusM, rMaxM);
  let maxDepth = 2.0 * sqrt(rs * max(0.0, rMaxM - rPlusM));
  let curDepth = 2.0 * sqrt(rs * max(0.0, rClamped - rPlusM));
  // À r = rMaxM : y = -0.45M (plan équatorial). Quand r -> r_+ : y plonge jusqu'à -(0.45 + 0.55 * maxDepth)
  return -0.45 - 0.55 * (maxDepth - curDepth);
}

/**
 * Évalue l'intersection exacte et le maillage fin du Paraboloïde de Flamm 3D entre p0 et p1.
 */
fn evaluateFlammParaboloidCrossing(
  p0: vec3f,
  p1: vec3f,
  mass: f32,
  spinA: f32,
  rPlusM: f32,
  gridDensity: f32,
  flammIntensity: f32,
  time: f32
) -> vec3f {
  let invM = 1.0 / max(1e-4, mass);
  let q0 = p0 * invM;
  let q1 = p1 * invM;

  let r0 = length(q0.xz);
  let r1 = length(q1.xz);
  let rMaxM = 16.5;

  if ((r0 < rPlusM * 1.02 && r1 < rPlusM * 1.02) || (r0 > rMaxM + 0.5 && r1 > rMaxM + 0.5)) {
    return vec3f(0.0);
  }

  let h0 = q0.y - flammParaboloidHeightM(r0, rPlusM, rMaxM);
  let h1 = q1.y - flammParaboloidHeightM(r1, rPlusM, rMaxM);

  // Détection exacte de franchissement de la surface 3D du puits gravitationnel
  if (h0 * h1 > 0.0) {
    return vec3f(0.0);
  }

  let tHit = clamp(abs(h0) / max(1e-5, abs(h0 - h1)), 0.0, 1.0);
  let qHit = mix(q0, q1, tHit);
  let rHit = length(qHit.xz);

  if (rHit <= rPlusM * 1.03 || rHit >= rMaxM) {
    return vec3f(0.0);
  }

  // Distance curviligne propre le long du profil de Flamm
  let properR = sqrt(rHit * max(0.05, rHit - rPlusM)) +
    0.65 * rPlusM * log(sqrt(rHit / rPlusM) + sqrt(max(0.01, rHit / rPlusM - 1.0)));

  // Torsion de Lense-Thirring (Frame-Dragging de Kerr) près de la gorge
  let phiRaw = atan2(qHit.z, qHit.x);
  let frameDragTwist = spinA * 2.2 / pow(max(1.0, rHit / rPlusM), 1.5);
  let phiTwisted = phiRaw - frameDragTwist - time * 0.05 * spinA;

  let radialFreq = 0.72 * gridDensity;
  let angularSubdivs = round(12.0 * gridDensity);

  let radialCoord = properR * radialFreq;
  let angularCoord = phiTwisted * (angularSubdivs / TWO_PI);

  let lineRad = abs(fract(radialCoord + 0.5) - 0.5);
  let lineAng = abs(fract(angularCoord + 0.5) - 0.5);

  // Lignes architecturales ultra-fines (anti-aliasées sans empâtement)
  let distScale = clamp(rHit * 0.05, 0.35, 1.1);
  let aaWidthR = 0.016 * distScale;
  let aaWidthA = 0.014 * clamp(1.4 / max(0.7, rHit * 0.16), 0.3, 1.2);

  let gridR = 1.0 - smoothstep(0.0, aaWidthR, lineRad);
  let gridA = 1.0 - smoothstep(0.0, aaWidthA, lineAng);
  let lineMask = max(gridR, gridA * 0.85) + gridR * gridA * 0.9;

  if (lineMask <= 0.001) {
    return vec3f(0.0);
  }

  let outerFade = smoothstep(rMaxM, rMaxM * 0.68, rHit) * smoothstep(rPlusM * 1.03, rPlusM * 1.35, rHit);
  let curvatureRatio = clamp(2.4 / max(1.0, rHit - rPlusM + 1.0), 0.0, 1.0);
  let gridColor = mix(vec3f(0.16, 0.72, 0.92), vec3f(0.55, 0.95, 0.88), curvatureRatio);

  return gridColor * (lineMask * outerFade * flammIntensity * 0.48);
}

/**
 * Coordonnées spatiales 3D déformées par la contraction métrique vers la singularité.
 */
fn warpMetricTensorCoord(q: vec3f, rPlusM: f32, spinA: f32, cellScale: f32) -> vec3f {
  let r = length(q);
  // Contraction radiale douce vers le puits gravitationnel
  let metricPinch = 1.0 + 1.45 / (1.2 + max(0.0, r - rPlusM) * 0.45);
  let twist = spinA * 0.65 / (1.5 + r * r * 0.18);
  let c = cos(twist);
  let s = sin(twist);
  let qRot = vec3f(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  return qRot * (metricPinch * cellScale);
}

/**
 * Grille Tensorielle 3D 100% Continue par intersection analytique des plans du réseau entre p0 et p1.
 * Aucun pointillé ni segment cassé : chaque arête 3D est résolue à l'intersection exacte du segment.
 */
fn evaluateMetricTensorCageCrossing(
  p0: vec3f,
  p1: vec3f,
  mass: f32,
  spinA: f32,
  rPlusM: f32,
  gridDensity: f32,
  tensorIntensity: f32
) -> vec3f {
  let invM = 1.0 / max(1e-4, mass);
  let q0 = p0 * invM;
  let q1 = p1 * invM;

  let r0 = length(q0);
  let r1 = length(q1);
  let rMaxCage = 28.0;

  if ((r0 < rPlusM * 1.25 && r1 < rPlusM * 1.25) || (r0 > rMaxCage && r1 > rMaxCage)) {
    return vec3f(0.0);
  }

  let cellScale = 0.36 * gridDensity;
  let w0 = warpMetricTensorCoord(q0, rPlusM, spinA, cellScale);
  let w1 = warpMetricTensorCoord(q1, rPlusM, spinA, cellScale);

  let f0 = floor(w0);
  let f1 = floor(w1);

  let rMid = 0.5 * (r0 + r1);
  var wireAccum = 0.0;
  let lineHalfWidth = clamp(0.0052 + rMid * 0.0001, 0.005, 0.0075);

  // 1. Franchissement d'un plan X = entier -> arêtes Y ou Z sur ce plan
  if (f0.x != f1.x) {
    let planeX = max(f0.x, f1.x);
    let t = clamp((planeX - w0.x) / (w1.x - w0.x), 0.0, 1.0);
    let wHit = mix(w0, w1, t);
    let dy = abs(fract(wHit.y + 0.5) - 0.5);
    let dz = abs(fract(wHit.z + 0.5) - 0.5);
    wireAccum = max(wireAccum, 1.0 - smoothstep(0.0, lineHalfWidth, min(dy, dz)));
  }

  // 2. Franchissement d'un plan Y = entier -> arêtes X ou Z sur ce plan
  if (f0.y != f1.y) {
    let planeY = max(f0.y, f1.y);
    let t = clamp((planeY - w0.y) / (w1.y - w0.y), 0.0, 1.0);
    let wHit = mix(w0, w1, t);
    let dx = abs(fract(wHit.x + 0.5) - 0.5);
    let dz = abs(fract(wHit.z + 0.5) - 0.5);
    wireAccum = max(wireAccum, 1.0 - smoothstep(0.0, lineHalfWidth, min(dx, dz)));
  }

  // 3. Franchissement d'un plan Z = entier -> arêtes X ou Y sur ce plan
  if (f0.z != f1.z) {
    let planeZ = max(f0.z, f1.z);
    let t = clamp((planeZ - w0.z) / (w1.z - w0.z), 0.0, 1.0);
    let wHit = mix(w0, w1, t);
    let dx = abs(fract(wHit.x + 0.5) - 0.5);
    let dy = abs(fract(wHit.y + 0.5) - 0.5);
    wireAccum = max(wireAccum, 1.0 - smoothstep(0.0, lineHalfWidth, min(dx, dy)));
  }

  if (wireAccum <= 0.001) {
    return vec3f(0.0);
  }

  let shellFade = smoothstep(rMaxCage, rMaxCage * 0.75, rMid) * smoothstep(rPlusM * 1.25, rPlusM * 2.0, rMid);
  let cageColor = mix(vec3f(0.28, 0.62, 0.98), vec3f(0.55, 0.88, 1.0), clamp(3.5 / max(1.0, rMid), 0.0, 1.0));

  return cageColor * (wireAccum * shellFade * tensorIntensity * 0.36);
}

/**
 * Champ d'étoiles profond minimaliste évalué sur la sphère céleste déviée.
 */
fn evaluateLensedCelestialStarfield(
  rayDir: vec3f,
  totalDeflectionRad: f32,
  starfieldIntensity: f32
) -> vec3f {
  if (starfieldIntensity <= 0.001) {
    return vec3f(0.0);
  }

  let dir = normalize(rayDir);
  let theta = acos(clamp(dir.y, -1.0, 1.0));
  let phi = atan2(dir.z, dir.x);
  let uvSphere = vec2f(phi * (1.0 / TWO_PI) + 0.5, theta * (1.0 / PI));

  var starsLinear = vec3f(0.0);

  // Étoiles fines haute définition (sans grosses taches floues)
  let grid1 = uvSphere * vec2f(320.0, 160.0);
  let cell1 = floor(grid1);
  let local1 = fract(grid1) - 0.5;
  let seed1 = hash21Disk(cell1);

  if (seed1 > 0.976) {
    let jitter = vec2f(hash21Disk(cell1 + 17.3), hash21Disk(cell1 + 41.7)) - 0.5;
    let d = length(local1 - jitter * 0.5);
    let starCore = exp(-d * d * 210.0);
    let tempStar = fract(seed1 * 37.0);
    let starColor = samplePlanckBlackbodyLut(0.25 + 0.7 * tempStar);
    starsLinear += starColor * starCore * 1.15;
  }

  let einsteinMagnification = 1.0 + clamp(totalDeflectionRad * 0.75, 0.0, 1.8);
  return starsLinear * einsteinMagnification * starfieldIntensity;
}
`;
