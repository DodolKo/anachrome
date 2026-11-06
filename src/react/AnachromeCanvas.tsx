import React, { useEffect, useRef, useState } from "react";
import {
  AnachromeRenderer,
  type BloomOptions,
  type ChromaticAberrationOptions,
  type CrtOptions,
  type GrainOptions,
  type HalationOptions,
  type SensorNoiseOptions,
} from "../core/AnachromeRenderer";
import { ANACHROME_PRESETS } from "../presets/presets";

export interface AnachromeCanvasProps extends SensorNoiseOptions {
  className?: string;
  preset?: keyof typeof ANACHROME_PRESETS | string;
  onUnsupported?: () => void;
  onReady?: (renderer: AnachromeRenderer) => void;
}

export const AnachromeCanvas: React.FC<AnachromeCanvasProps> = ({
  className = "fixed inset-0 pointer-events-none z-50 overflow-hidden",
  preset,
  onUnsupported,
  onReady,
  ...options
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<AnachromeRenderer | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
      setIsSupported(false);
      onUnsupported?.();
      return;
    }

    if (!canvasRef.current) return;

    let mergedOptions = { ...options };
    if (preset && ANACHROME_PRESETS[preset]) {
      const p = ANACHROME_PRESETS[preset];
      mergedOptions = {
        ...mergedOptions,
        crt: { ...(p.crt || {}), ...(mergedOptions.crt || {}) },
        bloom: { ...(p.bloom || {}), ...(mergedOptions.bloom || {}) },
        halation: { ...(p.halation || {}), ...(mergedOptions.halation || {}) },
        chromaticAberration: { ...(p.chromaticAberration || {}), ...(mergedOptions.chromaticAberration || {}) },
        grain: { ...(p.grain || {}), ...(mergedOptions.grain || {}) },
      };
    }

    const renderer = new AnachromeRenderer(canvasRef.current, mergedOptions);
    rendererRef.current = renderer;
    onReady?.(renderer);

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Hot update of options when props change
  useEffect(() => {
    if (!rendererRef.current) return;
    let mergedOptions = { ...options };
    if (preset && ANACHROME_PRESETS[preset]) {
      const p = ANACHROME_PRESETS[preset];
      mergedOptions = {
        ...mergedOptions,
        crt: { ...(p.crt || {}), ...(mergedOptions.crt || {}) },
        bloom: { ...(p.bloom || {}), ...(mergedOptions.bloom || {}) },
        halation: { ...(p.halation || {}), ...(mergedOptions.halation || {}) },
        chromaticAberration: { ...(p.chromaticAberration || {}), ...(mergedOptions.chromaticAberration || {}) },
        grain: { ...(p.grain || {}), ...(mergedOptions.grain || {}) },
      };
    }
    rendererRef.current.updateOptions(mergedOptions);
  }, [options, preset]);

  if (!isSupported) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
        width: "100vw",
        height: "100vh",
      }}
    />
  );
};

