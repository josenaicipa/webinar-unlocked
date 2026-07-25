/**
 * Unlocked Protocol Core: custom WebGL scene for the isolated `/3d/` route.
 * Two authored programs (additive particle shells + wire lattice), a small
 * local mat4 kernel, DPR/quality caps, visibility pause and a hard fail path
 * that hands control back to the deterministic CSS fallback.
 */
import {
  clampPixelRatio,
  damp,
  drawingBufferSize,
  easeOutCubic,
  fibonacciSpherePoint,
  pointerToOrbit,
  scrollDepth,
  selectQualityTier,
  shouldRenderFrame,
  tierProfile,
} from './scene-math.js';

/* -------------------------------------------------------------------------- */
/* Minimal mat4 kernel                                                        */
/* -------------------------------------------------------------------------- */

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = identity();
  m[0] = f / (aspect || 1);
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  m[15] = 0;
  return m;
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function rotationY(angle) {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

function rotationX(angle) {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/* -------------------------------------------------------------------------- */
/* Shaders                                                                     */
/* -------------------------------------------------------------------------- */

const PARTICLE_VERT = `
attribute vec3 aDirection;
attribute vec3 aSeed;
uniform mat4 uProjection;
uniform mat4 uView;
uniform float uTime;
uniform float uDepth;
uniform float uIntro;
uniform float uCharge;
uniform float uPixelScale;
varying float vRole;
varying float vGlow;
void main() {
  float shell = aSeed.x;
  float phase = aSeed.y;
  float spin = uTime * (0.07 + shell * 0.19) + phase * 6.2831853;
  float cs = cos(spin);
  float sn = sin(spin);
  vec3 p = vec3(
    aDirection.x * cs - aDirection.z * sn,
    aDirection.y,
    aDirection.x * sn + aDirection.z * cs
  );
  float pulse = 1.0 + 0.07 * sin(uTime * 1.6 + phase * 12.566) * uCharge;
  float radius = mix(0.62, 1.72, shell) * pulse * mix(0.28, 1.0, uIntro);
  p *= radius;
  p.y += 0.14 * sin(uTime * 0.65 + phase * 9.42) * shell;
  p.z -= uDepth * 1.55;
  vec4 viewPos = uView * vec4(p, 1.0);
  gl_Position = uProjection * viewPos;
  float dist = max(0.35, -viewPos.z);
  gl_PointSize = clamp((uPixelScale * (0.85 + shell * 1.7)) / dist, 1.0, 24.0);
  vRole = aSeed.z;
  vGlow = clamp(1.55 - dist * 0.19, 0.05, 1.0) * uIntro;
}
`;

const PARTICLE_FRAG = `
precision mediump float;
uniform vec3 uEmber;
uniform vec3 uMagenta;
uniform vec3 uViolet;
uniform vec3 uIon;
varying float vRole;
varying float vGlow;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float falloff = pow(1.0 - d, 2.4);
  vec3 tint = mix(uEmber, uMagenta, smoothstep(0.0, 0.52, vRole));
  tint = mix(tint, uViolet, smoothstep(0.48, 0.93, vRole));
  tint = mix(tint, uIon, smoothstep(0.955, 1.0, vRole));
  float a = falloff * vGlow;
  gl_FragColor = vec4(tint * a, a);
}
`;

const LATTICE_VERT = `
attribute vec3 aPosition;
attribute float aRole;
uniform mat4 uProjection;
uniform mat4 uView;
uniform float uTime;
uniform float uDepth;
uniform float uIntro;
uniform float uCharge;
varying float vRole;
varying float vFade;
void main() {
  float spin = uTime * 0.21;
  float cs = cos(spin);
  float sn = sin(spin);
  vec3 p = vec3(
    aPosition.x * cs - aPosition.z * sn,
    aPosition.y,
    aPosition.x * sn + aPosition.z * cs
  );
  float breathe = 1.0 + 0.05 * sin(uTime * 1.1 + aRole * 6.2831853) * uCharge;
  p *= breathe * mix(0.18, 1.0, uIntro);
  p.z -= uDepth * 1.55;
  vec4 viewPos = uView * vec4(p, 1.0);
  gl_Position = uProjection * viewPos;
  vRole = aRole;
  vFade = clamp(1.35 + viewPos.z * 0.2, 0.0, 1.0) * uIntro * (0.5 + 0.5 * uCharge);
}
`;

const LATTICE_FRAG = `
precision mediump float;
uniform vec3 uEmber;
uniform vec3 uMagenta;
uniform vec3 uViolet;
uniform vec3 uIon;
varying float vRole;
varying float vFade;
void main() {
  vec3 tint = mix(uEmber, uMagenta, smoothstep(0.0, 0.5, vRole));
  tint = mix(tint, uViolet, smoothstep(0.45, 0.9, vRole));
  tint = mix(tint, uIon, smoothstep(0.96, 1.0, vRole));
  gl_FragColor = vec4(tint * vFade, vFade * 0.85);
}
`;

/* -------------------------------------------------------------------------- */
/* GL plumbing                                                                */
/* -------------------------------------------------------------------------- */

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('shader alloc failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl, vertSource, fragSource) {
  const program = gl.createProgram();
  if (!program) throw new Error('program alloc failed');
  const vert = compile(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSource);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'unknown';
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

function buffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo random: identical geometry on every load. */
function seeded(index) {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildParticles(count) {
  const directions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const p = fibonacciSpherePoint(i, count);
    directions[i * 3] = p.x;
    directions[i * 3 + 1] = p.y;
    directions[i * 3 + 2] = p.z;
    const shell = seeded(i + 1);
    seeds[i * 3] = shell * shell;
    seeds[i * 3 + 1] = seeded(i + 977);
    seeds[i * 3 + 2] = seeded(i + 401);
  }
  return { directions, seeds, count };
}

/** Three orbital rings plus a meridian cage: the machine silhouette. */
function buildLattice(segments) {
  const positions = [];
  const roles = [];
  const ringSpecs = [
    { radius: 1.0, tilt: 0, role: 0.06 },
    { radius: 1.24, tilt: 1.05, role: 0.55 },
    { radius: 0.78, tilt: -0.72, role: 0.98 },
  ];

  for (const ring of ringSpecs) {
    const cosT = Math.cos(ring.tilt);
    const sinT = Math.sin(ring.tilt);
    for (let i = 0; i < segments; i += 1) {
      for (const step of [i, (i + 1) % segments]) {
        const a = (step / segments) * Math.PI * 2;
        const x = Math.cos(a) * ring.radius;
        const z = Math.sin(a) * ring.radius;
        positions.push(x, z * sinT, z * cosT);
        roles.push(ring.role);
      }
    }
  }

  const meridians = 8;
  const arcSteps = Math.max(8, Math.floor(segments / 3));
  for (let m = 0; m < meridians; m += 1) {
    const lon = (m / meridians) * Math.PI * 2;
    for (let s = 0; s < arcSteps; s += 1) {
      for (const step of [s, s + 1]) {
        const lat = (step / arcSteps) * Math.PI - Math.PI / 2;
        const r = Math.cos(lat) * 0.52;
        positions.push(Math.cos(lon) * r, Math.sin(lat) * 0.52, Math.sin(lon) * r);
        roles.push(0.3 + (m / meridians) * 0.4);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    roles: new Float32Array(roles),
    vertexCount: roles.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  ember: [1.0, 0.302, 0.09],
  magenta: [1.0, 0.176, 0.584],
  violet: [0.478, 0.235, 1.0],
  ion: [0.784, 1.0, 0.239],
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion?: boolean, onStatus?: (status: string) => void }} [options]
 */
export function createProtocolCore(canvas, options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const view = canvas?.ownerDocument?.defaultView ?? null;
  if (!canvas || !view) {
    onStatus('fallback');
    return { start() {}, stop() {}, destroy() {}, tier: 'off', mode: 'fallback' };
  }

  const nav = view.navigator ?? {};
  const env = {
    webglSupported: true,
    reducedMotion: Boolean(options.reducedMotion),
    saveData: Boolean(nav.connection && nav.connection.saveData),
    viewportWidth: view.innerWidth || 1280,
    pixelRatio: view.devicePixelRatio || 1,
    cores: Number(nav.hardwareConcurrency) || 8,
    deviceMemory: Number(nav.deviceMemory) || 8,
  };

  let tier = selectQualityTier(env);
  if (tier === 'off') {
    onStatus('fallback');
    return { start() {}, stop() {}, destroy() {}, tier, mode: 'fallback' };
  }

  /** @type {WebGLRenderingContext|null} */
  let gl = null;
  try {
    gl =
      canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        premultipliedAlpha: true,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
      }) || canvas.getContext('experimental-webgl');
  } catch {
    gl = null;
  }

  if (!gl) {
    onStatus('fallback');
    return { start() {}, stop() {}, destroy() {}, tier: 'off', mode: 'fallback' };
  }

  let particleProgram;
  let latticeProgram;
  try {
    particleProgram = linkProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
    latticeProgram = linkProgram(gl, LATTICE_VERT, LATTICE_FRAG);
  } catch {
    onStatus('fallback');
    return { start() {}, stop() {}, destroy() {}, tier: 'off', mode: 'fallback' };
  }

  const profile = tierProfile(tier);
  const particles = buildParticles(profile.particles);
  const lattice = buildLattice(profile.ringSegments);

  const particleBuffers = {
    direction: buffer(gl, particles.directions),
    seed: buffer(gl, particles.seeds),
  };
  const latticeBuffers = {
    position: buffer(gl, lattice.positions),
    role: buffer(gl, lattice.roles),
  };

  const particleLoc = {
    aDirection: gl.getAttribLocation(particleProgram, 'aDirection'),
    aSeed: gl.getAttribLocation(particleProgram, 'aSeed'),
    uProjection: gl.getUniformLocation(particleProgram, 'uProjection'),
    uView: gl.getUniformLocation(particleProgram, 'uView'),
    uTime: gl.getUniformLocation(particleProgram, 'uTime'),
    uDepth: gl.getUniformLocation(particleProgram, 'uDepth'),
    uIntro: gl.getUniformLocation(particleProgram, 'uIntro'),
    uCharge: gl.getUniformLocation(particleProgram, 'uCharge'),
    uPixelScale: gl.getUniformLocation(particleProgram, 'uPixelScale'),
    uEmber: gl.getUniformLocation(particleProgram, 'uEmber'),
    uMagenta: gl.getUniformLocation(particleProgram, 'uMagenta'),
    uViolet: gl.getUniformLocation(particleProgram, 'uViolet'),
    uIon: gl.getUniformLocation(particleProgram, 'uIon'),
  };

  const latticeLoc = {
    aPosition: gl.getAttribLocation(latticeProgram, 'aPosition'),
    aRole: gl.getAttribLocation(latticeProgram, 'aRole'),
    uProjection: gl.getUniformLocation(latticeProgram, 'uProjection'),
    uView: gl.getUniformLocation(latticeProgram, 'uView'),
    uTime: gl.getUniformLocation(latticeProgram, 'uTime'),
    uDepth: gl.getUniformLocation(latticeProgram, 'uDepth'),
    uIntro: gl.getUniformLocation(latticeProgram, 'uIntro'),
    uCharge: gl.getUniformLocation(latticeProgram, 'uCharge'),
    uEmber: gl.getUniformLocation(latticeProgram, 'uEmber'),
    uMagenta: gl.getUniformLocation(latticeProgram, 'uMagenta'),
    uViolet: gl.getUniformLocation(latticeProgram, 'uViolet'),
    uIon: gl.getUniformLocation(latticeProgram, 'uIon'),
  };

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let contextLost = false;
  let destroyed = false;
  const state = {
    running: false,
    visible: true,
    rafId: 0,
    startedAt: 0,
    lastFrame: 0,
    lastDraw: 0,
    aspect: 1,
    pixelScale: 60,
    targetYaw: 0,
    targetPitch: 0,
    yaw: 0,
    pitch: 0,
    depth: 0,
    targetDepth: 0,
    charge: 0,
    targetCharge: 1,
    intro: 0,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.clientWidth || 1;
    const cssH = rect.height || canvas.clientHeight || 1;
    const size = drawingBufferSize(cssW, cssH, view.devicePixelRatio, tier);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    state.aspect = size.width / Math.max(1, size.height);
    state.pixelScale = 26 * clampPixelRatio(view.devicePixelRatio) * (cssW < 700 ? 0.8 : 1);
    gl.viewport(0, 0, size.width, size.height);
  }

  function bindAttrib(location, buf, components) {
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
  }

  function setPalette(loc) {
    gl.uniform3fv(loc.uEmber, PALETTE.ember);
    gl.uniform3fv(loc.uMagenta, PALETTE.magenta);
    gl.uniform3fv(loc.uViolet, PALETTE.violet);
    gl.uniform3fv(loc.uIon, PALETTE.ion);
  }

  function draw(elapsedSeconds) {
    const projection = perspective(Math.PI / 4.2, state.aspect, 0.1, 40);
    const dolly = -3.35 - state.depth * 1.1;
    const viewMatrix = multiply(
      translation(0, 0, dolly),
      multiply(rotationX(state.pitch), rotationY(state.yaw)),
    );

    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(latticeProgram);
    gl.uniformMatrix4fv(latticeLoc.uProjection, false, projection);
    gl.uniformMatrix4fv(latticeLoc.uView, false, viewMatrix);
    gl.uniform1f(latticeLoc.uTime, elapsedSeconds);
    gl.uniform1f(latticeLoc.uDepth, state.depth);
    gl.uniform1f(latticeLoc.uIntro, state.intro);
    gl.uniform1f(latticeLoc.uCharge, state.charge);
    setPalette(latticeLoc);
    bindAttrib(latticeLoc.aPosition, latticeBuffers.position, 3);
    bindAttrib(latticeLoc.aRole, latticeBuffers.role, 1);
    gl.drawArrays(gl.LINES, 0, lattice.vertexCount);

    gl.useProgram(particleProgram);
    gl.uniformMatrix4fv(particleLoc.uProjection, false, projection);
    gl.uniformMatrix4fv(particleLoc.uView, false, viewMatrix);
    gl.uniform1f(particleLoc.uTime, elapsedSeconds);
    gl.uniform1f(particleLoc.uDepth, state.depth);
    gl.uniform1f(particleLoc.uIntro, state.intro);
    gl.uniform1f(particleLoc.uCharge, state.charge);
    gl.uniform1f(particleLoc.uPixelScale, state.pixelScale);
    setPalette(particleLoc);
    bindAttrib(particleLoc.aDirection, particleBuffers.direction, 3);
    bindAttrib(particleLoc.aSeed, particleBuffers.seed, 3);
    gl.drawArrays(gl.POINTS, 0, particles.count);
  }

  function frame(now) {
    if (!state.running) return;
    state.rafId = view.requestAnimationFrame(frame);

    const elapsedMs = now - state.lastDraw;
    if (!shouldRenderFrame({ visible: state.visible, tier, elapsedMs })) return;

    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    state.lastDraw = now;

    const sinceStart = (now - state.startedAt) / 1000;
    state.intro = easeOutCubic(sinceStart / 1.6);
    state.yaw = damp(state.yaw, state.targetYaw, 3.4, dt);
    state.pitch = damp(state.pitch, state.targetPitch, 3.4, dt);
    state.depth = damp(state.depth, state.targetDepth, 2.6, dt);
    state.charge = damp(state.charge, state.targetCharge, 1.8, dt);

    draw(sinceStart);
  }

  function onPointerMove(event) {
    const orbit = pointerToOrbit(event.clientX, event.clientY, view.innerWidth, view.innerHeight);
    state.targetYaw = orbit.yaw;
    state.targetPitch = orbit.pitch;
  }

  function onPointerLeave() {
    state.targetYaw = 0;
    state.targetPitch = 0;
  }

  function onScroll() {
    const doc = canvas.ownerDocument.documentElement;
    state.targetDepth = scrollDepth(view.scrollY, view.innerHeight, doc.scrollHeight);
  }

  function onVisibility() {
    state.visible = canvas.ownerDocument.visibilityState !== 'hidden';
    if (state.visible) {
      state.lastFrame = view.performance.now();
      state.lastDraw = state.lastFrame;
    }
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stop();
    onStatus('fallback');
  }

  canvas.addEventListener('webglcontextlost', onContextLost);

  function start() {
    if (state.running) return;
    if (destroyed || contextLost || (typeof gl.isContextLost === 'function' && gl.isContextLost())) {
      if (!destroyed) contextLost = true;
      onStatus('fallback');
      return;
    }
    state.running = true;
    resize();
    onScroll();
    const now = view.performance.now();
    state.startedAt = now;
    state.lastFrame = now;
    state.lastDraw = 0;
    view.addEventListener('resize', resize, { passive: true });
    view.addEventListener('scroll', onScroll, { passive: true });
    view.addEventListener('pointermove', onPointerMove, { passive: true });
    view.addEventListener('pointerleave', onPointerLeave, { passive: true });
    canvas.ownerDocument.addEventListener('visibilitychange', onVisibility);
    state.rafId = view.requestAnimationFrame(frame);
    onStatus('webgl');
  }

  function stop() {
    if (!state.running) return;
    state.running = false;
    view.cancelAnimationFrame(state.rafId);
    view.removeEventListener('resize', resize);
    view.removeEventListener('scroll', onScroll);
    view.removeEventListener('pointermove', onPointerMove);
    view.removeEventListener('pointerleave', onPointerLeave);
    canvas.ownerDocument.removeEventListener('visibilitychange', onVisibility);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    gl.deleteBuffer(particleBuffers.direction);
    gl.deleteBuffer(particleBuffers.seed);
    gl.deleteBuffer(latticeBuffers.position);
    gl.deleteBuffer(latticeBuffers.role);
    gl.deleteProgram(particleProgram);
    gl.deleteProgram(latticeProgram);
  }

  return {
    start,
    stop,
    destroy,
    resize,
    get tier() {
      return tier;
    },
    mode: 'webgl',
  };
}
