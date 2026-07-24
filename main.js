import {
  TARGET_INSTANT_ISO,
  getCountdownParts,
  formatCountdownLabel,
} from './lib/countdown.js';
import {
  createRegistrationClient,
  DEFAULT_REGISTRATION_CONFIG,
  MIN_FILL_MS,
} from './lib/registration.js';
import { buildLazyPlayerDescriptors } from './lib/testimonials.js';
import {
  runInitializersSafely,
  shouldLoadTestimonials,
  shouldShowStickyCta,
} from './lib/ui.js';

/** @type {typeof DEFAULT_REGISTRATION_CONFIG} */
const REGISTRATION_CONFIG = {
  ...DEFAULT_REGISTRATION_CONFIG,
  // Fail-closed defaults: pending mode, empty endpoint/WhatsApp URL.
  mode: 'pending',
  endpoint: '',
  whatsappUrl: '',
  thankYouPath: '/gracias/',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/* -------------------------------------------------------------------------- */
/* Countdown                                                                  */
/* -------------------------------------------------------------------------- */

function initCountdown() {
  const root = document.getElementById('countdown');
  const expiredEl = document.getElementById('countdown-expired');
  const band = document.getElementById('cuenta-regresiva');
  if (!root || !expiredEl) return;

  const target =
    band?.getAttribute('data-target') || TARGET_INSTANT_ISO;

  const valueEls = {
    days: root.querySelector('[data-unit="days"]'),
    hours: root.querySelector('[data-unit="hours"]'),
    minutes: root.querySelector('[data-unit="minutes"]'),
    seconds: root.querySelector('[data-unit="seconds"]'),
  };

  for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
    const label = root.querySelector(
      `[data-unit="${unit}"]`,
    )?.parentElement?.querySelector('.countdown__label');
    if (label) label.textContent = formatCountdownLabel(/** @type {'days'} */ (unit));
  }

  function tick() {
    const parts = getCountdownParts(new Date(), target);
    if (parts.expired) {
      root.classList.add('is-expired');
      root.setAttribute('aria-hidden', 'true');
      expiredEl.hidden = false;
      return false;
    }
    if (valueEls.days) valueEls.days.textContent = pad2(parts.days);
    if (valueEls.hours) valueEls.hours.textContent = pad2(parts.hours);
    if (valueEls.minutes) valueEls.minutes.textContent = pad2(parts.minutes);
    if (valueEls.seconds) valueEls.seconds.textContent = pad2(parts.seconds);
    return true;
  }

  if (!tick()) return;

  const prefersReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const intervalMs = prefersReduced ? 1000 : 1000;
  const id = window.setInterval(() => {
    if (!tick()) window.clearInterval(id);
  }, intervalMs);
}

/* -------------------------------------------------------------------------- */
/* FAQ accordion                                                              */
/* -------------------------------------------------------------------------- */

function initAccordion() {
  const root = document.querySelector('[data-accordion]');
  if (!root) return;

  const triggers = /** @type {NodeListOf<HTMLButtonElement>} */ (
    root.querySelectorAll('.faq__trigger')
  );

  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const panelId = btn.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;

      // Close others for clear single-open accordion behavior
      triggers.forEach((other) => {
        if (other === btn) return;
        other.setAttribute('aria-expanded', 'false');
        const otherPanelId = other.getAttribute('aria-controls');
        const otherPanel = otherPanelId
          ? document.getElementById(otherPanelId)
          : null;
        if (otherPanel) otherPanel.hidden = true;
      });

      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (panel) panel.hidden = expanded;
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Lazy Vturb testimonials                                                    */
/* -------------------------------------------------------------------------- */

function initTestimonials() {
  const grid = document.getElementById('proof-grid');
  if (!grid) return;

  const descriptors = buildLazyPlayerDescriptors();
  /** @type {Map<string, HTMLScriptElement>} */
  const loadedScripts = new Map();

  for (const d of descriptors) {
    const card = document.createElement('div');
    card.className = 'proof-card';
    card.dataset.playerId = d.id;

    const placeholder = document.createElement('div');
    placeholder.className = 'proof-card__placeholder';
    placeholder.textContent = 'Cargando testimonio…';
    card.appendChild(placeholder);

    const player = document.createElement('vturb-smartplayer');
    player.id = d.elementId;
    player.setAttribute('data-vturb-player', d.id);
    player.style.display = 'none';
    card.appendChild(player);

    grid.appendChild(card);
  }

  function loadPlayer(card) {
    if (card.dataset.loaded === '1') return;
    const id = card.dataset.playerId;
    const descriptor = descriptors.find((d) => d.id === id);
    if (!descriptor) return;

    card.dataset.loaded = '1';
    const placeholder = card.querySelector('.proof-card__placeholder');
    const player = card.querySelector('vturb-smartplayer');
    const script = document.createElement('script');
    script.src = descriptor.scriptUrl;
    script.async = true;

    script.addEventListener('load', () => {
      placeholder?.remove();
      if (player) player.style.display = '';
    }, { once: true });

    script.addEventListener('error', () => {
      if (placeholder) {
        placeholder.textContent = 'Testimonio no disponible por el momento.';
        placeholder.classList.add('is-unavailable');
      }
    }, { once: true });

    if (!loadedScripts.has(descriptor.scriptUrl)) {
      loadedScripts.set(descriptor.scriptUrl, script);
      document.body.appendChild(script);
    }
  }

  function cardIsNearViewport(card) {
    const rect = card.getBoundingClientRect();
    return rect.top <= window.innerHeight + 360 && rect.bottom >= -360;
  }

  function considerCard(card, isIntersecting = false) {
    if (shouldLoadTestimonials(isIntersecting, cardIsNearViewport(card))) {
      loadPlayer(card);
      return true;
    }
    return false;
  }

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (considerCard(entry.target, entry.isIntersecting)) {
            observer?.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '360px 0px', threshold: 0 },
    );
    grid.querySelectorAll('.proof-card').forEach((card) => observer.observe(card));
  }

  let scanScheduled = false;
  function scanVisibleCards() {
    scanScheduled = false;
    grid.querySelectorAll('.proof-card').forEach((card) => {
      if (considerCard(card, false)) observer?.unobserve(card);
    });
  }

  function requestScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.setTimeout(scanVisibleCards, 16);
  }

  requestScan();
  window.addEventListener('scroll', requestScan, { passive: true });
  window.addEventListener('resize', requestScan, { passive: true });
}

/* -------------------------------------------------------------------------- */
/* Modal + registration form                                                  */
/* -------------------------------------------------------------------------- */

function initRegistrationModal() {
  const modal = document.getElementById('register-modal');
  const form = /** @type {HTMLFormElement | null} */ (
    document.getElementById('register-form')
  );
  if (!modal || !form || modal.dataset.registrationReady === '1') return;

  const openers = document.querySelectorAll('.js-open-register');
  const closers = modal.querySelectorAll('[data-close-modal]');
  const statusEl = document.getElementById('form-status');
  const submitBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('submit-btn')
  );

  let lastFocus = /** @type {HTMLElement | null} */ (null);
  let filledAt = Date.now();

  const client = createRegistrationClient(REGISTRATION_CONFIG, {
    transport: (url, options) => fetch(url, options),
    redirect: (path) => {
      window.location.assign(path);
    },
  });

  function getFocusable() {
    return /** @type {HTMLElement[]} */ (
      Array.from(
        modal.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null || el === form.querySelector('input'))
    );
  }

  function clearFieldErrors() {
    form.querySelectorAll('.field').forEach((field) => {
      field.classList.remove('is-invalid');
    });
    form.querySelectorAll('.field__error').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
  }

  function showFieldErrors(errors) {
    clearFieldErrors();
    const order = ['fullName', 'email', 'whatsapp', 'consent', 'honeypot', 'timing'];
    let first = /** @type {HTMLElement | null} */ (null);

    for (const key of order) {
      if (!errors[key]) continue;
      if (key === 'timing' || key === 'honeypot') {
        if (statusEl) {
          statusEl.textContent = errors[key];
          statusEl.classList.add('is-error');
          statusEl.classList.remove('is-pending');
        }
        continue;
      }
      const input = form.querySelector(`#${key}`);
      const err = document.getElementById(`error-${key}`);
      const field = input?.closest('.field');
      if (field) field.classList.add('is-invalid');
      if (err) {
        err.hidden = false;
        err.textContent = errors[key];
      }
      if (!first && input instanceof HTMLElement) first = input;
    }
    if (first) first.focus();
  }

  function openModal() {
    lastFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    filledAt = Date.now();
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-pending', 'is-error');
    }
    clearFieldErrors();
    const first = /** @type {HTMLElement | null} */ (
      form.querySelector('#fullName')
    );
    window.requestAnimationFrame(() => first?.focus());
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('is-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  openers.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  });

  closers.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = getFocusable().filter((el) => {
        if (el.closest('.field--honeypot')) return false;
        return true;
      });
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-pending', 'is-error');
    }
    clearFieldErrors();

    const fd = new FormData(form);
    const payload = {
      fullName: String(fd.get('fullName') ?? ''),
      email: String(fd.get('email') ?? ''),
      whatsapp: String(fd.get('whatsapp') ?? ''),
      consent: fd.get('consent') === '1' || form.querySelector('#consent')?.checked === true,
      honeypot: String(fd.get('company_website') ?? ''),
      filledAt,
      submittedAt: Date.now(),
    };

    if (submitBtn) submitBtn.disabled = true;

    try {
      const result = await client.submit(payload);

      if (result.status === 'validation_error') {
        showFieldErrors(result.errors ?? {});
        return;
      }

      if (result.status === 'pending') {
        // Must not clear fields; show honest message; no network was issued by client.
        if (result.retained) {
          form.fullName.value = result.retained.fullName;
          form.email.value = result.retained.email;
          form.whatsapp.value = result.retained.whatsapp;
          const consent = form.querySelector('#consent');
          if (consent instanceof HTMLInputElement) {
            consent.checked = result.retained.consent;
          }
        }
        if (statusEl) {
          statusEl.textContent = result.message;
          statusEl.classList.add('is-pending');
          statusEl.classList.remove('is-error');
        }
        statusEl?.focus?.();
        return;
      }

      if (result.status === 'error') {
        if (statusEl) {
          statusEl.textContent = result.message;
          statusEl.classList.add('is-error');
          statusEl.classList.remove('is-pending');
        }
        return;
      }

      // success handled via redirect seam
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  modal.dataset.registrationReady = '1';
}

/* -------------------------------------------------------------------------- */
/* Sticky mobile CTA                                                          */
/* -------------------------------------------------------------------------- */

function initStickyCta() {
  const sticky = document.getElementById('sticky-cta');
  const hero = document.getElementById('inicio');
  const header = document.querySelector('.site-header');
  if (!sticky || !hero) return;

  let scheduled = false;
  function update() {
    scheduled = false;
    const revealOffset = header?.getBoundingClientRect().height ?? 0;
    sticky.hidden = !shouldShowStickyCta(
      hero.getBoundingClientRect().bottom,
      revealOffset,
    );
  }

  function requestUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(update, 16);
  }

  update();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('pageshow', requestUpdate, { passive: true });
  window.setTimeout(requestUpdate, 120);
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

function initYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = String(new Date().getFullYear());
}

function initRegistrationSafely(attempt = 0) {
  try {
    initRegistrationModal();
  } catch (error) {
    console.error('No se pudo inicializar el formulario de registro.', error);
    if (attempt < 1) {
      window.setTimeout(() => initRegistrationSafely(attempt + 1), 120);
    }
  }
}

function boot() {
  runInitializersSafely(
    [
      ['year', initYear],
      ['countdown', initCountdown],
      ['accordion', initAccordion],
      ['sticky CTA', initStickyCta],
      ['registration', () => window.setTimeout(() => initRegistrationSafely(), 0)],
      ['testimonials', initTestimonials],
    ],
    (name, error) => {
      console.error(`No se pudo inicializar: ${name}.`, error);
    },
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Re-export for debugging / potential future tests in browser context
export {
  TARGET_INSTANT_ISO,
  MIN_FILL_MS,
  REGISTRATION_CONFIG,
};
