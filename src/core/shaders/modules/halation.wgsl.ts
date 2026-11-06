/**
 * Module : Halation Photochimique Tricouche (Kodak Vision3 / CineStill 800T)
 *
 * Origine physique & photochimique modélisée :
 * 1. Architecture stratifiée d'une pellicule argentique couleur :
 *    - Couche supérieure : Halogénures d'argent sensibles au Bleu (400–500 nm)
 *    - Filtre jaune (Tartrazine) : bloque définitivement les photons bleus résiduels
 *    - Couche médiane : Halogénures d'argent sensibles au Vert (500–600 nm)
 *    - Couche inférieure : Halogénures d'argent sensibles au Rouge (600–700 nm)
 *    - Support dorsal : Base transparente en triacétate de cellulose (épaisseur ~125 µm, n = 1.48)
 * 2. Réflexion Interne Totale de Fresnel & Transport Radiatif de Beer-Lambert :
 *    Les photons d'une source intense traversent l'émulsion et diffusent dans le support dorsal.
 *    Au-delà de l'angle critique de Fresnel θ_c = arcsin(1 / 1.48) ≈ 42.5°, les rayons subissent
 *    une réflexion interne totale sur la face arrière du film et frappent PAR EN DESSOUS :
 *    - Immédiatement la couche Rouge profonde sur un large rayon exponentiel exp(-r / l_R).
 *    - Partiellement la couche Verte médiane uniquement à courte distance exp(-r / l_G).
 *    => Cœur orangé/ambré brûlant tout contre le bord lumineux, virant au rouge rubis profond au loin !
 * 3. Couplage photochimique Hurter-Driffield & Grain d'Émulsion :
 *    L'halation étant une exposition réelle des cristaux d'argent de la couche rouge, elle réagit
 *    de façon organique à la granulation du capteur/film (modulation par la densité locale du grain).
 */
export const halationChunk = /* wgsl */ `
/**
 * Évalue la rétrodiffusion photochimique d'Halation à travers les 3 couches d'émulsion
 * en utilisant les poids de transport radiatif Beer-Lambert précalculés par le noyau Rust WASM.
 *
 * @param uv                Coordonnées UV normalisées [0, 1]
 * @param resolution        Résolution physique du framebuffer
 * @param halationRadius    Échelle spatiale de diffusion dans le support en triacétate
 * @param halationIntensity Gain d'exposition du halo rétrodiffusé
 * @param grainSignal       Signal de granulation locale signé [-1, 1] pour texturer l'émulsion rouge
 * @returns                 Flux lumineux linéaire RGB de l'Halation
 */
fn computeFilmHalation(
  uv: vec2f,
  resolution: vec2f,
  halationRadius: f32,
  halationIntensity: f32,
  grainSignal: f32
) -> vec3f {
  let baseTexel = (1.0 / max(vec2f(1.0), resolution)) * max(0.35, halationRadius);

  let h0 = optLut.halationMipWeights[0];
  let h1 = optLut.halationMipWeights[1];
  let h2 = optLut.halationMipWeights[2];
  let h3 = optLut.halationMipWeights[3];
  let h4 = optLut.halationMipWeights[4];

  // Échantillonnage isotrope multi-échelle de la densité Hurter-Driffield (.a) et du flux (.rgb)
  let s0 = sampleTent9Tap(t_mip0, s_linear, uv, baseTexel * 1.6  * h0.w);
  let s1 = sampleTent9Tap(t_mip1, s_linear, uv, baseTexel * 3.5  * h1.w);
  let s2 = sampleTent9Tap(t_mip2, s_linear, uv, baseTexel * 7.5  * h2.w);
  let s3 = sampleTent9Tap(t_mip3, s_linear, uv, baseTexel * 15.5 * h3.w);
  let s4 = sampleTent9Tap(t_mip4, s_linear, uv, baseTexel * 31.0 * h4.w);

  // Énergie d'exposition arrivant sur la face dorsale en triacétate pour chaque octave spatiale
  let e0 = max(s0.a, dot(s0.rgb, vec3f(0.55, 0.35, 0.10)));
  let e1 = max(s1.a, dot(s1.rgb, vec3f(0.55, 0.35, 0.10)));
  let e2 = max(s2.a, dot(s2.rgb, vec3f(0.55, 0.35, 0.10)));
  let e3 = max(s3.a, dot(s3.rgb, vec3f(0.55, 0.35, 0.10)));
  let e4 = max(s4.a, dot(s4.rgb, vec3f(0.55, 0.35, 0.10)));

  // Intégration par couche d'émulsion selon la loi de Beer-Lambert (calculée en Rust) :
  // - Couche Rouge (fond) : capte à la fois le rebond proche et la longue queue de réflexion totale
  let redLayerExposure = e0 * h0.x + e1 * h1.x + e2 * h2.x + e3 * h3.x + e4 * h4.x;

  // - Couche Verte (milieu) : ne capte que les rayons rétrodiffusés très proches de la normale (s0, s1)
  //   ce qui crée la transition physique Or/Ambre -> Rouge CinéStill authentique
  let greenLayerExposure = e0 * h0.y + e1 * h1.y + e2 * h2.y + e3 * h3.y + e4 * h4.y;

  // - Couche Bleue (haut, bloquée par la Tartrazine) : trace infinitésimale sur le cœur immédiat
  let blueLayerExposure = e0 * h0.z + e1 * h1.z;

  // Colorants coupleurs chromogènes Kodak Vision3 (Cyan, Magenta, Jaune inversés en positif) :
  // Le pic spectral de la couche rouge développée se situe autour de 635–665 nm
  let emulsionHalo = vec3f(
    redLayerExposure * 1.08,
    greenLayerExposure * 0.88 + redLayerExposure * 0.09,
    blueLayerExposure * 0.55 + redLayerExposure * 0.018
  );

  // Courbe d'épaule photochimique (saturation douce des halogénures d'argent de la couche rouge)
  let compressedHalo = emulsionHalo / (vec3f(1.0) + emulsionHalo * 0.65);

  // Couplage organique avec la granulation : l'halation révèle les grains de la couche rouge !
  let emulsionGrainMod = 1.0 + clamp(grainSignal * 0.38, -0.28, 0.38);

  return compressedHalo * halationIntensity * emulsionGrainMod;
}
`;
