/**
 * Module : Aberration Chromatique Physique & Spectrale (Sellmeier + Seidel + CIE 1931)
 *
 * Origine physique modélisée :
 * 1. Loi de dispersion de Sellmeier (calculée en Rust/WASM sur 12 bandes de 405 nm à 695 nm) :
 *    L'indice de réfraction du verre optique dépend non-linéairement de la longueur d'onde n(λ).
 *    Le violet/bleu (410 nm) est beaucoup plus réfracté que le vert (550 nm), lui-même plus
 *    réfracté que le rouge profond (685 nm).
 * 2. Aberration Chromatique Latérale / Transversale (TCA) & Polynôme de Seidel :
 *    Le grandissement transversal varie selon λ et s'amplifie non-linéairement vers les coins
 *    selon les aberrations de Seidel d'ordre 1, 3 et 5 : Δr(λ, r) = δ_TCA(λ) * (k1*r + k3*r^3 + k5*r^5).
 *    Au centre optique (r = 0), la TCA est strictement nulle. Aux 4 coins, la dispersion est maximale.
 * 3. Aberration Chromatique Axiale / Longitudinale (LCA - Sphérochromatisme) :
 *    Même au centre optique (r = 0), les longueurs d'onde extrêmes ne focalisent pas exactement
 *    sur le plan du capteur à grande ouverture (ex: f/1.4), créant un cercle de confusion δ_LCA(λ)
 *    échantillonné suivant une spirale d'angle d'or (Golden Angle = 2.39996 rad).
 * 4. Intégration Spectrale CIE 1931 2° Standard Observer :
 *    Au lieu d'un décalage R/G/B artificiel à 3 canaux, le shader intègre 12 longueurs d'onde
 *    continues projetées via les fonctions colorimétriques CIE 1931 XYZ -> Rec.709 linéaire
 *    avec jittering sous-longueur d'onde (Interleaved Gradient Noise) pour un spectre continu.
 */
export const chromaticAberrationChunk = /* wgsl */ `
const SPECTRAL_BANDS: u32 = 12u;
const GOLDEN_ANGLE: f32 = 2.399963229728653;

/**
 * Bruit de gradient entrelacé (Interleaved Gradient Noise - Jorge Jimenez)
 * Utilisé pour le jittering sous-longueur d'onde le long du vecteur de dispersion
 * afin d'éliminer toute discrétisation (stepping) à forte aberration chromatique.
 */
fn spectralBlueJitter(pixelCoord: vec2f) -> f32 {
  let magic = vec3f(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(pixelCoord, magic.xy))) - 0.5;
}

/**
 * Conversion sRGB vers Espace Linéaire Radiométrique (avant intégration spectrale)
 */
fn srgbToLinearCA(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
}

/**
 * Échantillonne la scène à travers le doublet optique dispersif (Sellmeier + Seidel + CIE 1931).
 *
 * @param sceneTex      Texture source de la scène DOM
 * @param sceneSampler  Sampler linéaire clamp-to-edge
 * @param uv            Coordonnées UV normalisées [0, 1]
 * @param pixelCoord    Coordonnées physiques du pixel
 * @param resolution    Résolution physique du framebuffer
 * @param caStrength    Intensité globale de la dispersion latérale (en % du rayon optique)
 * @param axialStrength Intensité du sphérochromatisme longitudinal (cercle de confusion en pixels)
 * @returns             vec4f(linearRefractedRgb, effectiveAlpha)
 */
fn sampleSpectralChromaticAberration(
  sceneTex: texture_2d<f32>,
  sceneSampler: sampler,
  uv: vec2f,
  pixelCoord: vec2f,
  resolution: vec2f,
  caStrength: f32,
  axialStrength: f32
) -> vec4f {
  let aspect = resolution.x / max(1.0, resolution.y);
  let invAspect = 1.0 / max(1e-4, aspect);

  // Coordonnées centrées sur l'axe optique : coins normalisés à r ≈ 1.0
  let centered = uv - vec2f(0.5, 0.5);
  let metricPos = vec2f(centered.x * aspect, centered.y);
  let cornerRadius = sqrt(0.25 * aspect * aspect + 0.25);
  let rNorm = length(metricPos) / max(1e-4, cornerRadius);

  // Direction radiale (méridienne / tangentielle) et orthogonale (sagittale)
  let radialDir = select(vec2f(0.0), normalize(metricPos), rNorm > 1e-5);
  let sagittalDir = vec2f(-radialDir.y, radialDir.x);

  // Polynôme d'aberration de Seidel d'ordre 1, 3 et 5 précalculé en Rust
  let seidel = optLut.seidelAndFresnel[0];
  let r2 = rNorm * rNorm;
  let r3 = r2 * rNorm;
  let r5 = r3 * r2;
  let seidelProfile = seidel.x * rNorm + seidel.y * r3 + seidel.z * r5;

  // Astigmatisme hors-axe dans les coins extrêmes
  let astigmatismFactor = seidel.w * r3;

  // Jittering spectral continu [-0.5, +0.5] d'un intervalle de bande
  let jitter = spectralBlueJitter(pixelCoord);
  let texelSize = 1.0 / max(vec2f(1.0), resolution);

  var accumLinearRgb = vec3f(0.0);
  var accumAlpha = 0.0;
  var weightAlphaSum = 0.0;

  for (var i: u32 = 0u; i < SPECTRAL_BANDS; i = i + 1u) {
    let disp = optLut.spectralDispersion[i];
    let specWeight = optLut.spectralWeightsRgb[i];

    // Interpolation continue du décalage de Sellmeier avec le jitter sous-bande
    let nextIdx = min(SPECTRAL_BANDS - 1u, i + 1u);
    let prevIdx = select(0u, i - 1u, i > 0u);
    let dSlope = 0.5 * (optLut.spectralDispersion[nextIdx].x - optLut.spectralDispersion[prevIdx].x);
    let tcaLambda = disp.x + jitter * dSlope;

    // 1. Décalage d'Aberration Chromatique Latérale (TCA) le long de l'axe radial
    let radialShiftMetric = radialDir * (tcaLambda * seidelProfile * caStrength);
    let radialShiftUv = vec2f(radialShiftMetric.x * invAspect, radialShiftMetric.y);

    // 2. Aberration Chromatique Axiale / Sphérochromatisme (LCA) + Astigmatisme sagittal
    // Tourne selon l'angle d'or par bande spectrale pour former un vrai disque de défocalisation optique
    let theta = f32(i) * GOLDEN_ANGLE + jitter * 0.5;
    let cocRadiusPx = disp.y * axialStrength * (1.0 + 0.65 * r2);
    let lcaDir = cos(theta) * radialDir * (1.0 + astigmatismFactor) + sin(theta) * sagittalDir * (1.0 - astigmatismFactor * 0.5);
    let lcaShiftUv = lcaDir * cocRadiusPx * texelSize;

    let sampleUv = uv + radialShiftUv + lcaShiftUv;
    let inBandBounds = select(
      0.0,
      1.0,
      sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0
    );
    let clampedSampleUv = clamp(sampleUv, vec2f(0.0), vec2f(1.0));
    let texSample = textureSampleLevel(sceneTex, sceneSampler, clampedSampleUv, 0.0);

    // Le sample issu de copyExternalImageToTexture est en alpha prémultiplié sRGB :
    // on dé-prémultiplie proprement avant de passer en linéaire pour ne pas assombrir les bords
    let cov = texSample.a * inBandBounds;
    let unpremultSrgb = select(vec3f(0.0), clamp(texSample.rgb / max(1e-4, cov), vec3f(0.0), vec3f(1.0)), cov > 1e-4);
    let linearSample = srgbToLinearCA(unpremultSrgb) * cov;

    // Intégration spectrale pondérée par CIE 1931 -> Rec.709 (somme des poids = 1.0 par canal)
    accumLinearRgb += linearSample * specWeight.xyz;

    // Pondération de la couverture alpha par l'efficacité lumineuse photopique V(λ) + moyenne spectrale
    let bandImportance = (specWeight.x + specWeight.y + specWeight.z) / 3.0;
    accumAlpha += cov * bandImportance;
    weightAlphaSum += bandImportance;
  }

  let finalAlpha = clamp(accumAlpha / max(1e-5, weightAlphaSum), 0.0, 1.0);
  return vec4f(accumLinearRgb, finalAlpha);
}
`;
