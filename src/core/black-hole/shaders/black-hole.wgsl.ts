import {
  accretionDiskChunk,
  kerrGeodesicChunk,
  spacetimeGridChunk,
} from "./modules";

/**
 * Shader Principal de Simulation Relativiste du Trou Noir de Kerr (WebGPU WGSL)
 *
 * Exécuté en amont de la pyramide HDR et du pipeline optique `RetroRenderer` :
 * - Intègre les géodésiques nulles (photons) dans la métrique de Kerr-Schild / Boyer-Lindquist (RK2-Verlet adaptatif)
 * - Calcule les traversées multiples (n=0 direct, n=1 arche relativiste secondaire, n=2 anneau photonique de Lyapunov)
 *   du disque d'accrétion de Novikov-Thorne avec Beaming Doppler relativiste (I_obs = g⁴ I_emit)
 * - Intègre les jets polaires magnétohydrodynamiques de Blandford-Znajek
 * - Trace le Paraboloïde de Flamm 3D z(r) = -2√(r_s(r - r_s)) et la Grille Tensorielle 3D déformée
 * - Applique la lentille gravitationnelle d'Einstein directement sur la texture DOM (`t_dom`, textes "DOKO")
 */
export const blackHoleWGSL = /* wgsl */ `
struct BlackHoleUniforms {
  // Bloc 0 (16 octets)
  resolution: vec2f,
  time: f32,
  mass: f32,

  // Bloc 1 (16 octets)
  spin: f32,
  cameraTheta: f32,
  cameraPhi: f32,
  cameraRoll: f32,

  // Bloc 2 (16 octets)
  cameraDistance: f32,
  cursorX: f32,
  cursorY: f32,
  cursorParallax: f32,

  // Bloc 3 (16 octets)
  lensingStrength: f32,
  domLensingStrength: f32,
  photonRingIntensity: f32,
  diskEnabled: u32,

  // Bloc 4 (16 octets)
  diskIntensity: f32,
  diskOuterRadius: f32,
  dopplerStrength: f32,
  turbulenceScale: f32,

  // Bloc 5 (16 octets)
  jetsEnabled: u32,
  jetsIntensity: f32,
  flammGridEnabled: u32,
  flammGridIntensity: f32,

  // Bloc 6 (16 octets)
  tensorGridEnabled: u32,
  tensorGridIntensity: f32,
  gridDensity: f32,
  starfieldIntensity: f32,

  // Bloc 7 (16 octets) : Budget de pas RK2-Verlet & Qualité
  maxSteps: u32,
  renderScale: f32,
  pad0: f32,
  pad1: f32,
};

struct RelativityPhysicsLut {
  kerrHorizonsAndIsco: vec4f,
  photonSphereAndShadow: vec4f,
  diskRadialLut: array<vec4f, 16>,
  planckBlackbodyLut: array<vec4f, 16>,
};

@group(0) @binding(0) var<uniform> bh: BlackHoleUniforms;
@group(0) @binding(1) var<uniform> relLut: RelativityPhysicsLut;
@group(0) @binding(2) var s_linear: sampler;
@group(0) @binding(3) var t_dom: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_black_hole(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
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

${kerrGeodesicChunk}
${accretionDiskChunk}
${spacetimeGridChunk}

fn linearToSrgbSafeBH(c: vec3f) -> vec3f {
  return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

fn srgbPremultToLinearBH(s: vec4f) -> vec4f {
  let cov = clamp(s.a, 0.0, 1.0);
  if (cov <= 1e-4) {
    return vec4f(0.0);
  }
  let unpremult = clamp(s.rgb / cov, vec3f(0.0), vec3f(1.0));
  return vec4f(pow(unpremult, vec3f(2.2)) * cov, cov);
}

/**
 * Courbe de compression d'épaule cinématographique HDR -> sRGB [0, 1]
 * Préserve la saturation des hautes lumières pour exciter proprement la pyramide de Bloom Airy/Mie.
 */
fn toneMapRelativisticHdr(hdrLinear: vec3f) -> vec3f {
  let mapped = vec3f(1.0) - exp(-max(vec3f(0.0), hdrLinear) * 1.15);
  return linearToSrgbSafeBH(mapped);
}

@fragment
fn fs_black_hole(in: VertexOutput) -> @location(0) vec4f {
  let uv = in.uv;
  let aspect = bh.resolution.x / max(1.0, bh.resolution.y);

  // Coordonnées écran normalisées [-aspect..+aspect, -1..+1] (Y vers le haut)
  let ndc = vec2f((uv.x - 0.5) * 2.0 * aspect, (0.5 - uv.y) * 2.0);

  let mass = max(0.25, bh.mass);
  let spinA = clamp(bh.spin, -0.998, 0.998);
  let rPlusM = relLut.kerrHorizonsAndIsco.x;
  let rIscoM = relLut.kerrHorizonsAndIsco.z;
  let omegaH = relLut.kerrHorizonsAndIsco.w;
  let rPhProM = relLut.photonSphereAndShadow.x;
  let rPhRetM = relLut.photonSphereAndShadow.y;

  let horizonRadius = rPlusM * mass;
  let escapeRadius  = max(32.0, bh.cameraDistance * 1.65) * mass;

  // Construction du repère caméra 3D avec parallaxe gravitationnelle fluide
  let cam = buildCameraBasis(
    bh.cameraTheta,
    bh.cameraPhi,
    bh.cameraRoll,
    bh.cameraDistance,
    mass,
    vec2f(bh.cursorX, bh.cursorY),
    bh.cursorParallax
  );

  // Focale optique (champ de vision vertical ~ 42°)
  let focalLength = 2.15;
  let rayDir0 = normalize(cam.forward * focalLength + cam.right * ndc.x + cam.up * ndc.y);

  var pos = cam.pos;
  var vel = rayDir0;

  var accumLinearRgb = vec3f(0.0);
  var transmittance = 1.0;
  var isCaptured = false;

  // Suivi de l'approche minimale à la sphère de photons et de l'angle d'enroulement total (Lyapunov n=1, n=2)
  var minRadiusM = 1e5;
  var totalDeflectionRad = 0.0;
  var equatorialCrossings: u32 = 0u;

  let maxSteps: u32 = clamp(bh.maxSteps, 20u, 128u);
  let stepScale: f32 = 88.0 / f32(maxSteps);
  for (var step: u32 = 0u; step < maxSteps; step = step + 1u) {
    let r = length(pos);
    let rInM = r / mass;
    minRadiusM = min(minRadiusM, rInM);

    // 1. Capture par l'Horizon des Événements externe de Kerr (r <= r_+)
    if (r <= horizonRadius * 1.015) {
      isCaptured = true;
      break;
    }

    // 2. Sortie asymptotique vers l'infini de Minkowski
    if (r > escapeRadius && dot(pos, vel) > 0.0) {
      break;
    }

    // Pas adaptatif : très fin au voisinage de l'horizon et de la sphère de photons, grand au loin.
    // Compensé par stepScale (88 / maxSteps) pour conserver exactement la même portée physique quel que soit le preset FPS !
    let distFromHorizonM = max(0.05, rInM - rPlusM * 0.92);
    let dt = clamp(distFromHorizonM * 0.088 * stepScale, 0.055, 1.35) * mass;

    // Intégration symplectique Velocity-Verlet / RK2 de la géodésique nulle dans la métrique de Kerr
    let accel0 = computeKerrGeodesicAcceleration(pos, vel, mass, spinA, bh.lensingStrength);
    let midVel = normalize(vel + accel0 * (0.5 * dt));
    let nextPos = pos + midVel * dt;
    let accel1 = computeKerrGeodesicAcceleration(nextPos, midVel, mass, spinA, bh.lensingStrength);
    let nextVel = normalize(midVel + accel1 * (0.5 * dt));

    let stepDeflection = acos(clamp(dot(vel, nextVel), -1.0, 1.0));
    totalDeflectionRad += stepDeflection;

    // 3. Intersection avec le Disque d'Accrétion Relativiste de Novikov-Thorne (plan équatorial Y = 0)
    // Un même rayon peut traverser le plan équatorial plusieurs fois (n=0 direct, n=1 arche supérieure/inférieure, n=2 sous-anneau)
    if (bh.diskEnabled != 0u && bh.diskIntensity > 0.001 && (pos.y * nextPos.y <= 0.0)) {
      let fracY = clamp(abs(pos.y) / max(1e-6, abs(pos.y - nextPos.y)), 0.0, 1.0);
      let hitPos = mix(pos, nextPos, fracY);

      let diskSample = evaluateRelativisticAccretionDisk(
        hitPos,
        midVel,
        mass,
        spinA,
        rPlusM,
        rIscoM,
        bh.diskOuterRadius,
        bh.dopplerStrength,
        bh.diskIntensity,
        bh.turbulenceScale,
        bh.time
      );

      if (diskSample.a > 0.001) {
        // Les images relativistes d'ordre supérieur (n >= 1) sont comprimées et exaltées par la focalisation géodésique
        let orderBoost = select(1.0, 1.32, equatorialCrossings >= 1u);
        accumLinearRgb += transmittance * diskSample.rgb * orderBoost;
        transmittance *= (1.0 - diskSample.a * 0.88);
        equatorialCrossings += 1u;
      }
    }

    // 4. Intersection avec le Paraboloïde de Flamm 3D z(r) = -2√(r_s(r - r_s))
    if (bh.flammGridEnabled != 0u && bh.flammGridIntensity > 0.001 && transmittance > 0.02) {
      let flammRgb = evaluateFlammParaboloidCrossing(
        pos,
        nextPos,
        mass,
        spinA,
        rPlusM,
        bh.gridDensity,
        bh.flammGridIntensity,
        bh.time
      );
      accumLinearRgb += transmittance * flammRgb;
    }

    // 5. Intersection analytique avec la Grille Tensorielle 3D déformée par la métrique (lignes continues 100%)
    if (bh.tensorGridEnabled != 0u && bh.tensorGridIntensity > 0.001 && transmittance > 0.02) {
      let cageRgb = evaluateMetricTensorCageCrossing(
        pos,
        nextPos,
        mass,
        spinA,
        rPlusM,
        bh.gridDensity,
        bh.tensorGridIntensity
      );
      accumLinearRgb += transmittance * cageRgb;
    }

    // 6. Jets Relativistes Polaires de Blandford-Znajek (axe ±Y)
    if (bh.jetsEnabled != 0u && bh.jetsIntensity > 0.001 && transmittance > 0.02) {
      let jetRgb = evaluateBlandfordZnajekJetStep(
         pos + midVel * (0.5 * dt),
        midVel,
        dt,
        mass,
        spinA,
        rPlusM,
        omegaH,
        bh.jetsIntensity,
        bh.time
      );
      accumLinearRgb += transmittance * jetRgb;
    }

    if (transmittance < 0.015) {
      break;
    }

    pos = nextPos;
    vel = nextVel;
  }

  // --------------------------------------------------------------------------
  // 7. ANNEAUX PHOTONIQUES RELATIVISTES CRITIQUES (n=1, n=2 - Exposant de Lyapunov γ = π)
  // --------------------------------------------------------------------------
  // Les rayons qui ont frôlé la sphère de photons (r_min ≈ r_ph) SANS être capturés
  // forment l'anneau d'Einstein rasoir caractéristique au bord exact de l'ombre noire en "D".
  if (!isCaptured && bh.photonRingIntensity > 0.001) {
    let hVec0 = cross(cam.pos, rayDir0);
    let spinAlign0 = clamp(hVec0.y / max(1e-4, length(hVec0)), -1.0, 1.0);
    let effRphM = mix(rPhRetM, rPhProM, spinAlign0 * 0.5 + 0.5);

    let distToPhotonSphere = abs(minRadiusM - effRphM);
    // Anneau primaire n=1 et sous-anneau ultra-fin n=2 (décroissance exponentielle de Lyapunov e^(-π))
    let ringN1 = exp(-distToPhotonSphere * 14.5) * smoothstep(1.35, 2.75, totalDeflectionRad);
    let ringN2 = exp(-distToPhotonSphere * 42.0) * smoothstep(2.6, 4.9, totalDeflectionRad) * 1.45;

    // Asymétrie Doppler sur l'anneau photonique (plus brillant et plus chaud du côté prograde)
    let ringDoppler = 1.0 + 0.42 * spinAlign0 * sign(spinA + 1e-4) * clamp(bh.dopplerStrength, 0.0, 1.5);
    let ringTemp = clamp(0.45 + 0.22 * ringDoppler, 0.15, 0.92);
    let ringColor = samplePlanckBlackbodyLut(ringTemp);

    let photonRingGlow = ringColor * (ringN1 * 0.38 + ringN2 * 0.85) * ringDoppler * bh.photonRingIntensity;
    accumLinearRgb += photonRingGlow * transmittance;
  }

  // --------------------------------------------------------------------------
  // 8. CHAMP D'ÉTOILES PROFOND & LENTILLE GRAVITATIONNELLE SUR LE DOM ("DOKO")
  // --------------------------------------------------------------------------
  var domCov = 0.0;
  var domLinearRgb = vec3f(0.0);

  if (!isCaptured) {
    // Étoiles lointaines déformées en anneaux d'Einstein
    let starsRgb = evaluateLensedCelestialStarfield(vel, totalDeflectionRad, bh.starfieldIntensity);
    accumLinearRgb += transmittance * starsRgb;

    // Déflexion gravitationnelle d'Einstein projetée sur le plan image du DOM ("DOKO")
    let rayDelta = vel - rayDir0;
    let deltaScreen = vec2f(
      dot(rayDelta, cam.right) / max(0.5, aspect),
      -dot(rayDelta, cam.up)
    );

    // Masque d'apodisation près de la courbe critique d'Einstein pour éviter que le titre central "DOKO"
    // ne s'enroule en un gros cercle blanc opaque par-dessus le disque d'accrétion sculptural.
    let criticalCurveFade = smoothstep(1.35, 0.32, totalDeflectionRad);

    let lensedDomUv = uv + deltaScreen * (0.28 * bh.domLensingStrength);
    if (
      criticalCurveFade > 0.001 &&
      lensedDomUv.x >= 0.0 &&
      lensedDomUv.x <= 1.0 &&
      lensedDomUv.y >= 0.0 &&
      lensedDomUv.y <= 1.0
    ) {
      let rawDom = textureSampleLevel(t_dom, s_linear, lensedDomUv, 0.0);
      let decodedDom = srgbPremultToLinearBH(rawDom);
      let domLensBoost = 1.0 + clamp(totalDeflectionRad * 0.22 * bh.domLensingStrength, 0.0, 0.45);
      domLinearRgb = decodedDom.rgb * domLensBoost * transmittance * criticalCurveFade;
      domCov = decodedDom.a * transmittance * criticalCurveFade;
    }
  }

  // --------------------------------------------------------------------------
  // 9. ENCODAGE PRÉMULTIPLIÉ COMPATIBLE AVEC LA PYRAMIDE HDR & RETRO-POSTPROCESS
  // --------------------------------------------------------------------------
  let totalSceneLinear = domLinearRgb + accumLinearRgb;
  let totalSrgb = toneMapRelativisticHdr(totalSceneLinear);
  let emissivePeak = max(totalSrgb.r, max(totalSrgb.g, totalSrgb.b));

  // Dans l'ombre de l'horizon des événements (isCaptured == true),
  // on impose une empreinte d'absorption noire (0.42) qui occulte à 100% le DOM arrière
  // tout en laissant le Bloom d'Airy et l'Halation CineStill baver physiquement sur le bord de l'ombre !
  let shadowFootprint = select(0.0, 0.42, isCaptured);
  let finalAlpha = clamp(max(domCov, max(emissivePeak, shadowFootprint)), 0.0, 1.0);
  let premultRgb = min(totalSrgb, vec3f(finalAlpha));

  return vec4f(premultRgb, finalAlpha);
}
`;
