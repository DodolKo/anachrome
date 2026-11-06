<template>
  <canvas
    v-if="isSupported"
    ref="canvasRef"
    :class="className"
    aria-hidden="true"
    style="position: fixed; inset: 0; pointer-events: none; z-index: 50; width: 100vw; height: 100vh;"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  AnachromeRenderer,
  type SensorNoiseOptions,
} from "../core/AnachromeRenderer";
import { ANACHROME_PRESETS } from "../presets/presets";

export interface AnachromeVueProps extends SensorNoiseOptions {
  className?: string;
  preset?: keyof typeof ANACHROME_PRESETS | string;
}

const props = withDefaults(defineProps<AnachromeVueProps>(), {
  className: "fixed inset-0 pointer-events-none z-50 overflow-hidden",
});

const emit = defineEmits<{
  (e: "ready", renderer: AnachromeRenderer): void;
  (e: "unsupported"): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isSupported = ref(true);
let renderer: AnachromeRenderer | null = null;

function resolveOptions(): SensorNoiseOptions {
  let merged: SensorNoiseOptions = { ...props };
  if (props.preset && ANACHROME_PRESETS[props.preset]) {
    const p = ANACHROME_PRESETS[props.preset];
    merged = {
      ...merged,
      crt: { ...(p.crt || {}), ...(merged.crt || {}) },
      bloom: { ...(p.bloom || {}), ...(merged.bloom || {}) },
      halation: { ...(p.halation || {}), ...(merged.halation || {}) },
      chromaticAberration: { ...(p.chromaticAberration || {}), ...(merged.chromaticAberration || {}) },
      grain: { ...(p.grain || {}), ...(merged.grain || {}) },
    };
  }
  return merged;
}

onMounted(() => {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    isSupported.value = false;
    emit("unsupported");
    return;
  }

  if (canvasRef.value) {
    renderer = new AnachromeRenderer(canvasRef.value, resolveOptions());
    emit("ready", renderer);
  }
});

watch(
  () => [props, props.preset],
  () => {
    if (renderer) {
      renderer.updateOptions(resolveOptions());
    }
  },
  { deep: true }
);

onUnmounted(() => {
  if (renderer) {
    renderer.destroy();
    renderer = null;
  }
});
</script>

