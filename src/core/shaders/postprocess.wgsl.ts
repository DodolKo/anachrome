import {
    bloomChunk,
    chromaticAberrationChunk,
    crtChunk,
    filmGrainChunk,
    halationChunk,
} from "./modules";

/**
 * Pipeline de Post-Processing Optique, Photochimique & Cathodique Rétro WebGPU
 *
 * Architecture modulaire à 5 étages indépendants (chacun débranchable à chaud) :
 * 0. Bombage d'Écran Cathodique (Courbure Anisotrope X / Y indépendante + Vignette Tube + Scanlines Beam-Aware)
 * 1. Aberration Chromatique Spectrale (Sellmeier 12 bandes + Seidel r^3/r^5 + Sphérochromatisme LCA + CIE 1931)
 * 2. Halation Photochimique Tricouche (Kodak Vision3 / CineStill 800T : Beer-Lambert + Réflexion Totale de Fresnel)
 * 3. Bloom Optique Pyramidal HDR (Diffraction de Fraunhofer / Tache d'Airy J_1 + Diffusion de Mie + Flare Anamorphique)
 * 4. Sensor Noise Fujifilm X-Trans (Matrice CFA 6x6 + PCG3D + Box-Muller + Granulation ISO C2 + Persistance Temporelle)
 */
export const postprocessWGSL = /* wgsl */ `
struct Uniforms {
  // Bloc 0 (16 octets) : Géométrie & Temps
  resolution: vec2f,
  time: f32,
  frameIndex: u32,

  // Bloc 1 (16 octets) : Sensor Grain Fujifilm X-Trans
  grainScale: f32,
  fps: f32,
  intensity: f32,
  microRatio: f32,

  // Bloc 2 (16 octets) : Sensor Grain suite
  mesoRatio: f32,
  mesoScale: f32,
  iso: f32,
  chromaAmount: f32,

  // Bloc 3 (16 octets) : Flags d'activation modulaires indépendants
  temporalBlend: f32,
  grainEnabled: u32,
  bloomEnabled: u32,
  halationEnabled: u32,

  // Bloc 4 (16 octets) : Aberration Chromatique & Bloom
  caEnabled: u32,
  caStrength: f32,
  caAxialStrength: f32,
  bloomIntensity: f32,

  // Bloc 5 (16 octets) : Bloom & Halation
  bloomRadius: f32,
  bloomAnamorphicTint: f32,
  halationIntensity: f32,
  halationRadius: f32,

  // Bloc 6 (16 octets) : Couleur de fond de scène (pour reconstruction optique CA/CRT sans couture)
  bgLinearR: f32,
  bgLinearG: f32,
  bgLinearB: f32,
  caDomMaskStrength: f32,

  // Bloc 7 (16 octets) : Bombage d'Écran / Tube Cathodique (CRT Anisotrope X / Y)
  crtEnabled: u32,
  crtCurvatureX: f32,
  crtCurvatureY: f32,
  crtScale: f32,

  // Bloc 8 (16 octets) : Vignette de Tube & Scanlines Physiques (Beam-Width Blooming)
  crtVignette: f32,
  scanlinesEnabled: u32,
  scanlineIntensity: f32,
  scanlineDensity: f32,
};

struct OpticalPhysicsLut {
  spectralDispersion: array<vec4f, 12>,
  spectralWeightsRgb: array<vec4f, 12>,
  bloomMipWeights: array<vec4f, 5>,
  halationMipWeights: array<vec4f, 5>,
  seidelAndFresnel: array<vec4f, 2>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<uniform> optLut: OpticalPhysicsLut;
@group(0) @binding(2) var s_linear: sampler;
@group(0) @binding(3) var t_scene: texture_2d<f32>;
@group(0) @binding(4) var t_mip0: texture_2d<f32>;
@group(0) @binding(5) var t_mip1: texture_2d<f32>;
@group(0) @binding(6) var t_mip2: texture_2d<f32>;
@group(0) @binding(7) var t_mip3: texture_2d<f32>;
@group(0) @binding(8) var t_mip4: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
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

// ============================================================================
// INGESTION DES 5 MODULES PHYSIQUES INDÉPENDANTS
// ============================================================================
${crtChunk}
${filmGrainChunk}
${chromaticAberrationChunk}
${bloomChunk}
${halationChunk}

fn linearToSrgbSafe(c: vec3f) -> vec3f {
  return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

/**
 * Courbe de compression d'épaule photochimique (Soft Filmic Shoulder)
 * Évite tout écrêtage brutal des hautes lumières lorsque Bloom + Halation + CA se superposent.
 */
fn filmicHighlightRollOff(linearLight: vec3f) -> vec3f {
  return vec3f(1.0) - exp(-max(vec3f(0.0), linearLight));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let maxCoord = max(vec2f(0.0), u.resolution - vec2f(1.0));
  let pixelCoord = clamp(in.position.xy, vec2f(0.0), maxCoord);
  let uv = in.uv;

  // --------------------------------------------------------------------------
  // 0. MODULE BOMBAGE D'ÉCRAN CATHODIQUE (Courbure X / Y indépendante + Vignette)
  // --------------------------------------------------------------------------
  var opticalUv = uv;
  var crtInBounds = 1.0;
  var crtBezelMask = 1.0;
  var crtVignetteFactor = 1.0;
  let crtActive = (u.crtEnabled & 1u) != 0u;
  let sceneLayerActive = (u.crtEnabled & 2u) != 0u;
  let hasCrtWarp = crtActive && (
    abs(u.crtCurvatureX) > 0.0001 ||
    abs(u.crtCurvatureY) > 0.0001 ||
    abs(u.crtScale - 1.0) > 0.0001
  );

  if (crtActive) {
    let crtRes = warpCrtScreen(
      uv,
      u.crtCurvatureX,
      u.crtCurvatureY,
      u.crtScale,
      u.crtVignette
    );
    opticalUv = clamp(crtRes.uv, vec2f(0.002), vec2f(0.998));
    crtInBounds = crtRes.inBounds;
    crtBezelMask = crtRes.bezelMask;
    crtVignetteFactor = crtRes.vignetteFactor;
  }

  // --------------------------------------------------------------------------
  // 1. MODULE SENSOR NOISE FUJIFILM X-TRANS (Indépendant)
  // --------------------------------------------------------------------------
  var chromaTint = vec3f(1.0);
  var grainLum = 0.0;
  var rawGrainSignal = 0.0;

  if (u.grainEnabled != 0u && u.intensity > 0.0001) {
    let sensor = computeFujiXTransGrain(
      pixelCoord,
      u.frameIndex,
      u.temporalBlend,
      u.iso,
      u.chromaAmount,
      u.microRatio,
      u.mesoRatio,
      u.mesoScale,
      u.grainScale
    );
    chromaTint = sensor.xyz;
    rawGrainSignal = sensor.w;
    grainLum = sensor.w * u.intensity;
  }

  // --------------------------------------------------------------------------
  // 2. MODULE ABERRATION CHROMATIQUE SPECTRALE SELLMEIER + CIE 1931 & WARP CRT
  // --------------------------------------------------------------------------
  let isCaActive = u.caEnabled != 0u && (u.caStrength > 0.0001 || u.caAxialStrength > 0.001);
  let replacesDomSurface = isCaActive || hasCrtWarp || sceneLayerActive;

  var refractedCov = 0.0;
  var refractedLinear = vec3f(0.0);

  if (isCaActive) {
    let refracted = sampleSpectralChromaticAberration(
      t_scene,
      s_linear,
      opticalUv,
      pixelCoord,
      u.resolution,
      u.caStrength,
      u.caAxialStrength
    );
    refractedLinear = refracted.rgb * crtInBounds;
    refractedCov = clamp(refracted.a * crtInBounds, 0.0, 1.0);
  } else if (hasCrtWarp || sceneLayerActive) {
    let warpedSample = textureSampleLevel(t_scene, s_linear, opticalUv, 0.0);
    refractedCov = clamp(warpedSample.a * crtInBounds, 0.0, 1.0);
    let unpremult = select(
      vec3f(0.0),
      clamp(warpedSample.rgb / max(1e-4, warpedSample.a), vec3f(0.0), vec3f(1.0)),
      warpedSample.a > 1e-4
    );
    refractedLinear = pow(unpremult, vec3f(2.2)) * refractedCov;
  }

  // --------------------------------------------------------------------------
  // 3. MODULE HALATION PHOTOCHIMIQUE TRICOUCHE KODAK / CINESTILL (Indépendant)
  // --------------------------------------------------------------------------
  var halationLinear = vec3f(0.0);
  if (u.halationEnabled != 0u && u.halationIntensity > 0.0001) {
    halationLinear = computeFilmHalation(
      opticalUv,
      u.resolution,
      u.halationRadius,
      u.halationIntensity,
      rawGrainSignal
    ) * crtInBounds;
  }

  // --------------------------------------------------------------------------
  // 4. MODULE BLOOM OPTIQUE AIRY + MIE + ANAMORPHIC FLARE (Indépendant)
  // --------------------------------------------------------------------------
  var bloomLinear = vec3f(0.0);
  if (u.bloomEnabled != 0u && u.bloomIntensity > 0.0001) {
    bloomLinear = sampleOpticalBloom(
      opticalUv,
      u.resolution,
      u.bloomRadius,
      u.bloomIntensity,
      u.bloomAnamorphicTint
    ) * crtInBounds;
  }

  // --------------------------------------------------------------------------
  // 5. COMPOSITION OPTIQUE SANS FANTÔME DOM, SCANLINES & SÉCURITÉ DSC
  // --------------------------------------------------------------------------
  // Sanitisation stricte anti-NaN / anti-Inf (évite tout dépassement IEEE-754 sur les bords d'écran)
  let rawGlowSum = bloomLinear + halationLinear;
  let safeGlowSum = select(
    clamp(rawGlowSum, vec3f(0.0), vec3f(16.0)),
    vec3f(0.0),
    rawGlowSum != rawGlowSum
  );
  let totalOpticalGlowLinear = filmicHighlightRollOff(safeGlowSum);
  let glowSrgb = linearToSrgbSafe(totalOpticalGlowLinear);
  let glowPeak = clamp(max(glowSrgb.r, max(glowSrgb.g, glowSrgb.b)), 0.0, 1.0);

  // Décomposition physique du grain en émission (light) et absorption (dark) avec sécurité DSC (0.22)
  let lightScalar = clamp(max(0.0, grainLum), 0.0, 0.22);
  let darkScalar  = clamp(max(0.0, -grainLum), 0.0, 0.22);
  let grainLightRgb = clamp(lightScalar * chromaTint, vec3f(0.0), vec3f(0.22));
  let grainPeakLight = max(grainLightRgb.r, max(grainLightRgb.g, grainLightRgb.b));
  let grainAlpha = clamp(max(grainPeakLight, darkScalar), 0.0, 0.22);
  let safeGrainRgb = min(grainLightRgb, vec3f(grainAlpha));

  // Lorsque la géométrie de l'image est déformée (CRT ou Aberration Chromatique),
  // le shader reconstruit la scène complète sur la couleur de fond de la page (bgLinear)
  // avec surfaceFootprint = maskStrength (1.0 par défaut), ce qui occulte à 100 %
  // les éléments HTML non-courbés situés en dessous et garantit que tout passe dans le post-process !
  var surfaceFootprint = 0.0;
  var surfacePremultRgb = vec3f(0.0);

  if (replacesDomSurface) {
    let maskStrength = select(1.0, clamp(u.caDomMaskStrength, 0.0, 1.0), isCaActive);
    surfaceFootprint = maskStrength;

    let bgSrgb = vec3f(u.bgLinearR, u.bgLinearG, u.bgLinearB);
    let bgLinear = pow(bgSrgb, vec3f(2.2));
    let safeRefracted = select(
      clamp(refractedLinear, vec3f(0.0), vec3f(4.0)),
      vec3f(0.0),
      refractedLinear != refractedLinear
    );
    let compLinear = bgLinear * (1.0 - refractedCov) + safeRefracted;
    let glyphSrgb = linearToSrgbSafe(compLinear);
    // Applique l'absorption du grain sombre sur le fond de scène de manière 100 % homogène
    let darkGrainFactor = 1.0 - darkScalar * (1.0 - refractedCov);
    surfacePremultRgb = glyphSrgb * darkGrainFactor * surfaceFootprint;
  }

  // haloWeight ne dépend QUE de refractedCov (la lettre courbée réelle) :
  // le halo de Bloom et d'Halation n'est plus jamais assombri à l'ancien emplacement du DOM !
  let haloWeight = 1.0 - refractedCov * 0.55;
  var opticalRgb = clamp(surfacePremultRgb + glowSrgb * haloWeight, vec3f(0.0), vec3f(1.0));
  let opticalPeak = max(opticalRgb.r, max(opticalRgb.g, opticalRgb.b));
  var opticalAlpha = clamp(max(surfaceFootprint, max(glowPeak, opticalPeak)), 0.0, 1.0);

  // Scanlines Cathodiques Beam-Aware (activables à la volée sans détruire l'effet "Whoa" optique)
  var scanlineDarkAlpha = 0.0;
  if (u.scanlinesEnabled != 0u && u.scanlineIntensity > 0.0001) {
    let scanMod = computeCrtScanlineModulation(
      opticalUv,
      u.resolution,
      u.scanlineIntensity,
      u.scanlineDensity,
      max(refractedCov, glowPeak)
    );
    opticalRgb = opticalRgb * scanMod;
    scanlineDarkAlpha = clamp((1.0 - scanMod) * 0.42, 0.0, 0.18) * crtBezelMask;
  }

  // Vignette de tube cathodique & Masque de cadre courbé (Bezel)
  var crtDarkAlpha = 0.0;
  if (crtActive) {
    let tubeTransmission = crtBezelMask * crtVignetteFactor;
    opticalRgb = opticalRgb * tubeTransmission;
    crtDarkAlpha = clamp(1.0 - tubeTransmission, 0.0, 1.0);
  }

  let grainAttenuation = 1.0 - max(refractedCov, glowPeak) * 0.65;
  let rawFinalRgb = opticalRgb + safeGrainRgb * grainAttenuation * crtBezelMask;
  let rawPeak = max(rawFinalRgb.r, max(rawFinalRgb.g, rawFinalRgb.b));
  let combinedAlpha = max(max(opticalAlpha, grainAlpha), max(scanlineDarkAlpha, crtDarkAlpha));
  let finalAlpha = clamp(max(rawPeak, combinedAlpha), 0.0, 1.0);
  let finalRgb = min(rawFinalRgb, vec3f(finalAlpha));

  return vec4f(finalRgb, finalAlpha);
}
`;
