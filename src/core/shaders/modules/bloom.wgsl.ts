/**
 * Module : Bloom Optique Physique (Diffraction d'Airy + Diffusion de Mie + Flare Anamorphique)
 *
 * Origine physique modélisée :
 * 1. Diffraction de Fraunhofer par l'ouverture pupillaire :
 *    Toute source ponctuelle traversant une pupille circulaire de diamètre D forme une Tache d'Airy
 *    dont l'intensité suit I_Airy(r) = [2 * J_1(x) / x]^2 (précalculée en série de Bessel en Rust).
 * 2. Diffusion de Mie (Voile optique interne / Glare) :
 *    Les micro-inhomogénéités du verre optique et des surfaces lenticulaires diffusent les photons
 *    selon une loi de puissance à queue lourde : I_Mie(r) = (1 + (r / r_0)^2)^(-γ/2).
 *    Contrairement à une gaussienne qui s'éteint brutalement, la loi de Mie produit un cœur dense
 *    entouré d'un voile atmosphérique très large et doux.
 * 3. Pyramide HDR 5 Niveaux (rgba16float) Dual-Kawase / Jiménez 13-Taps + Moyenne de Karis :
 *    Échantillonnage pyramidal multi-échelle énergétiquement conservatif sans scintillement.
 * 4. Traitement Anti-Reflet Multicouche (MgF2 / Zeiss T* Coating) & Flare Anamorphique :
 *    Les éléments cylindriques anamorphiques étirent horizontalement le lobe de diffusion avec
 *    une légère irisation spectrale issue de l'interférence en couche mince du traitement optique.
 */

export const bloomPyramidWGSL = /* wgsl */ `
struct MipUniforms {
  texelSize: vec2f,
  threshold: f32,
  softKnee: f32,
  anamorphicStretch: f32,
  mipLevel: u32,
  caEnabled: u32,
  caStrength: f32,
};

@group(0) @binding(0) var<uniform> mipU: MipUniforms;
@group(0) @binding(1) var t_src: texture_2d<f32>;
@group(0) @binding(2) var s_linear: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_mip(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var out: VertexOutput;
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  let p = pos[vertexIndex];
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}

fn luminanceRec709(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn karisWeight(c: vec3f) -> f32 {
  let safeC = select(clamp(c, vec3f(0.0), vec3f(16.0)), vec3f(0.0), c != c);
  return 1.0 / (1.0 + luminanceRec709(safeC));
}

fn decodePremultSrgbToLinear(s: vec4f) -> vec3f {
  let cov = clamp(s.a, 0.0, 1.0);
  if (cov <= 1e-3 || s.r != s.r) {
    return vec3f(0.0);
  }
  let unpremult = clamp(s.rgb / cov, vec3f(0.0), vec3f(1.0));
  return pow(unpremult, vec3f(2.2)) * cov;
}

fn sampleClampedPremultLinear(uv: vec2f) -> vec3f {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec3f(0.0);
  }
  return decodePremultSrgbToLinear(textureSampleLevel(t_src, s_linear, uv, 0.0));
}

fn sampleSourceLinear(uv: vec2f) -> vec3f {
  if (mipU.caEnabled == 0u || mipU.caStrength <= 0.0001) {
    return sampleClampedPremultLinear(uv);
  }
  let centered = uv - vec2f(0.5);
  let r2 = dot(centered, centered);
  let shift = centered * (0.45 + 1.25 * r2) * mipU.caStrength;
  let sR = sampleClampedPremultLinear(uv - shift * 0.45).r;
  let sG = sampleClampedPremultLinear(uv).g;
  let sB = sampleClampedPremultLinear(uv + shift * 1.15).b;
  return vec3f(sR, sG, sB);
}

/**
 * Courbe d'extraction quadratique à genou doux C1/C2 (Soft-Knee Threshold)
 * Préserve la progressivité des demi-teintes lumineuses sans coupure franche.
 */
fn extractHighlightSoftKnee(color: vec3f, threshold: f32, knee: f32) -> vec3f {
  let br = max(color.r, max(color.g, color.b));
  let k = max(1e-4, threshold * knee);
  let soft = clamp(br - threshold + k, 0.0, 2.0 * k);
  let quadratic = (soft * soft) / (4.0 * k);
  let contribution = max(quadratic, br - threshold) / max(br, 1e-4);
  return color * clamp(contribution, 0.0, 1.0);
}

/**
 * Réponse sensibilométrique Hurter-Driffield (Courbe caractéristique Log-Exposition D(log E))
 * Stockée dans le canal Alpha (.a) de la pyramide HDR pour piloter l'Halation photochimique.
 */
fn computeHurterDriffieldExposure(linearRgb: vec3f, threshold: f32) -> f32 {
  // Sensibilité spectrale de la couche profonde de l'émulsion (dominante Rouge-Or)
  let emulsionFlux = dot(linearRgb, vec3f(0.58, 0.34, 0.08));
  let logE = log2(max(1e-4, emulsionFlux * 4.0));
  let logE0 = log2(max(1e-3, threshold * 2.2));
  let gammaHD = 1.75;
  // Sigmoïde log-exposition de Hurter-Driffield
  return 1.0 / (1.0 + exp(-gammaHD * (logE - logE0)));
}

/**
 * Passe 0 : Préfiltrage physique + Downsample 13-Taps de Jiménez avec stabilisation de Karis.
 * Extrait simultanément l'énergie radiométrique linéaire (RGB) et l'exposition Hurter-Driffield (A).
 */
@fragment
fn fs_prefilter_downsample(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  let ts = mipU.texelSize;

  // Grille 13-Taps de Jiménez (Siggraph 2014) : 5 boîtes bilinéaires imbriquées
  let a = sampleSourceLinear(uv + vec2f(-2.0, -2.0) * ts);
  let b = sampleSourceLinear(uv + vec2f( 0.0, -2.0) * ts);
  let c = sampleSourceLinear(uv + vec2f( 2.0, -2.0) * ts);

  let d = sampleSourceLinear(uv + vec2f(-1.0, -1.0) * ts);
  let e = sampleSourceLinear(uv + vec2f( 1.0, -1.0) * ts);

  let f = sampleSourceLinear(uv + vec2f(-2.0,  0.0) * ts);
  let g = sampleSourceLinear(uv);
  let h = sampleSourceLinear(uv + vec2f( 2.0,  0.0) * ts);

  let i = sampleSourceLinear(uv + vec2f(-1.0,  1.0) * ts);
  let j = sampleSourceLinear(uv + vec2f( 1.0,  1.0) * ts);

  let k = sampleSourceLinear(uv + vec2f(-2.0,  2.0) * ts);
  let l = sampleSourceLinear(uv + vec2f( 0.0,  2.0) * ts);
  let m = sampleSourceLinear(uv + vec2f( 2.0,  2.0) * ts);

  // Pondération partielle de Karis sur les 5 sous-groupes pour supprimer tout firefly sous-pixel
  let boxCenter = (d + e + i + j) * 0.25;
  let boxTL     = (a + b + g + f) * 0.25;
  let boxTR     = (b + c + h + g) * 0.25;
  let boxBL     = (f + g + l + k) * 0.25;
  let boxBR     = (g + h + m + l) * 0.25;

  let wC  = karisWeight(boxCenter) * 0.5;
  let wTL = karisWeight(boxTL) * 0.125;
  let wTR = karisWeight(boxTR) * 0.125;
  let wBL = karisWeight(boxBL) * 0.125;
  let wBR = karisWeight(boxBR) * 0.125;

  let wSum = max(1e-5, wC + wTL + wTR + wBL + wBR);
  let filteredLinear = (boxCenter * wC + boxTL * wTL + boxTR * wTR + boxBL * wBL + boxBR * wBR) / wSum;

  // Extraction à genou doux C2 pour le Bloom optique
  let bloomHeader = extractHighlightSoftKnee(filteredLinear, mipU.threshold, mipU.softKnee);

  // Détection de contraste local (gradient de bord franc haute lumière / ombre)
  // L'halation argentique est maximale sur les transitions à haut contraste (ex: lettres blanches sur fond noir)
  let diff1 = boxTL - boxBR;
  let diff2 = boxTR - boxBL;
  let edgeContrast = sqrt(dot(diff1, diff1) + 1e-6) + sqrt(dot(diff2, diff2) + 1e-6);
  let hdExposure = computeHurterDriffieldExposure(filteredLinear, mipU.threshold) * (0.75 + 0.45 * clamp(edgeContrast, 0.0, 1.5));

  let safeBloom = select(clamp(bloomHeader, vec3f(0.0), vec3f(16.0)), vec3f(0.0), bloomHeader != bloomHeader);
  let safeHd = select(clamp(hdExposure, 0.0, 16.0), 0.0, hdExposure != hdExposure);

  return vec4f(safeBloom, safeHd);
}

/**
 * Passes 1..4 : Downsample progressif 13-Taps de Jiménez avec étirement anamorphique horizontal.
 */
@fragment
fn fs_mip_downsample(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  // Étirement horizontal progressif si l'optique comporte un bloc cylindrique anamorphique
  let anamorphicX = 1.0 + max(0.0, mipU.anamorphicStretch - 1.0) * 0.45;
  let ts = vec2f(mipU.texelSize.x * anamorphicX, mipU.texelSize.y);

  let a = textureSampleLevel(t_src, s_linear, uv + vec2f(-2.0, -2.0) * ts, 0.0);
  let b = textureSampleLevel(t_src, s_linear, uv + vec2f( 0.0, -2.0) * ts, 0.0);
  let c = textureSampleLevel(t_src, s_linear, uv + vec2f( 2.0, -2.0) * ts, 0.0);

  let d = textureSampleLevel(t_src, s_linear, uv + vec2f(-1.0, -1.0) * ts, 0.0);
  let e = textureSampleLevel(t_src, s_linear, uv + vec2f( 1.0, -1.0) * ts, 0.0);

  let f = textureSampleLevel(t_src, s_linear, uv + vec2f(-2.0,  0.0) * ts, 0.0);
  let g = textureSampleLevel(t_src, s_linear, uv, 0.0);
  let h = textureSampleLevel(t_src, s_linear, uv + vec2f( 2.0,  0.0) * ts, 0.0);

  let i = textureSampleLevel(t_src, s_linear, uv + vec2f(-1.0,  1.0) * ts, 0.0);
  let j = textureSampleLevel(t_src, s_linear, uv + vec2f( 1.0,  1.0) * ts, 0.0);

  let k = textureSampleLevel(t_src, s_linear, uv + vec2f(-2.0,  2.0) * ts, 0.0);
  let l = textureSampleLevel(t_src, s_linear, uv + vec2f( 0.0,  2.0) * ts, 0.0);
  let m = textureSampleLevel(t_src, s_linear, uv + vec2f( 2.0,  2.0) * ts, 0.0);

  // Poids exacts de Jiménez (somme = 1.000000 : conservation stricte de l'énergie lumineuse)
  var outVal = (d + e + i + j) * (0.5 * 0.25);
  outVal += (a + b + g + f) * (0.125 * 0.25);
  outVal += (b + c + h + g) * (0.125 * 0.25);
  outVal += (f + g + l + k) * (0.125 * 0.25);
  outVal += (g + h + m + l) * (0.125 * 0.25);

  return outVal;
}
`;

export const bloomChunk = /* wgsl */ `
/**
 * Filtre Tent 9-Taps (3x3 pondéré [1, 2, 1; 2, 4, 2; 1, 2, 1] / 16)
 * Utilisé lors de la reconstruction ascendante (Upsample) de chaque octave Mipmap HDR.
 */
fn sampleTent9Tap(
  mipTex: texture_2d<f32>,
  linSampler: sampler,
  uv: vec2f,
  texelStep: vec2f
) -> vec4f {
  let d = texelStep.xyxy * vec4f(1.0, 1.0, -1.0, 0.0);

  var s = textureSampleLevel(mipTex, linSampler, uv - d.xy, 0.0);
  s += textureSampleLevel(mipTex, linSampler, uv - d.wy, 0.0) * 2.0;
  s += textureSampleLevel(mipTex, linSampler, uv - d.zy, 0.0);

  s += textureSampleLevel(mipTex, linSampler, uv + d.zw, 0.0) * 2.0;
  s += textureSampleLevel(mipTex, linSampler, uv,        0.0) * 4.0;
  s += textureSampleLevel(mipTex, linSampler, uv + d.xw, 0.0) * 2.0;

  s += textureSampleLevel(mipTex, linSampler, uv + d.zy, 0.0);
  s += textureSampleLevel(mipTex, linSampler, uv + d.wy, 0.0) * 2.0;
  s += textureSampleLevel(mipTex, linSampler, uv + d.xy, 0.0);

  return s * (1.0 / 16.0);
}

/**
 * Reconstruit la Point Spread Function (PSF) complète du Bloom Optique
 * (Tache de diffraction d'Airy + Diffusion de Mie + Flare Anamorphique traité T*)
 * à partir des 5 niveaux de la pyramide Mipmap HDR et des poids physiques Rust WASM.
 */
fn sampleOpticalBloom(
  uv: vec2f,
  resolution: vec2f,
  bloomRadius: f32,
  bloomIntensity: f32,
  anamorphicFlareTint: f32
) -> vec3f {
  let baseTexel = (1.0 / max(vec2f(1.0), resolution)) * max(0.25, bloomRadius);

  let w0 = optLut.bloomMipWeights[0];
  let w1 = optLut.bloomMipWeights[1];
  let w2 = optLut.bloomMipWeights[2];
  let w3 = optLut.bloomMipWeights[3];
  let w4 = optLut.bloomMipWeights[4];

  let m0 = sampleTent9Tap(t_mip0, s_linear, uv, baseTexel * 2.0  * w0.z).rgb;
  let m1 = sampleTent9Tap(t_mip1, s_linear, uv, baseTexel * 4.0  * w1.z).rgb;
  let m2 = sampleTent9Tap(t_mip2, s_linear, uv, baseTexel * 8.0  * w2.z).rgb;
  let m3 = sampleTent9Tap(t_mip3, s_linear, uv, baseTexel * 16.0 * w3.z).rgb;
  let m4 = sampleTent9Tap(t_mip4, s_linear, uv, baseTexel * 32.0 * w4.z).rgb;

  // 1. Somme pondérée isotrope : Cœur de diffraction d'Airy (m0, m1) + Voile de Mie (m2, m3, m4)
  let isotropicBloom = m0 * w0.x + m1 * w1.x + m2 * w2.x + m3 * w3.x + m4 * w4.x;

  // 2. Lobe d'étirement anamorphique avec irisation du traitement anti-reflet (Coating MgF2 / Zeiss T*)
  // Les couches minces de fluorure de magnésium réfléchissent préférentiellement le bleu-cyan et l'ambre
  let anamorphicEnergy = m1 * w1.y + m2 * w2.y + m3 * w3.y + m4 * w4.y;
  let coatingTint = mix(vec3f(1.0), vec3f(0.62, 0.86, 1.35), clamp(anamorphicFlareTint, 0.0, 1.0));
  let anamorphicBloom = anamorphicEnergy * coatingTint;

  // 3. Légère dispersion Rayleigh/Mie dans les queues lointaines (les courtes longueurs d'onde diffusent plus loin)
  let rayleighTail = (m3 * w3.w + m4 * w4.w) * vec3f(0.85, 0.96, 1.18);

  return (isotropicBloom + anamorphicBloom + rayleighTail) * bloomIntensity;
}
`;
