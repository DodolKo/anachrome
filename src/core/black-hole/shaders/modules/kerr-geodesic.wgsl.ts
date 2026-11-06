/**
 * Module 1 : Intégrateur Géodésique Relativiste dans la Métrique de Kerr-Schild / Boyer-Lindquist
 *
 * Fondements physiques modélisés (unités géométriques G = c = 1) :
 * 1. Équation exacte de Binet pour les géodésiques nulles (photons, ds² = 0) :
 *    d²u / dφ² + u = 3 M u²  (avec u = 1 / r et r_s = 2M)
 *    En coordonnées cartésiennes 3D paramétrées par le paramètre affine λ :
 *    d²x / dλ² = - (3 M |x × v|² / r⁵) x
 * 2. Métrique de Kerr en rotation (spin sans dimension a* = Jc / GM² ∈ [-0.998, 0.998]) :
 *    - Couplage spin-orbite de Carter / Boyer-Lindquist : brise la symétrie entre les rayons
 *      progrades (L_z · a > 0, qui plongent jusqu'à r_ph^+) et rétrogrades (L_z · a < 0, repoussés à r_ph^-),
 *      produisant la célèbre ombre asymétrique en forme de "D" (Gargantua / M87*).
 *    - Effet Lense-Thirring (Frame-Dragging gravitomagnétique) : l'espace-temps lui-même est entraîné
 *      autour de l'axe de spin avec la vitesse angulaire ω_FD(r) = 2Ma / (r³ + a²r + 2Ma²).
 * 3. Anneaux Photoniques Relativistes d'ordre n=1 et n=2 (Exposant de Lyapunov γ ≈ π) :
 *    Les rayons frôlant la sphère de photons effectuent 1/2 tour (n=1) ou 1 tour complet (n=2)
 *    autour de l'horizon avant d'atteindre l'observateur.
 */
export const kerrGeodesicChunk = /* wgsl */ `
const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;

struct CameraBasis {
  pos: vec3f,
  forward: vec3f,
  right: vec3f,
  up: vec3f,
};

/**
 * Construit le repère orthonormé 3D de la caméra orbitale autour de la singularité.
 */
fn buildCameraBasis(
  thetaDeg: f32,
  phiDeg: f32,
  rollDeg: f32,
  distanceM: f32,
  mass: f32,
  cursorOffset: vec2f,
  parallaxStrength: f32
) -> CameraBasis {
  let effTheta = clamp(thetaDeg + cursorOffset.y * 18.0 * parallaxStrength, -84.0, 84.0) * (PI / 180.0);
  let effPhi   = (phiDeg - cursorOffset.x * 28.0 * parallaxStrength) * (PI / 180.0);
  let effRoll  = rollDeg * (PI / 180.0);

  let rCam = max(5.5, distanceM) * max(0.25, mass);
  let cosT = cos(effTheta);
  let sinT = sin(effTheta);
  let cosP = cos(effPhi);
  let sinP = sin(effPhi);

  let camPos = vec3f(
    rCam * cosT * sinP,
    rCam * sinT,
    rCam * cosT * cosP
  );

  let forward = normalize(-camPos);
  let worldUp = vec3f(0.0, 1.0, 0.0);
  let baseRight = normalize(cross(forward, worldUp));
  let baseUp = cross(baseRight, forward);

  let cosR = cos(effRoll);
  let sinR = sin(effRoll);
  let right = baseRight * cosR - baseUp * sinR;
  let up    = baseRight * sinR + baseUp * cosR;

  var basis: CameraBasis;
  basis.pos = camPos;
  basis.forward = forward;
  basis.right = right;
  basis.up = up;
  return basis;
}

/**
 * Calcule l'accélération géodésique relativiste d²x/dλ² d'un photon dans la métrique de Kerr.
 * Combine le terme exact de Binet (-3 M h² / r⁵), l'asymétrie spin-orbite de Carter/Kerr
 * et la force gravitomagnétique d'entraînement de Lense-Thirring (Frame-Dragging).
 */
fn computeKerrGeodesicAcceleration(
  pos: vec3f,
  vel: vec3f,
  mass: f32,
  spinA: f32,
  lensingStrength: f32
) -> vec3f {
  let r2 = max(1e-4, dot(pos, pos));
  let r = sqrt(r2);
  let r3 = r2 * r;
  let r5 = r3 * r2;

  // Moment cinétique spécifique du photon : h = x × v (paramètre d'impact vectoriel)
  let hVec = cross(pos, vel);
  let h2 = dot(hVec, hVec);

  // Couplage spin-orbite de Kerr le long de l'axe polaire Y (s = [0, 1, 0]) :
  // L_z = hVec.y > 0 (prograde) réduit la barrière potentielle et rapproche l'ombre (forme en "D")
  // L_z = hVec.y < 0 (rétrograde) augmente la déflexion et élargit l'ombre du côté opposé
  let a = spinA * mass;
  let a2 = a * a;
  let hNorm = sqrt(max(1e-5, h2));
  let spinAlign = clamp(hVec.y / hNorm, -1.0, 1.0);
  let kerrPotentialMod = clamp(1.0 - 0.36 * spinA * spinAlign * (mass / max(mass * 0.8, r)), 0.55, 1.55);

  // Terme principal exact de Binet / Schwarzschild modulé par le potentiel de Kerr
  let radialAccel = -3.0 * mass * h2 * kerrPotentialMod * lensingStrength / r5 * pos;

  // Effet Lense-Thirring (Frame-Dragging gravitomagnétique de l'ergosphère) :
  // L'espace-temps en rotation entraîne la direction du photon autour de l'axe Y
  let omegaFd = (2.0 * mass * a) / max(1e-3, r3 + a2 * r + 2.0 * mass * a2);
  let spinAxis = vec3f(0.0, 1.0, 0.0);
  let frameDragAccel = 1.85 * omegaFd * cross(spinAxis, vel) * lensingStrength;

  return radialAccel + frameDragAccel;
}
`;
