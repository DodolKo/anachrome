/**
 * Module : Sensor Noise Fujifilm X-Trans (Super 35 / APS-C)
 *
 * Reproduction physique et mathématique du capteur CMOS Fujifilm X-Trans :
 * 1. PRNG 3D entier bitwise (PCG3D) sur 24 bits de mantisse IEEE-754 exacts :
 *    zéro dérive temporelle (dx/dt = 0) et zéro débordement flottant (jamais de NaN sous Metal).
 * 2. Transformation de Box-Muller bornée pour une distribution gaussienne N(0, 1) irréprochable.
 * 3. Matrice CFA X-Trans 6x6 apériodique réelle (55.5% Vert, 22.2% Rouge, 22.2% Bleu).
 * 4. Granulation ISO Fujifilm (Small -> Large) sans pixellisation :
 *    - Échelle photographique logarithmique en stops (EV) de ISO 20 à ISO 12800.
 *    - Interpolation C2 à variance normalisée (L2) : grossissement organique du grain avec l'ISO
 *      sans jamais créer de blocs carrés ni dépasser la fréquence de Nyquist matérielle.
 * 5. Micro-persistance temporelle à variance constante :
 *    - Fusion temporelle entre trames successives normalisée par inverseSqrt((1-w)^2 + w^2),
 *      éliminant toute saccade visuelle à bas FPS sans perte de contraste.
 * 6. Protection matérielle DSC (Display Stream Compression) :
 *    - Chrominance dématricée C2 en espace opposant Co/Cg sans inversion de signe par canal,
 *      garantissant zéro artéfact sur le bord droit des écrans Ultrawide même à ISO/Chroma extrêmes.
 */
export const filmGrainChunk = /* wgsl */ `
// Matrice CFA Fujifilm X-Trans 6x6 :
// 0 = Rouge, 1 = Vert, 2 = Bleu
// 20 Verts (55.5%), 8 Rouges (22.2%), 8 Bleus (22.2%)
const XTRANS_CFA = array<u32, 36>(
  1u, 0u, 1u, 1u, 2u, 1u, // Ligne 0 : G R G G B G
  2u, 1u, 2u, 0u, 1u, 0u, // Ligne 1 : B G B R G R
  1u, 0u, 1u, 1u, 2u, 1u, // Ligne 2 : G R G G B G
  1u, 2u, 1u, 1u, 0u, 1u, // Ligne 3 : G B G G R G
  0u, 1u, 0u, 2u, 1u, 2u, // Ligne 4 : R G R B G B
  1u, 2u, 1u, 1u, 0u, 1u  // Ligne 5 : G B G G R G
);

/**
 * Récupère le type de photosite CFA X-Trans à la coordonnée entière donnée.
 */
fn getXTransCFA(pos: vec2<u32>) -> u32 {
  let x = pos.x % 6u;
  let y = pos.y % 6u;
  return XTRANS_CFA[y * 6u + x];
}

/**
 * Générateur Pseudo-Aléatoire PCG 3D (Permuted Congruential Generator).
 * Décalage de 8 bits (>> 8u) pour correspondre exactement aux 24 bits de mantisse
 * d'un f32 IEEE-754 : garantit un intervalle [0.0, 1.0) strict sans jamais arrondir à 1.0.
 */
fn pcg3d(p: vec3<u32>) -> vec3<f32> {
  var v = p * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3<u32>(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return vec3<f32>(v >> vec3<u32>(8u)) * (1.0 / 16777216.0);
}

/**
 * Transformation de Box-Muller sécurisée.
 * Convertit deux variables aléatoires uniformes U(0, 1) en deux variables
 * gaussiennes indépendantes N(0, 1), avec bornage strict anti-NaN pour Metal.
 */
fn boxMuller(u: vec2f) -> vec2f {
  let u1 = clamp(u.x, 1e-6, 0.999999);
  let r = sqrt(-2.0 * log(u1));
  let theta = 6.283185307179586 * u.y;
  return vec2f(r * cos(theta), r * sin(theta));
}

/**
 * Réponse d'un photosite individuel X-Trans avec crosstalk optique horizontal.
 * Retourne un tirage gaussien N(0, 1) pondéré par la sensibilité spectrale R/G/B de la matrice 6x6.
 */
fn samplePhotositeLum(p: vec2<u32>, frame: u32) -> f32 {
  let uCenter = pcg3d(vec3<u32>(p.x, p.y, frame));
  let uLeft   = pcg3d(vec3<u32>(max(1u, p.x) - 1u, p.y, frame));

  let gCenter = boxMuller(uCenter.xy).x;
  let gLeft   = boxMuller(uLeft.xy).x;

  // Diffusion optique horizontale dans le silicium (normalisée en variance : sqrt(0.84^2 + 0.16^2) = 0.855)
  let opticalSample = (gCenter * 0.84 + gLeft * 0.16) * 1.169;

  // Pondération spectrale selon le photosite de la matrice 6x6 X-Trans
  let cfaType = getXTransCFA(p);
  var cfaWeight = 1.0;
  if (cfaType == 0u) {
    cfaWeight = 1.06; // Photosite Rouge
  } else if (cfaType == 1u) {
    cfaWeight = 0.94; // Photosite Vert (55.5% de la matrice, meilleur SNR)
  } else {
    cfaWeight = 1.10; // Photosite Bleu (plus bruyant)
  }

  return opticalSample * cfaWeight;
}

/**
 * Micro-grain continu C2 à variance constante N(0, 1).
 * Permet de faire grossir la taille du grain continûment (avec grainScale et l'ISO)
 * sans JAMAIS produire de blocs carrés (pixellisation) ni de perte de contraste entre les sommets.
 */
fn smoothPhotositeMicroNoise(pos: vec2f, frame: u32) -> f32 {
  let i = vec2<u32>(floor(pos));
  let f = fract(pos);

  // Interpolation quintique C2 : 6f^5 - 15f^4 + 10f^3
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  let a = samplePhotositeLum(i + vec2<u32>(0u, 0u), frame);
  let b = samplePhotositeLum(i + vec2<u32>(1u, 0u), frame);
  let c = samplePhotositeLum(i + vec2<u32>(0u, 1u), frame);
  let d = samplePhotositeLum(i + vec2<u32>(1u, 1u), frame);

  let interpX0 = mix(a, b, w.x);
  let interpX1 = mix(c, d, w.x);
  let rawVal = mix(interpX0, interpX1, w.y);

  // Normalisation exacte de la variance L2 : maintient Var = 1.0 même au centre des cellules (w = 0.5)
  let normX = inverseSqrt((1.0 - w.x) * (1.0 - w.x) + w.x * w.x);
  let normY = inverseSqrt((1.0 - w.y) * (1.0 - w.y) + w.y * w.y);

  return rawVal * normX * normY;
}

/**
 * Hash gaussien borné pour les sommets du réseau de Meso-Grain et de Chrominance.
 */
fn hashLatticeGaussian(p: vec2<u32>, frame: u32, channelSeed: u32) -> f32 {
  let u = pcg3d(vec3<u32>(p.x, p.y, frame ^ channelSeed));
  return boxMuller(u.xy).x;
}

/**
 * Bruit spatial C2 à variance normalisée pour les amas organiques de dématriçage (Meso-Grain & Chroma).
 */
fn smoothMesoNoise(pos: vec2f, frame: u32, channelSeed: u32) -> f32 {
  let i = vec2<u32>(floor(pos));
  let f = fract(pos);

  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  let a = hashLatticeGaussian(i + vec2<u32>(0u, 0u), frame, channelSeed);
  let b = hashLatticeGaussian(i + vec2<u32>(1u, 0u), frame, channelSeed);
  let c = hashLatticeGaussian(i + vec2<u32>(0u, 1u), frame, channelSeed);
  let d = hashLatticeGaussian(i + vec2<u32>(1u, 1u), frame, channelSeed);

  let rawVal = mix(mix(a, b, w.x), mix(c, d, w.x), w.y);

  // Normalisation de variance L2 pour préserver toute l'énergie des amas organiques
  let normX = inverseSqrt((1.0 - w.x) * (1.0 - w.x) + w.x * w.x);
  let normY = inverseSqrt((1.0 - w.y) * (1.0 - w.y) + w.y * w.y);

  return rawVal * normX * normY;
}

/**
 * Évalue une trame unique du capteur Fujifilm X-Trans.
 * Retourne vec3f(luminance, chromaCo, chromaCg) de variance unitaire avant mise à l'échelle ISO.
 */
fn evaluateXTransFrame(
  pixelCoord: vec2f,
  frame: u32,
  effectiveScale: f32,
  isoNorm: f32,
  microRatio: f32,
  mesoRatio: f32,
  mesoScale: f32
) -> vec3f {
  let scaledCoord = pixelCoord / effectiveScale;

  // 1. Micro-grain photosite C2 (finesse X-Trans)
  let microLum = smoothPhotositeMicroNoise(scaledCoord, frame);

  // 2. Meso-grain : amas organiques issus du dématriçage 6x6 X-Trans
  // Plus l'ISO monte, plus les amas organiques prennent du corps (simulation Grain Effect Fuji)
  let clusterFreq = clamp(mesoScale, 0.15, 1.5) * mix(0.85, 0.52, clamp(isoNorm, 0.0, 1.0));
  let mesoPos = scaledCoord * clusterFreq;
  let mesoLum = smoothMesoNoise(mesoPos, frame, 0x27d4eb2du);

  // Équilibre dynamique Micro / Meso selon l'ISO, normalisé en énergie L2
  let wMicro = max(0.0, microRatio) * mix(1.15, 0.65, clamp(isoNorm, 0.0, 1.0));
  let wMeso  = max(0.0, mesoRatio)  * mix(0.60, 1.75, clamp(isoNorm, 0.0, 1.0));
  let wNorm  = inverseSqrt(max(1e-5, wMicro * wMicro + wMeso * wMeso));
  let combinedLum = (microLum * wMicro + mesoLum * wMeso) * wNorm;

  // 3. Canaux chromatiques dématricés en espace opposant (Co = Rouge/Bleu, Cg = Vert/Magenta)
  // Évalués à l'échelle de la matrice 6x6 X-Trans (variation spatiale ultra-douce compatible DSC)
  let chromaPos = scaledCoord * (clusterFreq * 0.55);
  let chromaCo = smoothMesoNoise(chromaPos, frame, 0x165667b1u);
  let chromaCg = smoothMesoNoise(chromaPos, frame, 0xd3a2646cu);

  return vec3f(combinedLum, chromaCo, chromaCg);
}

/**
 * Moteur complet de Sensor Noise Fujifilm X-Trans avec Micro-Persistance Temporelle :
 *
 * @param pixelCoord    Coordonnée physique dans le framebuffer
 * @param frame         Indice de trame entier (temporel, sans dérive spatiale)
 * @param temporalBlend Facteur d'interpolation temporelle [0.0, 1.0] entre (frame - 1) et (frame)
 * @param iso           Sensibilité ISO (de 20 à 12800)
 * @param chromaAmount  Degré de bruit chromatique (0.0 = pur monochrome, 1.0 = plein chromatique)
 * @param microRatio    Pondération du micro-grain haute fréquence
 * @param mesoRatio     Pondération des amas organiques moyenne fréquence
 * @param mesoScale     Échelle spatiale des amas de dématriçage
 * @param grainScale    Échelle de base du grain
 * @returns             vec4f(chromaTint.rgb, signedLuminance)
 */
fn computeFujiXTransGrain(
  pixelCoord: vec2f,
  frame: u32,
  temporalBlend: f32,
  iso: f32,
  chromaAmount: f32,
  microRatio: f32,
  mesoRatio: f32,
  mesoScale: f32,
  grainScale: f32
) -> vec4f {
  // 1. Échelle photographique logarithmique (en stops EV de ISO 20 à ISO 64000)
  // Garantit une progression visible et naturelle sur toute la plage (24 -> 100 -> 800 -> 3200 -> 6400 -> 51200+)
  let clampedIso = clamp(iso, 20.0, 64000.0);
  let isoNorm = clamp(log2(clampedIso / 20.0) / log2(6400.0 / 20.0), 0.0, 1.55);

  // 2. Grossissement physique et organique du grain avec l'ISO ("Grain Size" style Fujifilm)
  // Plancher strict >= 1.0px physique pour interdire tout repliement de Nyquist (sécurité écran DSC)
  let baseScale = max(0.65, grainScale);
  let isoSizeFactor = 1.0 + 1.25 * pow(isoNorm, 1.30);
  let effectiveScale = max(1.0, baseScale * isoSizeFactor);

  // 3. Évaluation de la trame courante + Micro-Persistance Temporelle à variance constante
  let currSample = evaluateXTransFrame(
    pixelCoord,
    frame,
    effectiveScale,
    isoNorm,
    microRatio,
    mesoRatio,
    mesoScale
  );

  var sensorSample = currSample;
  let w = clamp(temporalBlend, 0.0, 1.0);
  if (w < 0.999 && frame > 0u) {
    let prevSample = evaluateXTransFrame(
      pixelCoord,
      frame - 1u,
      effectiveScale,
      isoNorm,
      microRatio,
      mesoRatio,
      mesoScale
    );
    // Normalisation L2 exacte : maintient la variance gaussienne constante à 100% pendant le fondu
    let temporalNorm = inverseSqrt((1.0 - w) * (1.0 - w) + w * w);
    sensorSample = (prevSample * (1.0 - w) + currSample * w) * temporalNorm;
  }

  // 4. Gain de luminance ISO avec courbe d'épaule analogique (Full-Well Capacity)
  let lumGain = 0.48 + 1.35 * pow(isoNorm, 1.15);
  let signedLum = tanh(sensorSample.x * lumGain * 0.65) * 1.40;

  // 5. Colorimétrie chromatique X-Trans sécurisée (Co/Cg -> teinte RGB positive cohérente)
  // Fonctionne dès les bas ISO et s'amplifie naturellement avec la montée en ISO
  let cAmount = clamp(chromaAmount, 0.0, 1.0);
  let isoChromaBoost = 0.55 + 0.75 * isoNorm;
  let chromaStrength = pow(cAmount, 0.75) * isoChromaBoost;

  let rawCo = sensorSample.y;
  let rawCg = sensorSample.z;

  // Décodage opposant vers décalages R, G, B (capteurs Rouge et Bleu plus bruyants que le Vert X-Trans)
  let chromaDelta = vec3f(
    rawCo * 0.85 - rawCg * 0.35,
    rawCg * 0.65,
    -rawCo * 0.95 - rawCg * 0.35
  );

  // Bornage doux par tanh : garantit que chromaTint reste strictement positif dans [0.25, 1.75]
  // Zéro inversion de signe par canal = zéro pic primaire saturé = zéro glitch DSC sur l'écran
  let chromaTint = vec3f(1.0) + tanh(chromaDelta * chromaStrength * 0.95) * 0.75;

  return vec4f(chromaTint, signedLum);
}
`;
