/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Audio Waveform Visualizer Component
 * Zero-lag HTML5 Canvas waveform visualization.
 */

import React, { useEffect, useRef } from "react";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";

export interface AudioWaveformVisualizerProps {
  isListening: boolean;
  className?: string;
  barColor?: string;
  barGlowColor?: string;
  barWidth?: number;
  barGap?: number;
}

export function AudioWaveformVisualizer({
  isListening,
  className = "w-full h-14",
  barColor = "#06b6d4",
  barGlowColor = "rgba(6, 182, 212, 0.4)",
  barWidth = 3,
  barGap = 3,
}: AudioWaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { startVisualizer, stopVisualizer } = useAudioVisualizer();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    }

    if (isListening) {
      startVisualizer(canvas, {
        barColor,
        barGlowColor,
        barWidth,
        barGap,
      });
    } else {
      stopVisualizer();
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    return () => {
      stopVisualizer();
    };
  }, [isListening, startVisualizer, stopVisualizer, barColor, barGlowColor, barWidth, barGap]);

  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-surface-2/60 backdrop-blur-md p-2 border border-border/50 ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: "100%", height: "100%" }}
      />
      {!isListening && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground select-none pointer-events-none">
          الميكروفون متوقف مؤقتاً
        </div>
      )}
    </div>
  );
}
