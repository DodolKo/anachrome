# Anachrome.js

> **Turn any modern website into an authentic CRT monitor, arcade cabinet, or photochemical 35mm film display with hardware-accelerated WebGPU.**  
> *Zero dependencies. 60+ FPS. Vanilla JS, React & Vue/Nuxt.*  
> **Created by [Doko](https://github.com/DodolKo)**

---

## ⚡ Highlights

- **🖥️ CRT Tube Simulation**: Physical curvature (X/Y), beam-aware scanlines, phosphor glow, barrel distortion and edge vignetting.
- **🎞️ Photochemical Halation**: 3-layer backscattering emulation (Kodak Vision3 / CineStill 800T) with Beer-Lambert absorption and Remjet removal.
- **🔬 Spectral Chromatic Aberration**: Sellmeier 12-band optical dispersion + CIE 1931 observer curve + Seidel $r^3/r^5$ aberrations.
- **✨ Pyramidal HDR Bloom**: Multi-level mipmap diffusion with Bessel $J_1$ Airy diffraction disk, Mie scattering in optical glass, and horizontal anamorphic flares.
- **📷 Fujifilm X-Trans Sensor Noise**: Dual-octave (micro/meso) grain, ISO sensitivity scaling (400–64000), and temporal persistence.
- **🚀 Zero Dependencies**: Pure WebGPU + inlined Rust WASM. No external shaders or heavyweight graphics libraries required.

---

## 📦 Installation

Install directly from Git without NPM registry hassle:

```bash
# With NPM
npm install git+https://github.com/DodolKo/anachrome.git

# With PNPM
pnpm add git+https://github.com/DodolKo/anachrome.git
```

---

## 🚀 Quick Start

### 1. Vanilla HTML / JS

```html
<canvas id="anachrome-layer" style="position:fixed;inset:0;pointer-events:none;z-index:9999;"></canvas>

<script type="module">
  import { Anachrome } from 'anachrome';

  // Mount with a preset in 1 line
  const fx = Anachrome.mount('#anachrome-layer', {
    preset: 'arcade', // 'arcade', 'cinestill', 'cyberpunk', 'matrixTerminal', 'vhs80s'
  });

  // Switch preset anytime
  // fx.setPreset('cinestill');

  // Clean up
  // fx.destroy();
</script>
```

### 2. React / Next.js

```tsx
import { AnachromeCanvas } from 'anachrome/react';

export default function App() {
  return (
    <>
      <main>Your normal website content</main>

      {/* Retro WebGPU Overlay */}
      <AnachromeCanvas preset="cinestill" />
    </>
  );
}
```

### 3. Vue 3 / Nuxt 3

```vue
<template>
  <div>
    <main>Your normal website content</main>

    <!-- Overlay Anachrome -->
    <ClientOnly>
      <AnachromeCanvas preset="arcade" />
    </ClientOnly>
  </div>
</template>

<script setup>
import { AnachromeCanvas } from 'anachrome/vue';
</script>
```

---

## 🎨 Built-in Presets

| Preset | Description |
| :--- | :--- |
| `arcade` | Curved CRT arcade monitor with scanlines, tube overscan and blooming highlights. |
| `cinestill` | Warm 35mm film halation (CineStill 800T), anamorphic flare and natural ISO grain. |
| `cyberpunk` | Neon high-contrast bloom, anamorphic lens flares and spectral chromatic split. |
| `matrixTerminal` | Monochromatic green phosphor tube with high persistence and scanlines. |
| `vhs80s` | Lo-fi analog video tape bleed, lateral chromatic dispersion and CRT curvature. |
| `subtleCinematic` | Gentle production-grade film grain and soft halation for elegant websites. |

---

## 🛠️ Advanced Customization

```ts
import { AnachromeRenderer } from 'anachrome';

const renderer = new AnachromeRenderer(canvasElement, {
  crt: {
    enabled: true,
    curvatureX: 0.12,
    curvatureY: 0.14,
    scanlinesEnabled: true,
    scanlineIntensity: 0.35,
    vignette: 0.4,
  },
  bloom: {
    enabled: true,
    intensity: 0.7,
    threshold: 0.45,
    radius: 1.5,
    anamorphicSqueeze: 1.6,
  },
  halation: {
    enabled: true,
    intensity: 0.9,
    radius: 1.4,
  },
  grain: {
    enabled: true,
    iso: 1600,
  },
});
```

---

## 📜 License & Attribution

This project is licensed under the **PolyForm Noncommercial License 1.0.0** with author attribution.

- **Noncommercial / Personal use**: Free to use, fork, study and integrate into noncommercial projects, portfolios and experiments, provided attribution to **Doko** is maintained.
- **Attribution requirement**: Any distribution or UI integration must mention:  
  *`Anachrome.js — Created by Doko (https://github.com/DodolKo/anachrome)`*
- **Commercial use**: Commercial or enterprise usage requires a commercial license. Contact **Doko** via GitHub: [https://github.com/DodolKo](https://github.com/DodolKo).
