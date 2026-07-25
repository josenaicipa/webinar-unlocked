/**
 * Pure math and quality helpers for the `/3d/` Unlocked Protocol Core.
 * No DOM, no WebGL, no timers, no side effects: fully unit testable.
 */

/** Hard device pixel ratio cap: dense phone displays never get a 3x buffer. */
export const MAX_PIXEL_RATIO = 2;

/** Ordered quality tiers, weakest first. */
export const QUALITY_TIERS = Object.freeze(['off', 'low', 'medium', 'high']);

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clamp01(value) {
  return clamp(value, 0, 1);
}

/**
 * @param {unknown} raw
 * @param {number} [cap]
 * @returns {number}
 */
export function clampPixelRatio(raw, cap = MAX_PIXEL_RATIO) {
  const safeCap = Number.isFinite(cap) && Number(cap) > 0 ? Number(cap) : MAX_PIXEL_RATIO;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(n, safeCap);
}

/**
 * @typedef {Object} SceneEnvironment
 * @property {boolean} [webglSupported]
 * @property {boolean} [reducedMotion]
 * @property {boolean} [saveData]
 * @property {number} [viewportWidth]
 * @property {number} [pixelRatio]
 * @property {number} [cores]
 * @property {number} [deviceMemory]
 */

/**
 * @param {SceneEnvironment} [env]
 * @returns {'off'|'low'|'medium'|'high'}
 */
export function selectQualityTier(env = {}) {
  const {
    webglSupported = true,
    reducedMotion = false,
    saveData = false,
    viewportWidth = 1280,
    pixelRatio = 1,
    cores = 8,
    deviceMemory = 8,
  } = env ?? {};

  if (!webglSupported) return 'off';
  if (reducedMotion) return 'off';
  if (saveData) return 'low';

  const width = Number(viewportWidth) || 0;
  const cpu = Number(cores) || 0;
  const memory = Number(deviceMemory) || 0;

  if (cpu > 0 && cpu <= 2) return 'low';
  if (memory > 0 && memory <= 2) return 'low';
  if (width > 0 && width < 700) return 'low';
  if (width < 1200) return 'medium';
  if (clampPixelRatio(pixelRatio) > 1.75) return 'medium';
  return 'high';
}

const TIER_PROFILES = Object.freeze({
  off: Object.freeze({
    particles: 0,
    ringSegments: 0,
    renderScale: 0,
    targetFps: 0,
    animated: false,
  }),
  low: Object.freeze({
    particles: 900,
    ringSegments: 48,
    renderScale: 0.7,
    targetFps: 30,
    animated: true,
  }),
  medium: Object.freeze({
    particles: 2600,
    ringSegments: 72,
    renderScale: 0.85,
    targetFps: 48,
    animated: true,
  }),
  high: Object.freeze({
    particles: 4200,
    ringSegments: 96,
    renderScale: 1,
    targetFps: 60,
    animated: true,
  }),
});

/**
 * @param {unknown} tier
 * @returns {{ particles: number, ringSegments: number, renderScale: number, targetFps: number, animated: boolean }}
 */
export function tierProfile(tier) {
  const key = typeof tier === 'string' ? tier : 'off';
  return TIER_PROFILES[key] ?? TIER_PROFILES.off;
}

/**
 * Resolve the backing store size for a canvas under DPR and tier caps.
 * @param {unknown} cssWidth
 * @param {unknown} cssHeight
 * @param {unknown} pixelRatio
 * @param {unknown} tier
 * @returns {{ width: number, height: number }}
 */
export function drawingBufferSize(cssWidth, cssHeight, pixelRatio, tier) {
  const profile = tierProfile(tier);
  const scale = profile.renderScale > 0 ? profile.renderScale : 1;
  const dpr = clampPixelRatio(pixelRatio);
  const w = Math.max(0, Number(cssWidth) || 0) * dpr * scale;
  const h = Math.max(0, Number(cssHeight) || 0) * dpr * scale;
  return {
    width: Math.max(1, Math.floor(w)),
    height: Math.max(1, Math.floor(h)),
  };
}

/**
 * Frame rate independent exponential damping.
 * @param {unknown} current
 * @param {unknown} target
 * @param {unknown} lambda
 * @param {unknown} dt seconds
 * @returns {number}
 */
export function damp(current, target, lambda, dt) {
  const c = Number(current);
  const t = Number(target);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return 0;
  const l = Math.max(0, Number(lambda) || 0);
  const d = Math.max(0, Number(dt) || 0);
  return t + (c - t) * Math.exp(-l * d);
}

/**
 * Map a pointer position to bounded orbital yaw/pitch. Pitch is inverted so the
 * core leans toward the pointer instead of away from it.
 * @param {unknown} clientX
 * @param {unknown} clientY
 * @param {unknown} width
 * @param {unknown} height
 * @param {number} [maxYaw]
 * @param {number} [maxPitch]
 * @returns {{ yaw: number, pitch: number, nx: number, ny: number }}
 */
export function pointerToOrbit(clientX, clientY, width, height, maxYaw = 0.5, maxPitch = 0.3) {
  const w = Number(width) > 0 ? Number(width) : 1;
  const h = Number(height) > 0 ? Number(height) : 1;
  const nx = clamp((Number(clientX) || 0) / w, 0, 1) * 2 - 1;
  const ny = clamp((Number(clientY) || 0) / h, 0, 1) * 2 - 1;
  return {
    nx,
    ny,
    yaw: nx * maxYaw,
    pitch: ny === 0 ? 0 : -ny * maxPitch,
  };
}

/**
 * @param {unknown} scrollY
 * @param {unknown} viewportHeight
 * @param {unknown} documentHeight
 * @returns {number} 0..1
 */
export function scrollDepth(scrollY, viewportHeight, documentHeight) {
  const y = Math.max(0, Number(scrollY) || 0);
  const vh = Math.max(0, Number(viewportHeight) || 0);
  const dh = Math.max(0, Number(documentHeight) || 0);
  const scrollable = dh - vh;
  if (scrollable <= 0) return 0;
  return clamp01(y / scrollable);
}

/**
 * @param {unknown} t
 * @returns {number}
 */
export function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/**
 * Visibility + tier aware frame gate.
 * @param {{ visible?: boolean, animated?: boolean, tier?: string, elapsedMs?: number }} [state]
 * @returns {boolean}
 */
export function shouldRenderFrame(state = {}) {
  const { visible = true, animated = true, tier = 'high', elapsedMs = 1000 } = state ?? {};
  const profile = tierProfile(tier);
  if (!profile.animated || profile.targetFps <= 0) return false;
  if (!visible || !animated) return false;
  const minFrameMs = 1000 / profile.targetFps;
  return (Number(elapsedMs) || 0) + 0.5 >= minFrameMs;
}

const GOLDEN_INCREMENT = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic, evenly spread unit-sphere direction (Fibonacci lattice).
 * @param {unknown} index
 * @param {unknown} count
 * @returns {{ x: number, y: number, z: number }}
 */
export function fibonacciSpherePoint(index, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const i = clamp(Math.floor(Number(index) || 0), 0, n - 1);
  const offset = 2 / n;
  const y = i * offset - 1 + offset / 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN_INCREMENT;
  return {
    x: Math.cos(phi) * radius,
    y,
    z: Math.sin(phi) * radius,
  };
}
