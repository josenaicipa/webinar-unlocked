import {
  TARGET_INSTANT_ISO,
  getCountdownParts,
} from '../lib/countdown.js';
import {
  createRegistrationClient,
  DEFAULT_REGISTRATION_CONFIG,
} from '../lib/registration.js';
import { buildLazyPlayerDescriptors } from '../lib/testimonials.js';
import {
  runInitializersSafely,
  shouldLoadTestimonials,
} from '../lib/ui.js';
import { createProtocolCore } from './scene.js';

const root = document.documentElement;
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const REGISTRATION_CONFIG = {
  ...DEFAULT_REGISTRATION_CONFIG,
  mode: 'pending',
  endpoint: '',
  whatsappUrl: '',
  thankYouPath: '/gracias/',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function initScene() {
  const canvas = document.querySelector('[data-scene-canvas]');
  const fallback = document.querySelector('[data-scene-fallback]');
  const status = document.querySelector('[data-scene-status]');

  if (!(canvas instanceof HTMLCanvasElement)) {
    root.dataset.sceneMode = 'fallback';
    if (fallback) fallback.hidden = false;
    if (status) status.textContent = 'Núcleo en modo estático';
    return;
  }

  const scene = createProtocolCore(canvas, {
    reducedMotion,
    onStatus(mode) {
      root.dataset.sceneMode = mode;
      if (fallback) fallback.hidden = mode === 'webgl';
      if (status) {
        status.textContent = mode === 'webgl'
          ? 'Núcleo tridimensional activo'
          : 'Núcleo en modo estático';
      }
    },
  });

  root.dataset.sceneTier = scene.tier;
  root.dataset.sceneMode = scene.mode;
  scene.start();

  function handleScenePageHide(event) {
    if (event.persisted) {
      scene.stop();
    } else {
      scene.destroy();
    }
  }

  function handleScenePageShow(event) {
    if (event.persisted) scene.start();
  }

  window.addEventListener('pagehide', handleScenePageHide);
  window.addEventListener('pageshow', handleScenePageShow);
}

function initCountdown() {
  const countdown = document.querySelector('[data-countdown]');
  const expired = document.querySelector('[data-countdown-expired]');
  if (!countdown || !expired) return;

  const fields = {
    days: countdown.querySelector('[data-unit="days"]'),
    hours: countdown.querySelector('[data-unit="hours"]'),
    minutes: countdown.querySelector('[data-unit="minutes"]'),
    seconds: countdown.querySelector('[data-unit="seconds"]'),
  };

  function update() {
    const parts = getCountdownParts(new Date(), TARGET_INSTANT_ISO);
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      if (fields[unit]) fields[unit].textContent = pad2(parts[unit]);
    }
    if (parts.expired) {
      countdown.hidden = true;
      expired.hidden = false;
      return false;
    }
    return true;
  }

  let interval = null;

  function stopTimer() {
    if (interval === null) return;
    window.clearInterval(interval);
    interval = null;
  }

  function startTimer() {
    stopTimer();
    if (!update()) return;
    interval = window.setInterval(() => {
      if (!update()) stopTimer();
    }, 1000);
  }

  startTimer();
  window.addEventListener('pagehide', stopTimer);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) startTimer();
  });
}

function initReveal() {
  const items = Array.from(document.querySelectorAll('[data-reveal]'));
  if (items.length === 0) return;

  if (reducedMotion || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  items.forEach((item) => observer.observe(item));
}

function initSpatialTilt() {
  if (reducedMotion || !window.matchMedia('(pointer: fine)').matches) return;

  document.querySelectorAll('[data-node]').forEach((node) => {
    node.addEventListener('pointermove', (event) => {
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
      const y = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
      node.style.setProperty('--tilt-y', `${(x * 7).toFixed(2)}deg`);
      node.style.setProperty('--tilt-x', `${(-y * 6).toFixed(2)}deg`);
    });
    node.addEventListener('pointerleave', () => {
      node.style.setProperty('--tilt-y', '0deg');
      node.style.setProperty('--tilt-x', '0deg');
    });
  });
}

function initTestimonials() {
  const grid = document.getElementById('proof-grid-3d');
  if (!grid) return;

  const descriptors = buildLazyPlayerDescriptors();
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  descriptors.forEach((descriptor, index) => {
    const card = document.createElement('article');
    card.className = 'proof-card';
    card.dataset.playerId = descriptor.id;
    card.dataset.sequence = String(index + 1).padStart(2, '0');

    const placeholder = document.createElement('div');
    placeholder.className = 'proof-card__placeholder';
    placeholder.textContent = 'Canal de prueba en espera';

    const player = document.createElement('vturb-smartplayer');
    player.id = descriptor.elementId;
    player.setAttribute('data-vturb-player', descriptor.id);
    player.style.display = 'none';

    card.append(placeholder, player);
    grid.appendChild(card);
  });

  function cardIsNearViewport(card) {
    const rect = card.getBoundingClientRect();
    return rect.top <= window.innerHeight + 420 && rect.bottom >= -420;
  }

  function load(card) {
    if (card.dataset.loaded === '1') return true;
    const descriptor = descriptorById.get(card.dataset.playerId || '');
    if (!descriptor) return false;

    card.dataset.loaded = '1';
    const placeholder = card.querySelector('.proof-card__placeholder');
    const player = card.querySelector('vturb-smartplayer');
    const script = document.createElement('script');
    script.src = descriptor.scriptUrl;
    script.async = true;
    script.dataset.vturbLoader = descriptor.id;

    script.addEventListener('load', () => {
      placeholder?.remove();
      if (player) player.style.display = 'block';
    }, { once: true });

    script.addEventListener('error', () => {
      if (placeholder) {
        placeholder.textContent = 'Transmisión no disponible por el momento';
        placeholder.classList.add('is-unavailable');
      }
    }, { once: true });

    document.body.appendChild(script);
    return true;
  }

  function consider(card, intersecting = false) {
    if (!shouldLoadTestimonials(intersecting, cardIsNearViewport(card))) return false;
    return load(card);
  }

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (consider(entry.target, entry.isIntersecting)) observer?.unobserve(entry.target);
      }
    }, { rootMargin: '420px 0px', threshold: 0 });
    grid.querySelectorAll('.proof-card').forEach((card) => observer.observe(card));
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    grid.querySelectorAll('.proof-card').forEach((card) => {
      if (consider(card)) observer?.unobserve(card);
    });
  }

  function requestScan() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(scan);
  }

  requestScan();
  window.addEventListener('scroll', requestScan, { passive: true });
  window.addEventListener('resize', requestScan, { passive: true });
}

function initRegistration() {
  const form = document.querySelector('[data-registration]');
  const message = document.querySelector('[data-registration-message]');
  if (!(form instanceof HTMLFormElement) || !message) return;

  const client = createRegistrationClient(REGISTRATION_CONFIG);
  const filledAt = Date.now();

  function clearErrors() {
    form.querySelectorAll('.field').forEach((field) => field.classList.remove('is-invalid'));
    form.querySelectorAll('[data-error-for]').forEach((element) => {
      element.textContent = '';
    });
    message.textContent = '';
    message.classList.remove('is-error');
  }

  function showErrors(errors = {}) {
    clearErrors();
    let first = null;
    for (const [key, text] of Object.entries(errors)) {
      if (key === 'timing' || key === 'honeypot') {
        message.textContent = text;
        message.classList.add('is-error');
        continue;
      }
      const error = form.querySelector(`[data-error-for="${key}"]`);
      const input = form.elements.namedItem(key);
      if (error) error.textContent = text;
      if (input instanceof HTMLElement) {
        input.closest('.field')?.classList.add('is-invalid');
        if (!first) first = input;
      }
    }
    first?.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const data = new FormData(form);
    const consent = form.elements.namedItem('consent');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;

    try {
      const result = await client.submit({
        fullName: String(data.get('fullName') || ''),
        email: String(data.get('email') || ''),
        whatsapp: String(data.get('whatsapp') || ''),
        consent: consent instanceof HTMLInputElement && consent.checked,
        honeypot: String(data.get('company_website') || ''),
        filledAt,
        submittedAt: Date.now(),
      });

      if (result.status === 'validation_error') {
        showErrors(result.errors);
      } else {
        message.textContent = result.message;
        message.classList.toggle('is-error', result.status === 'error');
      }
    } catch {
      clearErrors();
      message.textContent = 'No se pudo procesar tu registro. Inténtalo de nuevo.';
      message.classList.add('is-error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function reportBootError(name) {
  root.dataset.boot = 'degraded';
  root.dataset.bootError = name;
}

runInitializersSafely([
  ['scene', initScene],
  ['countdown', initCountdown],
  ['reveal', initReveal],
  ['tilt', initSpatialTilt],
  ['testimonials', initTestimonials],
  ['registration', initRegistration],
], reportBootError);

if (root.dataset.boot !== 'degraded') root.dataset.boot = 'ready';
