"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ORBIT_CONFIG, ORBIT_DESTINATIONS } from "@/features/booking-request/constants";

const TWO = Math.PI * 2;
const H0 = -1.075;
const PHI0 = -0.352;
const TRACK_SEGMENTS = 120;
const COVERED_WINDOW = TWO * 0.34;
const TRAIL_LENGTH = 0.5;
const N = ORBIT_DESTINATIONS.length;
const SP = TWO / N;

interface Point {
  x: number;
  y: number;
  d: number;
}

interface Geometry {
  cx: number;
  cy: number;
  A: number;
  B: number;
  width: number;
  height: number;
  dpr: number;
  trackAngles: number[];
}

interface ThemeColors {
  blue: string;
  orange: string;
  mutedGray: string;
  white: string;
}

function useReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function readThemeColors(): ThemeColors {
  const root = getComputedStyle(document.documentElement);
  const blue = root.getPropertyValue("--kmr-blue").trim() || "#1631db";
  const orange = root.getPropertyValue("--kmr-orange").trim() || "#f4491d";
  return {
    blue,
    orange,
    mutedGray: "#6e7180",
    white: "#ffffff",
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  const value = parseInt(full, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGeometry(width: number, height: number): Geometry | null {
  if (width <= 0 || height <= 0) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, ORBIT_CONFIG.maxDpr);
  const cx = width / 2;
  const cy = 38;
  const A = width * 0.58;
  const B = 25;
  const trackAngles = Array.from({ length: TRACK_SEGMENTS + 1 }, (_, index) => H0 + (index / TRACK_SEGMENTS) * TWO);

  return { cx, cy, A, B, width, height, dpr, trackAngles };
}

function posAt(geom: Geometry, theta: number): Point {
  return {
    x: geom.cx + geom.A * Math.sin(theta),
    y: geom.cy + geom.B * Math.cos(theta),
    d: Math.cos(theta),
  };
}

function computeHeadState(elapsed: number) {
  const { revolutionMs, introFormMs, introSettleMs } = ORBIT_CONFIG;
  const omega = TWO / revolutionMs;
  const introTotal = introFormMs + introSettleMs;

  let base = 0;
  let headOffset = 0;

  if (elapsed < introFormMs) {
    const progress = elapsed / introFormMs;
    const eased = 1 - Math.pow(1 - progress, 3);
    headOffset = H0 + (PHI0 - H0) * eased;
  } else if (elapsed < introTotal) {
    const progress = (elapsed - introFormMs) / introSettleMs;
    const eased = progress * progress * (3 - 2 * progress);
    headOffset = PHI0 * (1 - eased);
  } else {
    base = omega * (elapsed - introTotal);
  }

  const headAngle = headOffset + base;
  const forming = headAngle < H0 + TWO;
  const zoomProgress = Math.min(1, elapsed / introTotal);
  const zoomEased = zoomProgress * zoomProgress * (3 - 2 * zoomProgress);
  const zoom = 0.86 + 0.14 * zoomEased;

  return { headAngle, headOffset, base, forming, zoom, omega };
}

function resizeCanvas(canvas: HTMLCanvasElement, geom: Geometry) {
  const pixelWidth = Math.round(geom.width * geom.dpr);
  const pixelHeight = Math.round(geom.height * geom.dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
}

function drawOrbitFrame(
  ctx: CanvasRenderingContext2D,
  geom: Geometry,
  colors: ThemeColors,
  elapsed: number,
) {
  const { headAngle, headOffset, base, forming, zoom, omega } = computeHeadState(elapsed);
  const { width, height, dpr, cx, cy, trackAngles } = geom;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  ctx.lineWidth = 1.5;

  for (let segment = 0; segment < TRACK_SEGMENTS; segment++) {
    const angle1 = trackAngles[segment];
    const angle2 = trackAngles[segment + 1];
    if (forming && (angle1 + angle2) / 2 > headAngle) continue;

    const p1 = posAt(geom, angle1 - base);
    const p2 = posAt(geom, angle2 - base);
    const depth = (p1.d + p2.d) / 2;
    const alpha = depth > 0 ? 0.1 + 0.15 * depth : 0.05;

    ctx.strokeStyle = rgba(colors.blue, alpha);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const labelCandidates: { index: number; depth: number; fade: number }[] = [];

  for (let index = 0; index < N; index++) {
    const fixedAngle = PHI0 + index * SP;
    const coveredAmount = headAngle - fixedAngle;
    if (coveredAmount < 0) continue;

    const theta = fixedAngle - base;
    const point = posAt(geom, theta);
    const relative = coveredAmount % TWO;
    const isCovered = relative < COVERED_WINDOW;
    const age = relative / omega;
    const depth = Math.max(0, point.d);
    const alpha = point.d > 0 ? 0.25 + 0.75 * depth : 0.14;
    const pop = isCovered ? 1 + 0.5 * Math.exp(-age / 450) : 1;
    const radius = (2.6 + 2.6 * depth) * pop;
    const edge = Math.min(1, Math.abs(point.x - cx) / geom.A);
    const fade =
      edge > 0.72 ? Math.max(0.25, 1 - (edge - 0.72) * 2.5) : point.d < 0 ? 0.6 : 1;

    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, TWO);

    if (isCovered) {
      ctx.fillStyle = rgba(colors.blue, alpha);
      ctx.fill();
      if (age < 900) {
        const ringProgress = age / 900;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 7 * ringProgress, 0, TWO);
        ctx.strokeStyle = rgba(colors.orange, 0.65 * (1 - ringProgress));
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = colors.white;
      ctx.fill();
      ctx.strokeStyle = rgba(colors.blue, alpha * 0.8);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (point.d > 0.35 && fade > 0.5) {
      labelCandidates.push({ index, depth: point.d, fade });
    }

    ctx.globalAlpha = 1;
  }

  labelCandidates
    .sort((a, b) => b.depth - a.depth)
    .slice(0, ORBIT_CONFIG.maxVisibleLabels)
    .forEach(({ index }) => {
      const fixedAngle = PHI0 + index * SP;
      const coveredAmount = headAngle - fixedAngle;
      if (coveredAmount < 0) return;

      const theta = fixedAngle - base;
      const point = posAt(geom, theta);
      const relative = coveredAmount % TWO;
      const isCovered = relative < COVERED_WINDOW;
      const depth = Math.max(0, point.d);
      const alpha = point.d > 0 ? 0.25 + 0.75 * depth : 0.14;
      const pop = isCovered ? 1 + 0.5 * Math.exp(-(relative / omega) / 450) : 1;
      const radius = (2.6 + 2.6 * depth) * pop;

      ctx.font = "600 8.5px var(--font-ibm-plex-mono), monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = isCovered
        ? rgba(colors.blue, alpha)
        : rgba(colors.mutedGray, alpha * 0.9);
      ctx.fillText(ORBIT_DESTINATIONS[index], point.x, point.y + radius + 15);
    });

  let trailPrev = posAt(geom, headOffset);
  for (let step = 1; step <= 14; step++) {
    const trailAngle = headAngle - (TRAIL_LENGTH * step) / 14;
    if (trailAngle < H0) break;

    const trailPoint = posAt(geom, trailAngle - base);
    ctx.strokeStyle = rgba(colors.orange, 0.75 * (1 - step / 14));
    ctx.lineWidth = 3 - 2 * (step / 14);
    ctx.beginPath();
    ctx.moveTo(trailPrev.x, trailPrev.y);
    ctx.lineTo(trailPoint.x, trailPoint.y);
    ctx.stroke();
    trailPrev = trailPoint;
  }

  const headPoint = posAt(geom, headOffset);
  const glow = ctx.createRadialGradient(headPoint.x, headPoint.y, 0, headPoint.x, headPoint.y, 10);
  glow.addColorStop(0, rgba(colors.orange, 0.55));
  glow.addColorStop(1, rgba(colors.orange, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(headPoint.x, headPoint.y, 10, 0, TWO);
  ctx.fill();
  ctx.fillStyle = colors.orange;
  ctx.beginPath();
  ctx.arc(headPoint.x, headPoint.y, 3.2, 0, TWO);
  ctx.fill();
}

function drawStaticFrame(
  ctx: CanvasRenderingContext2D,
  geom: Geometry,
  colors: ThemeColors,
) {
  const elapsed = ORBIT_CONFIG.introFormMs + ORBIT_CONFIG.introSettleMs + 1;
  drawOrbitFrame(ctx, geom, colors, elapsed);
}

export function RouteOrbitCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let canvas = host.querySelector("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.className = "block size-full";
      host.appendChild(canvas);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = readThemeColors();
    let geometry: Geometry | null = null;
    let rafId = 0;
    let lastDrawTime = 0;
    let startTime = 0;
    let isIntersecting = true;
    let isDocumentVisible = document.visibilityState === "visible";

    const shouldAnimate = () => isIntersecting && isDocumentVisible && !reducedMotion;

    const rebuildGeometry = () => {
      geometry = buildGeometry(host.clientWidth, host.clientHeight);
      if (!geometry) return;
      resizeCanvas(canvas, geometry);
      if (!shouldAnimate()) {
        drawStaticFrame(ctx, geometry, colors);
      }
    };

    const drawFrame = (now: number) => {
      if (!shouldAnimate()) return;

      if (!startTime) startTime = now - ORBIT_CONFIG.introDelayMs;
      const elapsed = now - startTime;

      if (now - lastDrawTime < ORBIT_CONFIG.throttleMs) return;
      lastDrawTime = now;

      if (!geometry) rebuildGeometry();
      if (!geometry) return;

      drawOrbitFrame(ctx, geometry, colors, elapsed);
    };

    const loop = (now: number) => {
      drawFrame(now);
      rafId = requestAnimationFrame(loop);
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry?.isIntersecting ?? true;
        if (!shouldAnimate() && geometry) {
          drawStaticFrame(ctx, geometry, colors);
        }
      },
      { threshold: 0.1 },
    );

    const resizeObserver = new ResizeObserver(() => {
      rebuildGeometry();
    });

    const handleVisibilityChange = () => {
      isDocumentVisible = document.visibilityState === "visible";
      if (!shouldAnimate() && geometry) {
        drawStaticFrame(ctx, geometry, colors);
      }
    };

    intersectionObserver.observe(host);
    resizeObserver.observe(host);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    rebuildGeometry();

    if (reducedMotion) {
      if (geometry) drawStaticFrame(ctx, geometry, colors);
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(rafId);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reducedMotion]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      role="img"
      aria-label="Animated map of Kashmir destinations"
    />
  );
}
