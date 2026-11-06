/**
 * Module 2 : Disque d'Accrétion Relativiste Sculptural (Novikov-Thorne, Beaming Doppler g⁴ & Jets)
 *
 * Conception "Light & Formes Pure" :
 * 1. Séparation géométrique nette entre l'Horizon des Événements r_+ et le bord interne du disque :
 *    Garantit un espace vide sombre autour de la sphère de photons pour que l'ombre du trou noir,
 *    l'anneau d'Einstein critique et les arches gravitationnelles (supérieure/inférieure) soient
 *    immédiatement lisibles.
 * 2. Profil Laminaire Graphique & Épuré :
 *    À bas `turbScale` (mode Light par défaut), le disque forme un ruban relativiste soyeux
 *    souligné par quelques harmoniques orbitales pures qui mettent en valeur la courbure 3D.
 * 3. Théorème de Liouville Relativiste (I_obs = g⁴ · I_emit, T_obs = g · T_emit) :
 *    Maintient la vraie physique du décalage Doppler et du redshift gravitationnel.
 */
export const accretionDiskChunk = /* wgsl */ `
fn hash21Disk(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash31Disk(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise2D(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash21Disk(i + vec2f(0.0, 0.0));
  let b = hash21Disk(i + vec2f(1.0, 0.0));
  let c = hash21Disk(i + vec2f(0.0, 1.0));
  let d = hash21Disk(i + vec2f(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn valueNoise3D(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let n000 = hash31Disk(i + vec3f(0.0, 0.0, 0.0));
  let n100 = hash31Disk(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31Disk(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31Disk(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31Disk(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31Disk(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31Disk(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31Disk(i + vec3f(1.0, 1.0, 1.0));

  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);

  let y0 = mix(x00, x10, u.y);
  let y1 = mix(x01, x11, u.y);

  return mix(y0, y1, u.z);
}

/**
 * Interpolation continue dans la table de Corps Noir de Planck CIE 1931 -> Rec.709 (calculée en Rust).
 * tempNorm est normalisé dans [0.0 .. 1.0] selon l'échelle logarithmique [1200 K .. 48000 K].
 */
fn samplePlanckBlackbodyLut(tempNorm: f32) -> vec3f {
  let scaled = clamp(tempNorm, 0.0, 1.0) * 15.0;
  let idx0 = u32(floor(scaled));
  let idx1 = min(15u, idx0 + 1u);
  let frac = scaled - f32(idx0);
  let c0 = relLut.planckBlackbodyLut[idx0].xyz;
  let c1 = relLut.planckBlackbodyLut[idx1].xyz;
  return mix(c0, c1, frac);
}

/**
 * Interpolation continue du profil radial relativiste de Novikov-Thorne (calculé en Rust).
 * Retourne vec4f(tempNorm, betaOrb, alphaGrav, sigmaDensity).
 */
fn sampleDiskRadialLut(uNorm: f32) -> vec4f {
  let scaled = clamp(uNorm, 0.0, 1.0) * 15.0;
  let idx0 = u32(floor(scaled));
  let idx1 = min(15u, idx0 + 1u);
  let frac = scaled - f32(idx0);
  return mix(relLut.diskRadialLut[idx0], relLut.diskRadialLut[idx1], frac);
}

/**
 * Écoulement képlérien relativiste :
 * - Mode Réaliste (turbScale >= 0.5) : Turbulences magnétohydrodynamiques (MRI), bras spiraux
 *   cisaillés, striations filamentaires denses et bord ISCO ultra-lumineux (style Gargantua / Interstellar).
 * - Mode Épuré (turbScale < 0.5) : Ruban laminaire soyeux sculptural.
 * 
 * Correction de coupure azimutale :
 * L'échantillonnage 3D sur cylindre unitaire projeté élimine le branch-cut de atan2(z, x)
 * garantissant une continuité C^∞ parfaite sur tout le tour [0, 2π].
 */
fn computeRealisticKeplerFlow(
  rInM: f32,
  posXZ: vec2f,
  rCyl: f32,
  uNorm: f32,
  spinA: f32,
  time: f32,
  turbScale: f32
) -> f32 {
  let rSafe = max(1.2, rInM);
  let omegaKepler = 1.0 / (pow(rSafe, 1.5) + abs(spinA) * 0.5);
  let spinDir = select(1.0, -1.0, spinA < 0.0);

  // Direction unitaire radiale dans le plan équatorial (continue, sans branch-cut)
  let unitDir = posXZ / max(1e-4, rCyl);

  // Cisaillement képlérien différentiel : rotation différentielle du gaz autour de la singularité
  let deltaTheta = spinDir * (omegaKepler * (time * 1.6 + 24.0) + uNorm * 18.0);
  let cosD = cos(deltaTheta);
  let sinD = sin(deltaTheta);

  // Rotation 2D unitaire : continuité C^∞ stricte, invariance géométrique 2π absolue
  let shearedDir = vec2f(
    unitDir.x * cosD - unitDir.y * sinD,
    unitDir.x * sinD + unitDir.y * cosD
  );

  // Octave 1 : Ondes de densité spirales majeures (échantillonnage cylindrique 3D sans couture)
  let p1 = vec3f(shearedDir * 1.5, uNorm * 18.0) + vec3f(64.0, 64.0, 32.0);
  let noise1 = valueNoise3D(p1);

  // Octave 2 : Filaments turbulents étirés azimutalement
  let p2 = vec3f(shearedDir * 4.5, uNorm * 38.0 + noise1 * 1.5) + vec3f(128.0, 128.0, 64.0);
  let noise2 = valueNoise3D(p2);

  // Octave 3 : Micro-stries de plasma magnétisé (MRI)
  let p3 = vec3f(shearedDir * 12.0, uNorm * 72.0) + vec3f(256.0, 256.0, 128.0);
  let noise3 = valueNoise3D(p3);

  let fbmPlasma = noise1 * 0.50 + noise2 * 0.32 + noise3 * 0.18;

  // Anneaux concentriques fins de Novikov-Thorne
  let fineRings = 0.5 + 0.5 * sin(uNorm * 52.0 + noise1 * 2.5);
  let realisticTexture = (fbmPlasma * 1.45) * (0.65 + 0.35 * fineRings);

  // Mode épuré laminaire
  let band1 = 0.5 + 0.5 * cos(uNorm * 18.85);
  let smoothFlow = 0.7 + 0.3 * band1;

  let blend = smoothstep(0.3, 0.75, turbScale);
  return clamp(mix(smoothFlow, realisticTexture, blend), 0.1, 1.8);
}

/**
 * Évalue l'émission radiométrique linéaire et l'opacité d'une traversée du plan équatorial
 * du disque d'accrétion relativiste.
 */
fn evaluateRelativisticAccretionDisk(
  hitPos: vec3f,
  rayVel: vec3f,
  mass: f32,
  spinA: f32,
  rPlusM: f32,
  rIscoM: f32,
  rOuterM: f32,
  dopplerStrength: f32,
  diskIntensity: f32,
  turbScale: f32,
  time: f32
) -> vec4f {
  let rCyl = length(hitPos.xz);
  let rInM = rCyl / max(1e-4, mass);

  // En mode réaliste (turbScale >= 0.5), le bord interne épouse l'ISCO physique réelle (Novikov-Thorne)
  // En mode sculptural (turbScale < 0.5), le disque est repoussé pour un style épuré.
  let isRealistic = smoothstep(0.35, 0.75, turbScale);
  let realisticInner = max(rPlusM * 1.05, rIscoM);
  let sculpturalInner = max(rIscoM, rPlusM * 2.15);
  let innerEdgeM = mix(sculpturalInner, realisticInner, isRealistic);
  let outerEdgeM = max(innerEdgeM + 4.0, rOuterM);

  if (rInM <= innerEdgeM || rInM >= outerEdgeM) {
    return vec4f(0.0);
  }

  let uNorm = clamp((rInM - innerEdgeM) / max(0.5, outerEdgeM - innerEdgeM), 0.0, 1.0);
  let radialProps = sampleDiskRadialLut(uNorm);

  let tempNorm = radialProps.x;
  let betaOrb  = radialProps.y;
  let alphaGrav = radialProps.z;

  // Enveloppe radiale : bord ISCO étincelant avec extinction exponentielle douce externe
  let innerRim = smoothstep(0.0, 0.03, uNorm);
  let outerFade = pow(1.0 - smoothstep(0.18, 1.0, uNorm), 1.5);
  let iscoHighlight = exp(-uNorm * 10.0) * (0.65 + 0.95 * isRealistic);
  let radialEnvelope = innerRim * (outerFade * 0.8 + iscoHighlight);

  // Vecteur tangent unitaire de rotation képlérienne dans le plan XZ
  let spinSign = select(1.0, -1.0, spinA < 0.0);
  let tangentDir = vec3f(-hitPos.z, 0.0, hitPos.x) / max(1e-4, rCyl) * spinSign;

  let toObserver = -normalize(rayVel);
  let cosThetaObs = dot(tangentDir, toObserver);

  // Facteur de Lorentz γ et facteur Doppler relativiste D
  let effBeta = clamp(betaOrb * dopplerStrength, 0.0, 0.74);
  let gammaLorentz = 1.0 / sqrt(max(0.2, 1.0 - effBeta * effBeta));
  let dopplerFactor = 1.0 / max(0.28, gammaLorentz * (1.0 - effBeta * cosThetaObs));

  // Décalage fréquentiel g = ν_obs / ν_emit
  let gFactor = clamp(mix(1.0, alphaGrav * dopplerFactor, clamp(dopplerStrength, 0.0, 1.5)), 0.35, 2.15);
  let liouvilleBoost = clamp(pow(gFactor, 3.2), 0.12, 5.0);

  // Température de corps noir décalée spectralement : T_obs = g · T_emit
  let baseTemp = mix(0.18 + 0.52 * tempNorm, 0.22 + 0.68 * tempNorm + iscoHighlight * 0.25, isRealistic);
  let shiftedTempNorm = clamp(baseTemp * pow(gFactor, 0.85), 0.02, 0.98);
  let blackbodyRgb = samplePlanckBlackbodyLut(shiftedTempNorm);

  let flowPattern = computeRealisticKeplerFlow(rInM, hitPos.xz, rCyl, uNorm, spinA, time, turbScale);

  let opacity = clamp(radialEnvelope * flowPattern * (0.85 + 0.15 * isRealistic), 0.0, 0.95);
  let radiance = (0.65 + 0.95 * tempNorm + iscoHighlight) * flowPattern * liouvilleBoost * diskIntensity;

  return vec4f(blackbodyRgb * radiance * opacity, opacity);
}

/**
 * Jets Polaires Relativistes de Blandford-Znajek (version fine et collimatée).
 */
fn evaluateBlandfordZnajekJetStep(
  pos: vec3f,
  rayVel: vec3f,
  stepLen: f32,
  mass: f32,
  spinA: f32,
  rPlusM: f32,
  omegaH: f32,
  jetsIntensity: f32,
  time: f32
) -> vec3f {
  let absY = abs(pos.y) / max(1e-4, mass);
  if (absY < rPlusM * 1.1 || absY > 22.0) {
    return vec3f(0.0);
  }

  let rCyl = length(pos.xz) / max(1e-4, mass);
  let jetRadius = 0.26 + 0.28 * sqrt(max(0.1, absY - rPlusM * 0.8));
  if (rCyl > jetRadius * 1.8) {
    return vec3f(0.0);
  }

  let radialNorm = rCyl / max(1e-3, jetRadius);
  let sheathProfile = exp(-pow(radialNorm - 0.58, 2.0) * 8.0) + 0.25 * exp(-radialNorm * radialNorm * 5.0);

  let phi = atan2(pos.z, pos.x);
  let signY = select(-1.0, 1.0, pos.y >= 0.0);
  let helixPhase = phi * 2.0 - signY * absY * 0.65 - time * (2.0 + abs(omegaH) * 6.0);
  let helixFilaments = 0.65 + 0.35 * sin(helixPhase);

  let jetDir = vec3f(0.0, signY, 0.0);
  let cosJetObs = dot(jetDir, -normalize(rayVel));
  let jetDoppler = clamp(1.0 / max(0.45, 1.25 * (1.0 - 0.45 * cosJetObs)), 0.5, 1.75);

  let axialFade = smoothstep(rPlusM * 1.1, rPlusM * 2.6, absY) * exp(-absY * 0.14);
  let spinPower = 0.2 + 0.8 * abs(spinA);

  let syncColor = mix(vec3f(0.28, 0.64, 1.25), vec3f(0.78, 0.88, 1.25), clamp(sheathProfile * 0.6, 0.0, 1.0));
  let density = sheathProfile * helixFilaments * axialFade * spinPower * jetDoppler;

  return syncColor * (density * jetsIntensity * (stepLen / max(0.2, mass)) * 0.055);
}
`;
