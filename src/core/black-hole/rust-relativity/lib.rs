//! Noyau de Relativité Générale (Métrique de Kerr) & Thermodynamique du Corps Noir en Rust Vanilla (`#![no_std]`)
//! Compilé directement vers `wasm32-unknown-unknown` sans aucune dépendance externe.
//!
//! Calcule avec une rigueur mathématique exacte :
//! 1. Les racines exactes de Bardeen, Press & Teukolsky (1972) pour un Trou Noir de Kerr en rotation :
//!    - Horizon des événements externe r_+ = M * (1 + sqrt(1 - a*^2)) et interne de Cauchy r_-
//!    - Rayons des orbites photoniques circulaires prograde r_ph^+ et rétrograde r_ph^-
//!    - Paramètres d'impact critiques b_crit^+ et b_crit^- (responsables de l'ombre en "D" de Gargantua / M87*)
//!    - Rayon exact de la Dernière Orbite Circulaire Stable (ISCO - Innermost Stable Circular Orbit) r_ISCO(a*)
//! 2. Le profil radial relativiste de température et de vitesse képlérienne de Novikov-Thorne / Page-Thorne (1974)
//!    avec condition de couple nul sur l'ISCO : T(r) ∝ [ (r_ISCO / r)^3 * (1 - sqrt(r_ISCO / r)) ]^(1/4).
//! 3. Le spectre de rayonnement thermique de Planck B_λ(λ, T) intégré sur les fonctions colorimétriques
//!    CIE 1931 2° Standard Observer (x̄(λ), ȳ(λ), z̄(λ)) vers l'espace Rec.709 linéaire pour 16 paliers
//!    de température (de 1 200 K à 48 000 K), permettant d'appliquer le théorème de Liouville relativiste
//!    T_obs = g * T_emit et I_obs = g^4 * I_emit directement dans le shader WebGPU.

#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

pub const RADIAL_LUT_SAMPLES: usize = 16;
pub const PLANCK_LUT_SAMPLES: usize = 16;

/// Structure mémoire alignée sur 16 octets (vec4f WGSL) exportée vers WebGPU.
/// Taille totale : 34 vec4f = 136 f32 = 544 octets.
#[repr(C, align(16))]
pub struct RelativityPhysicsLut {
    /// Horizons & ISCO en unités géométriques (G = c = M = 1, où r_s = 2M) :
    /// .x = r_plus (Horizon des événements externe : 1 + sqrt(1 - a*^2))
    /// .y = r_minus (Horizon de Cauchy interne : 1 - sqrt(1 - a*^2))
    /// .z = r_isco (Dernière orbite circulaire stable exacte de Bardeen-Press-Teukolsky)
    /// .w = omega_horizon (Vitesse angulaire de l'horizon Ω_H = a* / (2 * r_plus) pour les jets Blandford-Znajek)
    pub kerr_horizons_and_isco: [f32; 4],

    /// Sphère de photons & Paramètres d'impact critiques (Asymétrie de Kerr) :
    /// .x = r_ph_prograde (Orbite photonique co-rotative)
    /// .y = r_ph_retrograde (Orbite photonique contra-rotative)
    /// .z = b_crit_prograde (Paramètre d'impact critique côté prograde)
    /// .w = b_crit_retrograde (Paramètre d'impact critique côté rétrograde)
    pub photon_sphere_and_shadow: [f32; 4],

    /// 16 échantillons radiaux du disque d'accrétion relativiste (de r_ISCO à r_outer) :
    /// .x = Température normalisée T(r) / T_peak selon Novikov-Thorne
    /// .y = Vitesse orbitale relativiste β(r) = v_φ(r) / c dans le plan équatorial de Kerr
    /// .z = Facteur de décalage gravitationnel (Lapse) α_grav(r) = sqrt(1 - 2M / r)
    /// .w = Densité optique radiale normalisée Σ(r)
    pub disk_radial_lut: [[f32; 4]; RADIAL_LUT_SAMPLES],

    /// 16 échantillons logarithmiques du Corps Noir de Planck (1 200 K -> 48 000 K) en Rec.709 linéaire :
    /// .x = Rouge linéaire (R) normalisé en luminance chromatique
    /// .y = Vert linéaire (G) normalisé en luminance chromatique
    /// .z = Bleu linéaire (B) normalisé en luminance chromatique
    /// .w = Température effective T en Kelvin (pour vérification/interpolation)
    pub planck_blackbody_lut: [[f32; 4]; PLANCK_LUT_SAMPLES],
}

static mut RELATIVITY_LUT: RelativityPhysicsLut = RelativityPhysicsLut {
    kerr_horizons_and_isco: [0.0; 4],
    photon_sphere_and_shadow: [0.0; 4],
    disk_radial_lut: [[0.0; 4]; RADIAL_LUT_SAMPLES],
    planck_blackbody_lut: [[0.0; 4]; PLANCK_LUT_SAMPLES],
};

// ============================================================================
// FONCTIONS MATHÉMATIQUES TRANSCENDANTES EN PUR RUST (#![no_std])
// ============================================================================

#[inline(always)]
fn abs_f32(x: f32) -> f32 {
    if x < 0.0 { -x } else { x }
}

#[inline(always)]
fn max_f32(a: f32, b: f32) -> f32 {
    if a > b { a } else { b }
}

#[inline(always)]
fn min_f32(a: f32, b: f32) -> f32 {
    if a < b { a } else { b }
}

#[inline(always)]
fn clamp_f32(x: f32, lo: f32, hi: f32) -> f32 {
    min_f32(max_f32(x, lo), hi)
}

#[inline(always)]
fn sqrt_f32(x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut i = x.to_bits();
    i = 0x1fbd1df5 + (i >> 1);
    let mut y = f32::from_bits(i);
    y = 0.5 * (y + x / y);
    y = 0.5 * (y + x / y);
    y = 0.5 * (y + x / y);
    y
}

#[inline(always)]
fn exp_f32(x: f32) -> f32 {
    let clamped = clamp_f32(x, -80.0, 80.0);
    let log2e = 1.44269504089_f32;
    let ln2 = 0.69314718056_f32;
    let k = (clamped * log2e) as i32;
    let r = clamped - (k as f32) * ln2;

    let r2 = r * r;
    let r3 = r2 * r;
    let r4 = r2 * r2;
    let r5 = r4 * r;
    let r6 = r4 * r2;
    let exp_r = 1.0
        + r
        + 0.5 * r2
        + (1.0 / 6.0) * r3
        + (1.0 / 24.0) * r4
        + (1.0 / 120.0) * r5
        + (1.0 / 720.0) * r6;

    let pow2k_bits = ((k + 127) as u32) << 23;
    let pow2k = f32::from_bits(pow2k_bits);
    exp_r * pow2k
}

#[inline(always)]
fn ln_f32(x: f32) -> f32 {
    if x <= 0.0 {
        return -80.0;
    }
    let bits = x.to_bits();
    let exp = ((bits >> 23) as i32) - 127;
    let mant = f32::from_bits((bits & 0x007fffff) | 0x3f800000);
    let u = (mant - 1.0) / (mant + 1.0);
    let u2 = u * u;
    let ln_m = 2.0 * u * (1.0 + u2 * ((1.0 / 3.0) + u2 * ((1.0 / 5.0) + u2 * (1.0 / 7.0))));
    ln_m + (exp as f32) * 0.69314718056_f32
}

#[inline(always)]
fn pow_f32(x: f32, y: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    exp_f32(y * ln_f32(x))
}

#[inline(always)]
fn cbrt_f32(x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    pow_f32(x, 1.0 / 3.0)
}

/// Cosinus sur [-π, π] par réduction de période et polynôme de Taylor d'ordre 8
#[inline(always)]
fn cos_f32(x: f32) -> f32 {
    let two_pi = 6.28318530718_f32;
    let inv_two_pi = 0.15915494309_f32;
    let k = (x * inv_two_pi) as i32;
    let mut r = x - (k as f32) * two_pi;
    if r > 3.14159265359_f32 {
        r -= two_pi;
    } else if r < -3.14159265359_f32 {
        r += two_pi;
    }
    let r2 = r * r;
    let r4 = r2 * r2;
    let r6 = r4 * r2;
    let r8 = r4 * r4;
    1.0 - 0.5 * r2 + (1.0 / 24.0) * r4 - (1.0 / 720.0) * r6 + (1.0 / 40320.0) * r8
}

/// Arc-cosinus haute précision sur [-1, 1] (Approximation rationnelle d'Abramowitz & Stegun)
#[inline(always)]
fn acos_f32(x: f32) -> f32 {
    let clamped = clamp_f32(x, -1.0, 1.0);
    let ax = abs_f32(clamped);
    let ret = ((-0.0187293 * ax + 0.0742610) * ax - 0.2121144) * ax + 1.5707288;
    let root = sqrt_f32(max_f32(0.0, 1.0 - ax));
    let val = ret * root;
    if clamped < 0.0 {
        3.14159265359_f32 - val
    } else {
        val
    }
}

/// Fonctions colorimétriques CIE 1931 2° Standard Observer (Wyman, Sloan & Shirley 2013)
fn cie1931_xyz(lambda_nm: f32) -> [f32; 3] {
    let t1_x = (lambda_nm - 442.0) * (if lambda_nm < 442.0 { 0.0624 } else { 0.0374 });
    let t2_x = (lambda_nm - 599.8) * (if lambda_nm < 599.8 { 0.0264 } else { 0.0323 });
    let t3_x = (lambda_nm - 501.1) * (if lambda_nm < 501.1 { 0.0490 } else { 0.0382 });
    let x = 0.362 * exp_f32(-0.5 * t1_x * t1_x)
        + 1.056 * exp_f32(-0.5 * t2_x * t2_x)
        - 0.065 * exp_f32(-0.5 * t3_x * t3_x);

    let t1_y = (lambda_nm - 568.8) * (if lambda_nm < 568.8 { 0.0213 } else { 0.0247 });
    let t2_y = (lambda_nm - 530.9) * (if lambda_nm < 530.9 { 0.0613 } else { 0.0322 });
    let y = 0.821 * exp_f32(-0.5 * t1_y * t1_y) + 0.286 * exp_f32(-0.5 * t2_y * t2_y);

    let t1_z = (lambda_nm - 437.0) * (if lambda_nm < 437.0 { 0.0845 } else { 0.0278 });
    let t2_z = (lambda_nm - 459.0) * (if lambda_nm < 459.0 { 0.0385 } else { 0.0725 });
    let z = 1.217 * exp_f32(-0.5 * t1_z * t1_z) + 0.681 * exp_f32(-0.5 * t2_z * t2_z);

    [max_f32(0.0, x), max_f32(0.0, y), max_f32(0.0, z)]
}

/// Intègre la Loi de Planck B_λ(λ, T) sur le spectre visible [380 nm .. 760 nm]
/// et retourne la chromaticité Rec.709 linéaire normalisée pour une température T (en Kelvin).
fn compute_planck_rec709(temp_kelvin: f32) -> [f32; 4] {
    let t = clamp_f32(temp_kelvin, 1000.0, 60000.0);
    // Seconde constante de radiation de Planck : c2 = h * c / k_B = 1.438776877e7 nm·K
    let c2 = 1.4387769e7_f32;

    let mut sum_x = 0.0_f32;
    let mut sum_y = 0.0_f32;
    let mut sum_z = 0.0_f32;

    let bands = 16usize;
    let mut i = 0usize;
    while i < bands {
        let u = ((i as f32) + 0.5) / (bands as f32);
        let lambda_nm = 385.0 + u * (745.0 - 385.0);
        let l_um = lambda_nm * 0.001;
        let l5 = l_um * l_um * l_um * l_um * l_um;

        let exponent = clamp_f32(c2 / (lambda_nm * t), 0.05, 80.0);
        let spectral_radiance = 1.0 / (l5 * max_f32(1e-5, exp_f32(exponent) - 1.0));

        let xyz = cie1931_xyz(lambda_nm);
        sum_x += spectral_radiance * xyz[0];
        sum_y += spectral_radiance * xyz[1];
        sum_z += spectral_radiance * xyz[2];

        i += 1;
    }

    // Transformation CIE XYZ -> Rec.709 linéaire
    let r_raw = max_f32(0.0, 3.2404542 * sum_x - 1.5371385 * sum_y - 0.4985314 * sum_z);
    let g_raw = max_f32(0.0, -0.9692660 * sum_x + 1.8760108 * sum_y + 0.0415560 * sum_z);
    let b_raw = max_f32(0.0, 0.0556434 * sum_x - 0.2040259 * sum_y + 1.0572252 * sum_z);

    // Normalisation par la luminance perceptuelle / canal max pour préserver la teinte pure de corps noir
    // tandis que l'intensité bolométrique est gouvernée par la loi de Stefan-Boltzmann / Liouville g^4
    let lum = 0.2126 * r_raw + 0.7152 * g_raw + 0.0722 * b_raw;
    let peak = max_f32(r_raw, max_f32(g_raw, b_raw));
    let norm = 1.0 / max_f32(1e-5, 0.65 * peak + 0.35 * lum);

    [r_raw * norm, g_raw * norm, b_raw * norm, t]
}

#[no_mangle]
pub extern "C" fn get_relativity_lut_ptr() -> *const RelativityPhysicsLut {
    core::ptr::addr_of!(RELATIVITY_LUT)
}

#[no_mangle]
pub extern "C" fn get_relativity_lut_byte_size() -> usize {
    core::mem::size_of::<RelativityPhysicsLut>()
}

/// Calcule toutes les grandeurs exactes de la Métrique de Kerr (Bardeen-Press-Teukolsky 1972),
/// le profil radial du disque d'accrétion de Novikov-Thorne et la table spectrale de Planck.
///
/// - `spin_a`          : Paramètre de spin sans dimension a* = Jc / GM^2 dans [-0.998, 0.998]
/// - `disk_outer_r`    : Rayon externe du disque d'accrétion en unités de M (typ: 14.0 à 28.0 M)
/// - `peak_temp_kelvin`: Température maximale au pic d'émission du disque (typ: 6500 K à 14000 K)
#[no_mangle]
pub extern "C" fn compute_relativity_lut(
    spin_a: f32,
    disk_outer_r: f32,
    peak_temp_kelvin: f32,
) {
    let a = clamp_f32(spin_a, -0.998, 0.998);
    let abs_a = abs_f32(a);
    let a2 = a * a;

    // 1. Horizons des événements externe (r_+) et interne de Cauchy (r_-) en unités de M
    let root_one_minus_a2 = sqrt_f32(max_f32(0.0, 1.0 - a2));
    let r_plus = 1.0 + root_one_minus_a2;
    let r_minus = 1.0 - root_one_minus_a2;

    // Vitesse angulaire d'entraînement de l'horizon (Frame-Dragging / Blandford-Znajek)
    let omega_h = a / max_f32(1e-4, 2.0 * r_plus);

    // 2. Dernière Orbite Circulaire Stable (ISCO) exacte de Bardeen, Press & Teukolsky (1972)
    let cbrt_1_minus_a2 = cbrt_f32(max_f32(0.0, 1.0 - a2));
    let z1 = 1.0 + cbrt_1_minus_a2 * (cbrt_f32(1.0 + abs_a) + cbrt_f32(max_f32(0.0, 1.0 - abs_a)));
    let z2 = sqrt_f32(3.0 * a2 + z1 * z1);
    let isco_term = sqrt_f32(max_f32(0.0, (3.0 - z1) * (3.0 + z1 + 2.0 * z2)));
    let r_isco = if a >= 0.0 {
        max_f32(r_plus + 0.05, 3.0 + z2 - isco_term)
    } else {
        3.0 + z2 + isco_term
    };

    unsafe {
        RELATIVITY_LUT.kerr_horizons_and_isco = [r_plus, r_minus, r_isco, omega_h];
    }

    // 3. Orbites photoniques circulaires prograde (r_ph^+) et rétrograde (r_ph^-)
    // r_ph = 2M * [1 + cos((2/3) * arccos(∓a*))]
    let r_ph_pro = 2.0 * (1.0 + cos_f32((2.0 / 3.0) * acos_f32(-a)));
    let r_ph_ret = 2.0 * (1.0 + cos_f32((2.0 / 3.0) * acos_f32(a)));

    // Paramètres d'impact critiques correspondants (pour r_s = 2M, b_crit = 3*sqrt(3)*M ≈ 5.196 M pour a*=0)
    let b_crit_pro = (r_ph_pro * r_ph_pro - 2.0 * a * sqrt_f32(r_ph_pro) + a2)
        / max_f32(0.1, sqrt_f32(r_ph_pro) * (r_ph_pro - 2.0) + a);
    let b_crit_ret = (r_ph_ret * r_ph_ret + 2.0 * a * sqrt_f32(r_ph_ret) + a2)
        / max_f32(0.1, sqrt_f32(r_ph_ret) * (r_ph_ret - 2.0) - a);

    unsafe {
        RELATIVITY_LUT.photon_sphere_and_shadow = [
            r_ph_pro,
            r_ph_ret,
            abs_f32(b_crit_pro),
            abs_f32(b_crit_ret),
        ];
    }

    // 4. Profil radial de Novikov-Thorne / Page-Thorne sur [r_ISCO .. r_outer]
    // Le pic thermique théorique de T(r) ∝ [ (r_ISCO / r)^3 * (1 - sqrt(r_ISCO / r)) ]^(1/4)
    // est atteint exactement à r_peak = (49 / 36) * r_ISCO ≈ 1.3611 * r_ISCO.
    // À ce rayon, (36/49)^3 * (1 - 6/7) = 0.056653 -> racine quatrième = 0.4879
    let r_outer = max_f32(r_isco + 4.0, disk_outer_r);
    let peak_norm_inv = 1.0 / 0.48789_f32;

    let mut k = 0usize;
    while k < RADIAL_LUT_SAMPLES {
        let u = (k as f32) / ((RADIAL_LUT_SAMPLES - 1) as f32);
        let r = r_isco + u * (r_outer - r_isco);

        // Profil de température de Shakura-Sunyaev / Novikov-Thorne avec condition de bord nul à r_ISCO
        let ratio = clamp_f32(r_isco / r, 0.0, 1.0);
        let zero_torque = max_f32(0.0, 1.0 - sqrt_f32(ratio));
        let flux_profile = ratio * ratio * ratio * zero_torque;
        // Adoucissement continu au bord interne (rayonnement de plongée intra-ISCO faible mais non nul)
        let temp_norm = clamp_f32(pow_f32(flux_profile, 0.25) * peak_norm_inv, 0.08, 1.25);

        // Vitesse orbitale képlérienne relativiste dans la métrique de Kerr :
        // v_φ / c = 1 / sqrt(r - 2 + 2 * a* / sqrt(r)) (bornée sous 0.72 c pour la stabilité numérique)
        let denom_vel = max_f32(0.65, r - 2.0 + 2.0 * a / max_f32(0.5, sqrt_f32(r)));
        let beta_orb = clamp_f32(1.0 / sqrt_f32(denom_vel), 0.05, 0.72);

        // Facteur de décalage gravitationnel (Lapse) α_grav = sqrt(1 - 2M / r)
        let alpha_grav = sqrt_f32(clamp_f32(1.0 - 2.0 / max_f32(2.05, r), 0.05, 1.0));

        // Enveloppe de densité de surface du disque Σ(r) (croissance douce depuis l'ISCO + extinction externe)
        let inner_ramp = clamp_f32((u + 0.02) * 8.0, 0.0, 1.0);
        let outer_fade = 1.0 - u * u * (3.0 - 2.0 * u);
        let sigma_density = inner_ramp * outer_fade;

        unsafe {
            RELATIVITY_LUT.disk_radial_lut[k] = [temp_norm, beta_orb, alpha_grav, sigma_density];
        }
        k += 1;
    }

    // 5. Table spectrale de Corps Noir de Planck CIE 1931 -> Rec.709 (1 200 K à 48 000 K)
    // modulée par la température de référence choisie par l'utilisateur
    let temp_scale = clamp_f32(peak_temp_kelvin / 8500.0, 0.35, 3.0);
    let t_min = 1200.0_f32;
    let t_max = 48000.0_f32;
    let log_ratio = ln_f32(t_max / t_min);

    let mut p = 0usize;
    while p < PLANCK_LUT_SAMPLES {
        let u = (p as f32) / ((PLANCK_LUT_SAMPLES - 1) as f32);
        let t_k = t_min * exp_f32(u * log_ratio) * temp_scale;
        unsafe {
            RELATIVITY_LUT.planck_blackbody_lut[p] = compute_planck_rec709(t_k);
        }
        p += 1;
    }
}

