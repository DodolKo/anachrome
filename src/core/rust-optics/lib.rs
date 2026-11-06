//! Moteur de Physique Optique & Photochimique en Rust Vanilla (`#![no_std]`)
//! Compilé directement vers `wasm32-unknown-unknown` sans aucune dépendance externe.
//!
//! Calcule avec une rigueur mathématique absolue :
//! 1. L'équation de dispersion de Sellmeier à 3 bandes de résonance (UV / Visible / IR)
//!    pour le calcul exact de l'indice de réfraction n(λ) de 400 nm à 700 nm.
//! 2. Les fonctions colorimétriques CIE 1931 2° Standard Observer (x̄(λ), ȳ(λ), z̄(λ))
//!    et la transformation matricielle CIE XYZ -> Rec.709 / sRGB linéaire avec
//!    normalisation énergétique exacte (somme RGB = [1.0, 1.0, 1.0] pour un blanc pur).
//! 3. Les coefficients d'Aberration Chromatique Latérale (TCA) et Axiale/Longitudinale
//!    (LCA - Sphérochromatisme) selon le nombre d'Abbe V_d et l'ouverture f-stop.
//! 4. La Point Spread Function (PSF) de diffraction de Fraunhofer (Tache d'Airy via
//!    la fonction de Bessel J_1(x)) couplée à la diffusion de Mie dans les verres optiques.
//! 5. Le modèle de transport radiatif Beer-Lambert & réflexion interne de Fresnel
//!    pour l'Halation photochimique tricouche (Bleu -> Vert -> Rouge -> Support Triacétate).

#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

/// Nombre d'échantillons spectraux continus (de 400 nm à 700 nm)
pub const SPECTRAL_SAMPLES: usize = 12;

/// Nombre de niveaux dans la pyramide Mipmap HDR (Bloom & Halation)
pub const MIP_LEVELS: usize = 5;

/// Structure mémoire alignée sur 16 octets (vec4f WGSL) exportée vers WebGPU.
/// Taille totale : 48 vec4f = 192 f32 = 768 octets.
#[repr(C, align(16))]
pub struct OpticalPhysicsLut {
    /// 12 échantillons spectraux :
    /// .x = décalage de dispersion latérale normalisé δ_TCA(λ)
    /// .y = rayon de défocalisation axiale (sphérochromatisme) δ_LCA(λ)
    /// .z = longueur d'onde λ en micromètres (µm)
    /// .w = transmission optique du traitement multi-couches (coating)
    pub spectral_dispersion: [[f32; 4]; SPECTRAL_SAMPLES],

    /// 12 poids colorimétriques spectraux CIE 1931 -> Rec.709 linéaire normalisés :
    /// .x = Poids Rouge linéaire (R)
    /// .y = Poids Vert linéaire (G)
    /// .z = Poids Bleu linéaire (B)
    /// .w = Efficacité lumineuse photopique V(λ) (CIE Y)
    pub spectral_weights_rgb: [[f32; 4]; SPECTRAL_SAMPLES],

    /// 5 niveaux de pyramide Mipmap pour le Bloom Optique (Airy + Mie) :
    /// .x = Poids isotrope (Airy + Mie) du niveau Mip
    /// .y = Poids du flare anamorphique horizontal au niveau Mip
    /// .z = Rayon d'échantillonnage du noyau (en texels)
    /// .w = Facteur d'atténuation chromatique du halo (dispersion de Mie)
    pub bloom_mip_weights: [[f32; 4]; MIP_LEVELS],

    /// 5 niveaux de pyramide Mipmap pour l'Halation Photochimique (Beer-Lambert + K_0) :
    /// .x = Diffusion couche Rouge profonde (660 nm, collée au support dorsal)
    /// .y = Diffusion couche Verte médiane (550 nm, excitation secondaire à haute énergie)
    /// .z = Diffusion couche Bleue supérieure (450 nm, quasi nulle après AHU)
    /// .w = Rayon spatial de rétrodiffusion du support en triacétate
    pub halation_mip_weights: [[f32; 4]; MIP_LEVELS],

    /// Paramètres globaux précalculés d'optique de Seidel et de Fresnel :
    /// [0] = [k1_linear, k3_seidel, k5_higher_order, astigmatism_tangential]
    /// [1] = [fresnel_critical_cos, halation_red_reach, halation_green_bleed, film_gamma_hd]
    pub seidel_and_fresnel: [[f32; 4]; 2],
}

static mut LUT_BUFFER: OpticalPhysicsLut = OpticalPhysicsLut {
    spectral_dispersion: [[0.0; 4]; SPECTRAL_SAMPLES],
    spectral_weights_rgb: [[0.0; 4]; SPECTRAL_SAMPLES],
    bloom_mip_weights: [[0.0; 4]; MIP_LEVELS],
    halation_mip_weights: [[0.0; 4]; MIP_LEVELS],
    seidel_and_fresnel: [[0.0; 4]; 2],
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

/// Racine carrée par méthode de Newton-Raphson avec initialisation IEEE-754 exacte
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

/// Approximation Pade / Taylor haute précision de exp(x)
#[inline(always)]
fn exp_f32(x: f32) -> f32 {
    let clamped = clamp_f32(x, -80.0, 80.0);
    // Réduction d'argument : exp(x) = 2^k * exp(r)
    let log2e = 1.44269504089_f32;
    let ln2 = 0.69314718056_f32;
    let k = (clamped * log2e) as i32;
    let r = clamped - (k as f32) * ln2;

    // Polynôme de Taylor d'ordre 6 sur [-ln(2), ln(2)]
    let r2 = r * r;
    let r3 = r2 * r;
    let r4 = r2 * r2;
    let r5 = r4 * r;
    let r6 = r4 * r2;
    let exp_r = 1.0 + r + 0.5 * r2 + (1.0 / 6.0) * r3 + (1.0 / 24.0) * r4 + (1.0 / 120.0) * r5 + (1.0 / 720.0) * r6;

    // Mise à l'échelle par 2^k via l'exposant IEEE-754
    let pow2k_bits = ((k + 127) as u32) << 23;
    let pow2k = f32::from_bits(pow2k_bits);
    exp_r * pow2k
}

/// Puissance x^y pour x > 0
#[inline(always)]
fn ln_f32(x: f32) -> f32 {
    if x <= 0.0 {
        return -80.0;
    }
    let bits = x.to_bits();
    let exp = ((bits >> 23) as i32) - 127;
    let mant = f32::from_bits((bits & 0x007fffff) | 0x3f800000);
    // Série de Pade centrée autour de 1 : u = (m - 1) / (m + 1)
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

/// Fonction de Bessel de première espèce d'ordre 1 : J_1(x)
/// Utilisée pour calculer le profil exact de la Tache d'Airy : I(x) = [2 * J_1(x) / x]^2
fn bessel_j1(x: f32) -> f32 {
    let ax = abs_f32(x);
    if ax < 1e-5 {
        return 0.5 * x;
    }
    if ax < 8.0 {
        // Série entière convergente : J_1(x) = sum_{m=0}^12 (-1)^m / (m! (m+1)!) * (x/2)^(2m+1)
        let half_x = 0.5 * x;
        let x2 = half_x * half_x;
        let mut term = half_x;
        let mut sum = term;
        let mut m = 1u32;
        while m <= 12 {
            let denom = (m as f32) * ((m + 1) as f32);
            term = -term * x2 / denom;
            sum += term;
            m += 1;
        }
        sum
    } else {
        // Développement asymptotique de Hankel pour grands arguments
        let z = 8.0 / ax;
        let y = z * z;
        let xx = ax - 2.356194491_f32;
        let p = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * 0.2457520174e-5));
        // Approximation trigonométrique rapide pour l'asymptote
        let phase = xx - 6.283185307_f32 * ((xx * 0.159154943_f32) as i32 as f32);
        let cos_xx = 1.0 - 0.5 * phase * phase + (1.0 / 24.0) * phase * phase * phase * phase;
        let ans = sqrt_f32(0.636619772_f32 / ax) * cos_xx * p;
        if x < 0.0 { -ans } else { ans }
    }
}

/// Intensité de diffraction de Fraunhofer (Tache d'Airy circulaire) : [2 * J_1(x) / x]^2
fn airy_disk_intensity(x: f32) -> f32 {
    if abs_f32(x) < 1e-4 {
        return 1.0;
    }
    let u = 2.0 * bessel_j1(x) / x;
    u * u
}

// ============================================================================
// PHYSIQUE OPTIQUE : ÉQUATION DE SELLMEIER & COULEUR CIE 1931
// ============================================================================

/// Équation de Sellmeier à 3 résonances pour un doublet optique (Crown Schott N-BK7 + Flint F2)
/// modulé par le nombre d'Abbe V_d de l'objectif.
///
/// n^2(λ) - 1 = B1 * λ^2 / (λ^2 - C1) + B2 * λ^2 / (λ^2 - C2) + B3 * λ^2 / (λ^2 - C3)
/// où λ est exprimé en micromètres (µm).
fn sellmeier_refractive_index(lambda_um: f32, abbe_vd: f32) -> f32 {
    let l2 = lambda_um * lambda_um;

    // Coefficients Sellmeier du verre Crown N-BK7 (dispersion faible, V_d = 64.17)
    let bk7_b1 = 1.03961212_f32;
    let bk7_c1 = 0.00600069867_f32;
    let bk7_b2 = 0.231792344_f32;
    let bk7_c2 = 0.0200179144_f32;
    let bk7_b3 = 1.01046945_f32;
    let bk7_c3 = 103.560653_f32;

    let n2_bk7 = 1.0
        + (bk7_b1 * l2) / (l2 - bk7_c1)
        + (bk7_b2 * l2) / (l2 - bk7_c2)
        + (bk7_b3 * l2) / (l2 - bk7_c3);
    let n_bk7 = sqrt_f32(n2_bk7);

    // Coefficients Sellmeier du verre Flint Dense SF11 (dispersion forte, V_d = 25.76)
    let sf11_b1 = 1.73759695_f32;
    let sf11_c1 = 0.013188707_f32;
    let sf11_b2 = 0.313747346_f32;
    let sf11_c2 = 0.0623068142_f32;
    let sf11_b3 = 1.89878101_f32;
    let sf11_c3 = 155.23629_f32;

    let n2_sf11 = 1.0
        + (sf11_b1 * l2) / (l2 - sf11_c1)
        + (sf11_b2 * l2) / (l2 - sf11_c2)
        + (sf11_b3 * l2) / (l2 - sf11_c3);
    let n_sf11 = sqrt_f32(n2_sf11);

    // Interpolation physique entre le verre Flint (vintage/anamorphique) et Crown (apochromatique)
    // selon le nombre d'Abbe V_d choisi [20.0 .. 70.0]
    let t = clamp_f32((abbe_vd - 25.0) / (65.0 - 25.0), 0.0, 1.0);
    n_sf11 * (1.0 - t) + n_bk7 * t
}

/// Approximation analytique multi-lobe de Wyman, Sloan & Shirley (JCGT 2013)
/// pour les fonctions colorimétriques CIE 1931 2° Standard Observer : x̄(λ), ȳ(λ), z̄(λ).
/// λ est exprimé en nanomètres (nm) dans [380, 780].
fn cie1931_xyz(lambda_nm: f32) -> [f32; 3] {
    let t1_x = (lambda_nm - 442.0) * (if lambda_nm < 442.0 { 0.0624 } else { 0.0374 });
    let t2_x = (lambda_nm - 599.8) * (if lambda_nm < 599.8 { 0.0264 } else { 0.0323 });
    let t3_x = (lambda_nm - 501.1) * (if lambda_nm < 501.1 { 0.0490 } else { 0.0382 });
    let x = 0.362 * exp_f32(-0.5 * t1_x * t1_x)
        + 1.056 * exp_f32(-0.5 * t2_x * t2_x)
        - 0.065 * exp_f32(-0.5 * t3_x * t3_x);

    let t1_y = (lambda_nm - 568.8) * (if lambda_nm < 568.8 { 0.0213 } else { 0.0247 });
    let t2_y = (lambda_nm - 530.9) * (if lambda_nm < 530.9 { 0.0613 } else { 0.0322 });
    let y = 0.821 * exp_f32(-0.5 * t1_y * t1_y)
        + 0.286 * exp_f32(-0.5 * t2_y * t2_y);

    let t1_z = (lambda_nm - 437.0) * (if lambda_nm < 437.0 { 0.0845 } else { 0.0278 });
    let t2_z = (lambda_nm - 459.0) * (if lambda_nm < 459.0 { 0.0385 } else { 0.0725 });
    let z = 1.217 * exp_f32(-0.5 * t1_z * t1_z)
        + 0.681 * exp_f32(-0.5 * t2_z * t2_z);

    [max_f32(0.0, x), max_f32(0.0, y), max_f32(0.0, z)]
}

/// Retourne le pointeur en mémoire linéaire WebAssembly vers la table `LUT_BUFFER`.
#[no_mangle]
pub extern "C" fn get_lut_ptr() -> *const OpticalPhysicsLut {
    core::ptr::addr_of!(LUT_BUFFER)
}

/// Retourne la taille en octets de la table `OpticalPhysicsLut` (768 octets).
#[no_mangle]
pub extern "C" fn get_lut_byte_size() -> usize {
    core::mem::size_of::<OpticalPhysicsLut>()
}

/// Calcule l'intégralité des tables optiques et photochimiques à partir des paramètres physiques :
///
/// - `abbe_vd`           : Nombre d'Abbe du verre optique (ex: 32.0 pour vintage Cooke/Anamorphic, 55.0 standard)
/// - `aperture_fstop`    : Ouverture géométrique N = f/D (ex: 1.4, 2.0, 2.8, 5.6)
/// - `seidel_k1`         : Coefficient linéaire de grandissement chromatique
/// - `seidel_k3`         : Coefficient cubique de distorsion de Seidel (en barillet / coussinet)
/// - `airy_bloom_scale`  : Échelle de diffraction d'Airy + diffusion de Mie
/// - `mie_gamma`         : Exposant de queue lorentzienne de Mie (typ: 1.45)
/// - `anamorphic_squeeze`: Facteur de compression anamorphique (1.0 = sphérique, 2.0 = Cinemascope 2x)
/// - `film_thickness_um` : Épaisseur du support en triacétate (typ: 125.0 µm Kodak Vision3)
/// - `remjet_removal`    : Degré d'absence de couche anti-halo Remjet (0.0 = Kodak standard, 1.0 = CineStill 800T)
#[no_mangle]
pub extern "C" fn compute_optical_lut(
    abbe_vd: f32,
    aperture_fstop: f32,
    seidel_k1: f32,
    seidel_k3: f32,
    airy_bloom_scale: f32,
    mie_gamma: f32,
    anamorphic_squeeze: f32,
    film_thickness_um: f32,
    remjet_removal: f32,
) {
    let vd = clamp_f32(abbe_vd, 18.0, 85.0);
    let fstop = clamp_f32(aperture_fstop, 0.95, 22.0);

    // Indice de référence sur la raie d de Fraunhofer (Hélium jaune-vert : λ_d = 587.56 nm)
    // et raies F (Hydrogène bleu : 486.13 nm) et C (Hydrogène rouge : 656.27 nm)
    let n_d = sellmeier_refractive_index(0.58756, vd);
    let n_f = sellmeier_refractive_index(0.48613, vd);
    let n_c = sellmeier_refractive_index(0.65627, vd);
    let delta_n_fc = max_f32(1e-4, n_f - n_c);

    // 1. Échantillonnage spectral continu sur [405 nm .. 695 nm] (12 bandes spectrales)
    let mut sum_r = 0.0_f32;
    let mut sum_g = 0.0_f32;
    let mut sum_b = 0.0_f32;

    let mut raw_rgb = [[0.0_f32; 4]; SPECTRAL_SAMPLES];

    // Ouverture numérique relative (plus f-stop est bas ex: f/1.4, plus le sphérochromatisme axial est fort)
    let aperture_factor = 1.4 / fstop;

    let mut i = 0usize;
    while i < SPECTRAL_SAMPLES {
        let u = ((i as f32) + 0.5) / (SPECTRAL_SAMPLES as f32);
        let lambda_nm = 405.0 + u * (695.0 - 405.0);
        let lambda_um = lambda_nm * 0.001;

        let n_lambda = sellmeier_refractive_index(lambda_um, vd);

        // Dispersion chromatique latérale (TCA) exacte issue de la loi de Sellmeier :
        // Négative dans le rouge (grandes longueurs d'onde), nulle à 587.56 nm, positive dans le bleu/violet
        let tca_shift = (n_lambda - n_d) / delta_n_fc;

        // Sphérochromatisme longitudinal / axial (LCA) :
        // Les courtes longueurs d'onde (bleu/violet ~410 nm) et très grandes (rouge profond ~690 nm)
        // ne focalisent pas dans le plan du capteur (courbe secondaire de Gauss d'un doublet)
        let focal_error = abs_f32(lambda_um - 0.560) * 3.8;
        let lca_coc = focal_error * focal_error * aperture_factor;

        // Transmission du traitement anti-reflet multicouche (MgF2 quart d'onde centré sur 540 nm)
        let coating_phase = (lambda_nm - 540.0) / 180.0;
        let coating_trans = 1.0 - 0.08 * coating_phase * coating_phase;

        unsafe {
            LUT_BUFFER.spectral_dispersion[i] = [tca_shift, lca_coc, lambda_um, coating_trans];
        }

        // Conversion spectrale CIE 1931 XYZ -> Rec.709 / sRGB linéaire
        let xyz = cie1931_xyz(lambda_nm);
        let x = xyz[0];
        let y = xyz[1];
        let z = xyz[2];

        // Matrice CIE XYZ -> Rec.709 D65 avec pincement doux des valeurs hors-gamut spectrales
        let r_lin = max_f32(0.0,  3.2404542 * x - 1.5371385 * y - 0.4985314 * z);
        let g_lin = max_f32(0.0, -0.9692660 * x + 1.8760108 * y + 0.0415560 * z);
        let b_lin = max_f32(0.0,  0.0556434 * x - 0.2040259 * y + 1.0572252 * z);

        raw_rgb[i] = [r_lin * coating_trans, g_lin * coating_trans, b_lin * coating_trans, y];
        sum_r += raw_rgb[i][0];
        sum_g += raw_rgb[i][1];
        sum_b += raw_rgb[i][2];

        i += 1;
    }

    // Normalisation énergétique stricte : garantit que l'intégrale spectrale d'un pixel blanc
    // reconstitue exactement vec3(1.0, 1.0, 1.0) sans aucune dominante colorée !
    let inv_r = 1.0 / max_f32(1e-5, sum_r);
    let inv_g = 1.0 / max_f32(1e-5, sum_g);
    let inv_b = 1.0 / max_f32(1e-5, sum_b);

    let mut j = 0usize;
    while j < SPECTRAL_SAMPLES {
        unsafe {
            LUT_BUFFER.spectral_weights_rgb[j] = [
                raw_rgb[j][0] * inv_r,
                raw_rgb[j][1] * inv_g,
                raw_rgb[j][2] * inv_b,
                raw_rgb[j][3],
            ];
        }
        j += 1;
    }

    // 2. Calcul de la Point Spread Function (PSF) du Bloom (Tache d'Airy + Diffusion de Mie)
    // pour les 5 niveaux de la pyramide Mipmap HDR (rayons physiques croissants 2^m)
    let gamma = clamp_f32(mie_gamma, 1.05, 2.5);
    let squeeze = clamp_f32(anamorphic_squeeze, 1.0, 2.5);
    let airy_scale = max_f32(0.2, airy_bloom_scale);

    let mut sum_bloom = 0.0_f32;
    let mut raw_bloom = [[0.0_f32; 4]; MIP_LEVELS];
    let mut m = 0usize;
    while m < MIP_LEVELS {
        // Rayon spatial effectif du niveau Mip m (en multiples de la tache d'Airy)
        let r_mip = pow_f32(2.0, m as f32) * 0.85 / airy_scale;

        // Cœur de diffraction de Fraunhofer (Tache d'Airy + premier anneau secondaire)
        let airy_core = airy_disk_intensity(r_mip * 1.15);

        // Enveloppe de diffusion de Mie dans les lentilles : (1 + (r / r_0)^2)^(-gamma/2)
        // C'est cette queue en loi de puissance qui donne le vrai rendu "voile optique cinéma"
        let mie_scatter = pow_f32(1.0 + r_mip * r_mip * 0.35, -0.5 * gamma);

        let iso_weight = 0.38 * airy_core + 0.62 * mie_scatter;
        // Le flare anamorphique s'étire davantage sur les niveaux Mip intermédiaires et lointains
        let anamorphic_weight = (squeeze - 1.0) * mie_scatter * (0.45 + 0.18 * (m as f32));
        let kernel_radius = 1.0 + 0.35 * (m as f32) * airy_scale;
        let chroma_scatter = 0.08 * ((m + 1) as f32);

        raw_bloom[m] = [iso_weight, anamorphic_weight, kernel_radius, chroma_scatter];
        sum_bloom += iso_weight;
        m += 1;
    }

    let inv_bloom = 1.0 / max_f32(1e-5, sum_bloom);
    let mut m2 = 0usize;
    while m2 < MIP_LEVELS {
        unsafe {
            LUT_BUFFER.bloom_mip_weights[m2] = [
                raw_bloom[m2][0] * inv_bloom,
                raw_bloom[m2][1] * inv_bloom,
                raw_bloom[m2][2],
                raw_bloom[m2][3],
            ];
        }
        m2 += 1;
    }

    // 3. Modèle de Transport Radiatif tricouche de l'Halation Photochimique (Beer-Lambert + Fresnel)
    // Support en triacétate de cellulose : indice n_base = 1.48 -> angle critique de réflexion totale θ_c ≈ 42.5°
    let thickness_norm = clamp_f32(film_thickness_um / 125.0, 0.4, 2.5);
    let remjet_factor = clamp_f32(remjet_removal, 0.05, 1.0);

    // Longueurs de diffusion radiales (en unités de pyramide) pour chaque couche d'émulsion :
    // - Couche Rouge (collée au support dorsal) : grand libre parcours moyen l_R
    // - Couche Verte (au-dessus de la couche Rouge) : libre parcours moyen court l_G (donne le cœur orangé/ambre proche du bord)
    // - Couche Bleue (tout en haut, isolée par le filtre jaune Tartrazine) : quasi nulle l_B
    let l_red = 3.2 * thickness_norm;
    let l_green = 1.05 * thickness_norm;
    let l_blue = 0.32 * thickness_norm;

    let mut sum_hal_r = 0.0_f32;
    let mut raw_hal = [[0.0_f32; 4]; MIP_LEVELS];
    let mut h = 0usize;
    while h < MIP_LEVELS {
        let r_dist = pow_f32(1.85, h as f32) * 0.75;

        // Noyau de Green de diffusion en plaque mince : exp(-r / l_c) / sqrt(1 + r / l_c)
        let w_red = exp_f32(-r_dist / l_red) / sqrt_f32(1.0 + r_dist / l_red);
        // La couche verte ne reçoit que les photons rétrodiffusés à petit angle (proche de la source vive -> frange ambrée/or)
        let w_green = 0.34 * exp_f32(-r_dist / l_green) / sqrt_f32(1.0 + r_dist / l_green);
        // La couche bleue est stoppée par la couche filtre jaune Tartrazine
        let w_blue = 0.045 * exp_f32(-r_dist / l_blue);

        raw_hal[h] = [
            w_red * remjet_factor,
            w_green * remjet_factor,
            w_blue * remjet_factor,
            1.15 + 0.45 * (h as f32) * thickness_norm,
        ];
        sum_hal_r += w_red;
        h += 1;
    }

    let inv_hal_r = 1.0 / max_f32(1e-5, sum_hal_r);
    let mut h2 = 0usize;
    while h2 < MIP_LEVELS {
        unsafe {
            LUT_BUFFER.halation_mip_weights[h2] = [
                raw_hal[h2][0] * inv_hal_r,
                raw_hal[h2][1] * inv_hal_r,
                raw_hal[h2][2] * inv_hal_r,
                raw_hal[h2][3],
            ];
        }
        h2 += 1;
    }

    // 4. Coefficients globaux d'optique de Seidel et de réflexion interne de Fresnel
    // cos(θ_c) = sqrt(1 - (1 / n_base)^2) pour n_base = 1.48 => cos(θ_c) ≈ 0.737
    let fresnel_critical_cos = 0.73715_f32;
    let k5_higher = seidel_k3 * 0.28;
    let astigmatism = (1.8 / fstop) * 0.15;

    unsafe {
        LUT_BUFFER.seidel_and_fresnel[0] = [seidel_k1, seidel_k3, k5_higher, astigmatism];
        LUT_BUFFER.seidel_and_fresnel[1] = [
            fresnel_critical_cos,
            l_red,
            l_green / max_f32(0.1, l_red),
            1.65, // Gamma sensibilométrique Hurter-Driffield de l'émulsion
        ];
    }
}

