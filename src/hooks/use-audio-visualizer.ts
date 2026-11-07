/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Zero-Latency Audio Visualizer Hook
 * Driven purely by requestAnimationFrame & AnalyserNode on HTMLCanvasElement.
 * Does NOT cause React component re-renders.
 */

import { useRef, useCallback, useEffect } from "react";

export interface AudioVisualizerOptions {
  barColor?: string;
  barGlowColor?: string;
  barWidth?: number;
  barGap?: number;
}

export function useAudioVisualizer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isRunningRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    isRunningRef.current = false;

    if (animationFrameIdRef.current != null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }

    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== "closed") {
          audioContextRef.current.close();
        }
      } catch {}
      audioContextRef.current = null;
    }
  }, []);

  const startVisualizer = useCallback(
    async (
      canvas: HTMLCanvasElement,
      options: AudioVisualizerOptions = {},
    ): Promise<boolean> => {
      cleanup();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        mediaStreamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return false;

        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64; // 32 frequency bins, lightweight and responsive
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        sourceNodeRef.current = source;
        source.connect(analyser);

        const canvasCtx = canvas.getContext("2d");
        if (!canvasCtx) return false;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const barColor = options.barColor || "#06b6d4"; // Vibrant cyan
        const barGlowColor = options.barGlowColor || "rgba(6, 182, 212, 0.4)";
        const barWidth = options.barWidth || 4;
        const barGap = options.barGap || 3;

        isRunningRef.current = true;

        const renderFrame = () => {
          if (!isRunningRef.current) return;

          animationFrameIdRef.current = requestAnimationFrame(renderFrame);

          analyser.getByteFrequencyData(dataArray);

          // Use logical client bounding rect dimensions when context is scaled with DPR
          const rect = canvas.getBoundingClientRect();
          const logicalWidth = rect.width || canvas.width;
          const logicalHeight = rect.height || canvas.height;

          canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);

          // Calculate how many bars fit in the canvas
          const totalBarWidth = barWidth + barGap;
          const numBars = Math.min(
            bufferLength,
            Math.floor(logicalWidth / totalBarWidth),
          );
          const startX = Math.max(0, (logicalWidth - numBars * totalBarWidth) / 2);

          canvasCtx.save();
          canvasCtx.shadowBlur = 8;
          canvasCtx.shadowColor = barGlowColor;

          for (let i = 0; i < numBars; i++) {
            const rawVal = dataArray[i] || 0;
            // Normalize with minimum height so visualizer feels alive even in silence
            const percent = rawVal / 255;
            const barHeight = Math.max(4, percent * (logicalHeight - 8));

            const x = startX + i * totalBarWidth;
            const y = (logicalHeight - barHeight) / 2;

            // Rounded vertical bar
            canvasCtx.fillStyle = barColor;
            canvasCtx.beginPath();
            canvasCtx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
            canvasCtx.fill();
          }

          canvasCtx.restore();
        };

        renderFrame();
        return true;
      } catch (err) {
        cleanup();
        return false;
      }
    },
    [cleanup],
  );

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    startVisualizer,
    stopVisualizer: cleanup,
  };
}
