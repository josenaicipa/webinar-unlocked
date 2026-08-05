import {
  TARGET_INSTANT_ISO,
  getCountdownParts,
  formatCountdownLabel,
} from './lib/countdown.js';
import {
  createRegistrationClient,
  DEFAULT_REGISTRATION_CONFIG,
  MIN_FILL_MS,
  REGISTRATION_ENDPOINT,
  REGISTRATION_EVENT,
  REGISTRATION_SURFACE,
  findMissingRequiredFields,
  validateRegistration,
} from './lib/registration.js';
import {
  createAttributionTracker,
  buildAnalyticsEvent,
  sendAnalyticsEvent,
  sanitizePageContext,
  ANALYTICS_ENDPOINT,
} from './lib/attribution.js';
import {
  FIXED_WHATSAPP_GROUP_INVITE,
  FALLBACK_THANK_YOU_PATH,
  SUBMIT_PROCESSING_MESSAGE,
  SUBMIT_PROCESSING_BUTTON_LABEL,
} from './lib/post-registration.js';
import {
  createMetaPixelController,
  loadClarityDeferred,
  META_PIXEL_ID,
} from './lib/tracking.js';
import { buildLazyPlayerDescriptors } from './lib/testimonials.js';
import {
  runInitializersSafely,
  shouldLoadTestimonials,
  shouldShowStickyCta,
} from './lib/ui.js';

/** Route-level activation: webhook mode to the active n8n registration workflow. */
const REGISTRATION_CONFIG = {
  ...DEFAULT_REGISTRATION_CONFIG,
  mode: 'webhook',
  // Exact public registration sink (must stay literal for release verification).
  endpoint: 'https://n8n.unlockedacademy.co/webhook/webinar-registro-vsl',
  // Fallback confirmation page remains available; primary success dest is the fixed invite.
  thankYouPath: FALLBACK_THANK_YOU_PATH,
  eventName: REGISTRATION_EVENT,
  surface: REGISTRATION_SURFACE,
};

// Keep constant import live so analytics and registration share one source of truth.
if (REGISTRATION_CONFIG.endpoint !== REGISTRATION_ENDPOINT) {
  throw new Error('Registration endpoint constant mismatch');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function browserPageContext() {
  return sanitizePageContext({
    path: typeof location !== 'undefined' ? location.pathname + location.search : '/',
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    title: typeof document !== 'undefined' ? document.title : '',
  });
}

function readQueryParams() {
  try {
    return new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  } catch {
    return new URLSearchParams();
  }
}

function readCookie(name) {
  try {
    const parts = String(document.cookie || '').split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('=') || '');
    }
  } catch {
    // ignore
  }
  return '';
}

/* -------------------------------------------------------------------------- */
/* Attribution + first-party analytics                                        */
/* -------------------------------------------------------------------------- */

const attributionTracker = createAttributionTracker({
  localStorage: typeof localStorage !== 'undefined' ? localStorage : undefined,
  sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
});

function captureLandingAttribution() {
  /** @type {Record<string, string>} */
  const params = {};
  const qs = readQueryParams();
  qs.forEach((value, key) => {
    params[key] = value;
  });
  const fbc = readCookie('_fbc');
  const fbp = readCookie('_fbp');
  if (fbc) params.fbc = fbc;
  if (fbp) params.fbp = fbp;
  return attributionTracker.captureFromParams(params);
}

function trackFirstParty(eventName, extra) {
  try {
    const payload = buildAnalyticsEvent({
      eventName,
      attribution: attributionTracker.getSnapshot(),
      page: browserPageContext(),
      extra,
    });
    // Privacy boundary: analytics has its own sink. Registration identity is only
    // ever POSTed to REGISTRATION_ENDPOINT, never to the analytics host.
    // Navigation-safe fire-and-forget: keepalive + rejection catch never block UX.
    const result = sendAnalyticsEvent(ANALYTICS_ENDPOINT, payload, {
      transport: (url, init) => {
        const request = fetch(url, { ...init, keepalive: true });
        if (request && typeof request.catch === 'function') {
          return request.catch(() => null);
        }
        return request;
      },
    });
    if (result && typeof /** @type {{ catch?: unknown }} */ (result).catch === 'function') {
      void /** @type {Promise<unknown>} */ (result).catch(() => null);
    }
  } catch {
    // never block UX
  }
}

const metaPixel = createMetaPixelController();

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

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (considerCard(entry.target, entry.isIntersecting)) {
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '360px 0px', threshold: 0 },
    );
    grid.querySelectorAll('.proof-card').forEach((card) => observer.observe(card));
    // When IntersectionObserver exists, do not also register scroll/resize scanners.
    return;
  }

  // Fallback only: rAF-scheduled proximity scan without layout reads on loaded cards.
  let scanScheduled = false;
  function scanVisibleCards() {
    scanScheduled = false;
    const pending = grid.querySelectorAll('.proof-card:not([data-loaded="1"])');
    if (pending.length === 0) {
      window.removeEventListener('scroll', requestScan);
      window.removeEventListener('resize', requestScan);
      return;
    }
    pending.forEach((card) => {
      considerCard(card, false);
    });
    if (grid.querySelectorAll('.proof-card:not([data-loaded="1"])').length === 0) {
      window.removeEventListener('scroll', requestScan);
      window.removeEventListener('resize', requestScan);
    }
  }

  function requestScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(scanVisibleCards);
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

  // Idempotent even if later binding throws: never rebind listeners on retry.
  modal.dataset.registrationReady = '1';

  const openers = document.querySelectorAll('.js-open-register');
  const closers = modal.querySelectorAll('[data-close-modal]');
  const statusEl = document.getElementById('form-status');
  const submitBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('submit-btn')
  );

  let lastFocus = /** @type {HTMLElement | null} */ (null);
  let filledAt = Date.now();
  let formStarted = false;
  let submitLocked = false;

  // Captured once from the static markup so the busy label can be restored verbatim.
  const submitBtnRestingLabel = submitBtn ? submitBtn.textContent : '';

  const GENERIC_REG_ERROR =
    'No se pudo completar el registro. Intenta de nuevo en unos minutos.';

  // Main owns navigation after success; registration client redirect is a no-op.
  const client = createRegistrationClient(REGISTRATION_CONFIG, {
    transport: (url, options) => fetch(url, options),
    redirect: () => {},
    attributionSnapshot: () => attributionTracker.getSnapshot(),
    pageContext: () => browserPageContext(),
  });

  function getFocusable() {
    return /** @type {HTMLElement[]} */ (
      Array.from(
        modal.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => {
        if (el.hasAttribute('hidden')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.closest('[hidden]')) return false;
        if (el.closest('.field--honeypot')) return false;
        if (/** @type {HTMLButtonElement|HTMLInputElement} */ (el).disabled) return false;
        // Visible, enabled controls only — no || escape hatch for a hidden first input.
        if (el.offsetParent !== null) return true;
        // position:fixed elements can have null offsetParent while still visible
        try {
          return typeof el.getClientRects === 'function' && el.getClientRects().length > 0;
        } catch {
          return false;
        }
      })
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
    const order = ['fullName', 'email', 'phone', 'instagramUsername', 'consent', 'honeypot', 'timing'];
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

  function clearRegistrationFields() {
    if (form.fullName) form.fullName.value = '';
    if (form.email) form.email.value = '';
    if (form.phone) form.phone.value = '';
    if (form.instagramUsername) form.instagramUsername.value = '';
    const consent = form.querySelector('#consent');
    if (consent instanceof HTMLInputElement) consent.checked = false;
  }

  function openModal(source) {
    lastFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    filledAt = Date.now();
    formStarted = false;
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-pending', 'is-error');
    }
    clearFieldErrors();
    trackFirstParty('modal_open', { cta: source || 'unknown' });
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
      const source = btn.getAttribute('data-cta') || 'unknown';
      trackFirstParty('cta_click', { cta: source });
      openModal(source);
    });
  });

  closers.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  });

  form.addEventListener('input', () => {
    if (formStarted) return;
    formStarted = true;
    trackFirstParty('form_start');
  }, { once: false });

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

  /**
   * @param {{
   *   fullName?: string,
   *   email?: string,
   *   phone?: string,
   *   instagramUsername?: string,
   *   consent?: boolean,
   * } | null | undefined} retained
   * @param {string} message
   */
  function showRetainedError(retained, message) {
    if (retained) {
      if (typeof retained.fullName === 'string') form.fullName.value = retained.fullName;
      if (typeof retained.email === 'string') form.email.value = retained.email;
      if (typeof retained.phone === 'string' && form.phone) {
        form.phone.value = retained.phone;
      }
      if (typeof retained.instagramUsername === 'string' && form.instagramUsername) {
        form.instagramUsername.value = retained.instagramUsername;
      }
      const consent = form.querySelector('#consent');
      if (consent instanceof HTMLInputElement && typeof retained.consent === 'boolean') {
        consent.checked = retained.consent;
      }
    }
    if (statusEl) {
      statusEl.textContent = message || GENERIC_REG_ERROR;
      statusEl.classList.add('is-error');
      statusEl.classList.remove('is-pending');
    }
    statusEl?.focus?.();
    trackFirstParty('registration_error');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitLocked) return;

    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-pending', 'is-error');
    }
    clearFieldErrors();

    const fd = new FormData(form);
    const payload = {
      fullName: String(fd.get('fullName') ?? ''),
      email: String(fd.get('email') ?? ''),
      // Registration-only identity fields (never URL, query, browser storage, or analytics).
      phone: String(fd.get('phone') ?? ''),
      instagramUsername: String(fd.get('instagramUsername') ?? ''),
      consent: fd.get('consent') === '1' || form.querySelector('#consent')?.checked === true,
      honeypot: String(fd.get('company_website') ?? ''),
      filledAt,
      submittedAt: Date.now(),
    };

    // Every visible field is mandatory: block here, before the submit lock, the busy
    // state and any transport call, so an incomplete form never becomes a submit
    // attempt. The registration client re-validates as defense in depth.
    const missingRequired = findMissingRequiredFields(payload);
    if (missingRequired.length > 0) {
      showFieldErrors(validateRegistration(payload).errors ?? {});
      trackFirstParty('validation_error');
      return;
    }

    submitLocked = true;
    let keepLocked = false;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.textContent = SUBMIT_PROCESSING_BUTTON_LABEL;
    }
    // Immediate, accessible feedback: announced before the webhook ACK arrives so the
    // wait is never silent. Overwritten below by the branch that actually resolves
    // (validation/error/pending/success), or left visible through the WhatsApp redirect.
    if (statusEl) {
      statusEl.textContent = SUBMIT_PROCESSING_MESSAGE;
      statusEl.classList.add('is-pending');
      statusEl.classList.remove('is-error');
    }

    try {
      let result;
      try {
        result = await client.submit(payload);
      } catch {
        showRetainedError(
          {
            fullName: payload.fullName,
            email: payload.email,
            phone: payload.phone,
            instagramUsername: payload.instagramUsername,
            consent: payload.consent,
          },
          GENERIC_REG_ERROR,
        );
        return;
      }

      if (result.status === 'validation_error') {
        // Never leave the "processing" copy up next to field-level error highlights;
        // showFieldErrors only repopulates statusEl for timing/honeypot rejections.
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.classList.remove('is-pending', 'is-error');
        }
        showFieldErrors(result.errors ?? {});
        trackFirstParty('validation_error');
        return;
      }

      if (result.status === 'in_flight' || result.status === 'already_submitted') {
        if (statusEl) {
          statusEl.textContent = result.message;
          statusEl.classList.add('is-pending');
          statusEl.classList.remove('is-error');
        }
        statusEl?.focus?.();
        keepLocked = result.status === 'already_submitted';
        return;
      }

      if (result.status === 'pending') {
        if (result.retained) {
          form.fullName.value = result.retained.fullName;
          form.email.value = result.retained.email;
          if (form.phone && typeof result.retained.phone === 'string') {
            form.phone.value = result.retained.phone;
          }
          if (form.instagramUsername && typeof result.retained.instagramUsername === 'string') {
            form.instagramUsername.value = result.retained.instagramUsername;
          }
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
        showRetainedError(result.retained, result.message || GENERIC_REG_ERROR);
        return;
      }

      if (result.status === 'success') {
        const eventId = result.eventId || '';
        if (result.clearFields) {
          clearRegistrationFields();
        }
        // Order: confirmed Meta CompleteRegistration (once, with the stable eventID)
        // → privacy-safe analytics → fixed invite. Reached only after the strict
        // persisted ACK, and the client latches success so it cannot fire twice.
        // Destination is the owner-supplied constant only — never query/form/API/storage/referrer.
        // Instagram username is never sent to analytics/logs — only the n8n registration POST.
        metaPixel.trackCompleteRegistration({
          registrationConfirmed: true,
          isThankYouDirectVisit: false,
          eventId,
        });
        trackFirstParty('registration_success', { event_id: eventId });
        keepLocked = true;
        window.location.assign(FIXED_WHATSAPP_GROUP_INVITE);
        return;
      }

      // Terminal unknown-status branch: accessible error, retain fields, unlock.
      showRetainedError(
        result?.retained || {
          fullName: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          instagramUsername: payload.instagramUsername,
          consent: payload.consent,
        },
        GENERIC_REG_ERROR,
      );
    } finally {
      if (!keepLocked) {
        submitLocked = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
          submitBtn.textContent = submitBtnRestingLabel;
        }
      }
    }
  });
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
    window.requestAnimationFrame(update);
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

function initAttributionBoot() {
  captureLandingAttribution();
  trackFirstParty('page_view');
  // Meta PageView is emitted by the head snippet; the controller is reserved for
  // the single post-ACK CompleteRegistration event.
  void META_PIXEL_ID;
  loadClarityDeferred();
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
      ['attribution', initAttributionBoot],
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
  REGISTRATION_ENDPOINT,
  FIXED_WHATSAPP_GROUP_INVITE,
  FALLBACK_THANK_YOU_PATH,
};
