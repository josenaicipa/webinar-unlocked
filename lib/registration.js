import {
  createId,
  sanitizePageContext,
  extractAllowlistedParams,
} from './attribution.js';

/** Minimum time (ms) the form must stay open before submit is accepted (client-side only). */
export const MIN_FILL_MS = 2500;

/**
 * Exact active n8n registration webhook (must stay literal for release verification).
 * Analytics has its own sink (see ANALYTICS_ENDPOINT); registration PII never goes there.
 */
export const REGISTRATION_ENDPOINT = 'https://n8n.unlockedacademy.co/webhook/webinar-registro-vsl';

/** Fail-closed budget (ms) for the registration round trip. */
export const REGISTRATION_TIMEOUT_MS = 15000;

/** Fixed webinar identifiers expected at the JSON root by the active n8n workflow. */
export const WEBINAR_ID = '89615246408';
export const WEBINAR_FECHA = '2026-08-11';
export const WEBINAR_HORA = '19:00';

/**
 * Canonical list of visible registration fields. Every one is mandatory
 * end-to-end: `required` + `aria-required` in markup, presence gate before any
 * submit attempt, and a validation error here. The honeypot is never listed.
 */
export const REQUIRED_REGISTRATION_FIELDS = Object.freeze([
  'fullName',
  'email',
  'phone',
  'instagramUsername',
  'consent',
]);

/** Fallback Spanish copy for a mandatory field with no format-specific message. */
const REQUIRED_FIELD_MESSAGE = 'Este campo es obligatorio.';

/** Exact registration event for this surface (must not mutate GHL via other event names). */
export const REGISTRATION_EVENT = 'webinar_registration';

export const REGISTRATION_SURFACE = 'webinar_protocolo_unlocked';

/** Matches `maxlength` on #fullName in markup. */
export const MAX_FULL_NAME_LENGTH = 120;

/** Matches `maxlength` on #email in markup. */
export const MAX_EMAIL_LENGTH = 160;

/** Matches `maxlength` on #phone in markup (digits plus human separators). */
export const MAX_PHONE_LENGTH = 24;

/** Minimum digits accepted after normalization (E.164-compatible lower bound). */
export const MIN_PHONE_DIGITS = 8;

/** Maximum digits accepted after normalization (E.164 upper bound). */
export const MAX_PHONE_DIGITS = 15;

/**
 * Matches `maxlength` on #instagramUsername in markup.
 * Allows optional leading `@` plus up to 30 handle characters.
 */
export const MAX_INSTAGRAM_USERNAME_LENGTH = 31;

/** Instagram handle length after optional `@` (1–30 ASCII [a-z0-9._]). */
export const MAX_INSTAGRAM_HANDLE_LENGTH = 30;

/** Bound for visitor_id scalars in the canonical registration payload. */
export const MAX_VISITOR_ID_LENGTH = 80;

/** Bound for session_id scalars in the canonical registration payload. */
export const MAX_SESSION_ID_LENGTH = 80;

/** Bound for event_id scalars in the canonical registration payload. */
export const MAX_EVENT_ID_LENGTH = 100;

/** @typedef {'pending'|'webhook'} RegistrationMode */

/**
 * Fail-closed library defaults: no network until the route enables webhook mode.
 * @type {{
 *   mode: RegistrationMode,
 *   endpoint: string,
 *   thankYouPath: string,
 *   eventName: string,
 *   surface: string,
 *   timeoutMs: number,
 * }}
 */
export const DEFAULT_REGISTRATION_CONFIG = {
  mode: 'pending',
  endpoint: '',
  thankYouPath: '/gracias/',
  eventName: REGISTRATION_EVENT,
  surface: REGISTRATION_SURFACE,
  timeoutMs: REGISTRATION_TIMEOUT_MS,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canonical Instagram handle body: 1–30 lowercase ASCII letters, digits, `.` or `_`. */
const INSTAGRAM_HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/** Human separators tolerated inside a typed phone number. */
const PHONE_SEPARATOR_RE = /[\s.()\- ‐-―]/g;

/** Canonical phone body after separators are stripped: MIN..MAX digits only. */
const PHONE_DIGITS_RE = new RegExp(`^[0-9]{${MIN_PHONE_DIGITS},${MAX_PHONE_DIGITS}}$`);

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function boundTrimmedString(value, max) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.slice(0, max);
}

/**
 * Trim, accept optional leading `@`, canonicalize to lowercase `@` + 1–30 [a-z0-9._].
 * @param {unknown} raw
 * @returns {string|null} canonical `@handle` or null when invalid
 */
export function normalizeInstagramUsername(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_INSTAGRAM_USERNAME_LENGTH) return null;
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!withoutAt) return null;
  const lower = withoutAt.toLowerCase();
  if (!INSTAGRAM_HANDLE_RE.test(lower)) return null;
  if (lower.length > MAX_INSTAGRAM_HANDLE_LENGTH) return null;
  return `@${lower}`;
}

/**
 * Trim, accept common human separators (spaces, dots, dashes, parentheses) and an
 * international prefix (`+` or `00`), then canonicalize to `+` plus 8–15 digits.
 * Returns null for missing, malformed or out-of-bounds input (fail closed).
 * @param {unknown} raw
 * @returns {string|null} canonical `+<digits>` or null when invalid
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PHONE_LENGTH) return null;

  const compact = trimmed.replace(PHONE_SEPARATOR_RE, '');
  if (!compact) return null;

  let digits = compact;
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else {
    // Country code is mandatory; never infer one on the user's behalf.
    return null;
  }

  // No country code starts with 0; reject trunk/ambiguous leading-zero forms.
  if (!digits || digits.startsWith('0')) return null;
  if (!PHONE_DIGITS_RE.test(digits)) return null;
  return `+${digits}`;
}

/**
 * Normalize captured_at to a valid ISO-8601 timestamp.
 * Valid parseable inputs are rewritten via Date.toISOString(); invalid/missing
 * inputs fall back to the injected clock (or wall clock).
 * @param {unknown} raw
 * @param {() => string} [nowIso]
 * @returns {string}
 */
export function normalizeCapturedAt(raw, nowIso) {
  if (typeof raw === 'string' && raw.length > 0) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const fallback =
    typeof nowIso === 'function' ? nowIso() : new Date().toISOString();
  const fallbackDate = new Date(fallback);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString();
  }
  return new Date().toISOString();
}

/**
 * @param {unknown} path
 * @returns {boolean}
 */
export function isSafeThankYouPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  // Reject backslash authority forms browsers may treat as protocol-relative (\\evil).
  if (path.includes('\\')) return false;
  if (path.includes('://')) return false;
  if (path.includes('..')) return false;
  if (/[\s<>"'`]/.test(path)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return true;
}

/**
 * Exact positive acknowledgement from the active n8n registration webhook.
 * Success requires the complete persisted-write receipt: `ok === true`,
 * `logged === true`, `ghl_event_driven === false`, and `ghl_written === true`.
 * Anything incomplete or differently typed fails closed so no Meta
 * CompleteRegistration / redirect can fire on an unconfirmed GHL write.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isSuccessfulRegistrationResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const body = /** @type {Record<string, unknown>} */ (data);
  return (
    body.ok === true &&
    body.logged === true &&
    body.ghl_event_driven === false &&
    body.ghl_written === true
  );
}

/**
 * Presence-only gate for the mandatory visible fields (format rules stay in
 * validateRegistration). Blank strings, whitespace-only strings, missing keys and
 * an unchecked consent box all count as missing, so the UI can block before submit.
 * @param {unknown} input
 * @returns {string[]} missing field keys in canonical order (empty when complete)
 */
export function findMissingRequiredFields(input) {
  const source =
    input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};
  return REQUIRED_REGISTRATION_FIELDS.filter((field) => {
    if (field === 'consent') return !source.consent;
    return String(source[field] ?? '').trim().length === 0;
  });
}

/**
 * @param {{
 *   fullName?: string,
 *   email?: string,
 *   phone?: string,
 *   instagramUsername?: string,
 *   consent?: boolean,
 *   honeypot?: string,
 *   filledAt?: number,
 *   submittedAt?: number,
 * }} input
 */
export function validateRegistration(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  const fullName = (input.fullName ?? '').trim();
  const email = (input.email ?? '').trim();
  const phone = normalizePhone(input.phone);
  const instagramUsername = normalizeInstagramUsername(input.instagramUsername);
  const consent = Boolean(input.consent);
  const honeypot = (input.honeypot ?? '').trim();
  const filledAt = Number(input.filledAt);
  const submittedAt = Number(input.submittedAt);

  if (!fullName || fullName.length < 2) {
    errors.fullName = 'Escribe tu nombre completo.';
  } else if (fullName.length > MAX_FULL_NAME_LENGTH) {
    errors.fullName = 'El nombre es demasiado largo.';
  }

  if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    errors.email = 'Ingresa un correo válido.';
  }

  if (!phone) {
    // Digit-free Spanish copy — never echo the typed value.
    errors.phone = 'Ingresa un teléfono válido con código de país.';
  }

  if (!instagramUsername) {
    errors.instagramUsername = 'Ingresa un usuario de Instagram válido.';
  }

  if (!consent) {
    errors.consent = 'Debes aceptar el consentimiento para continuar.';
  }

  if (honeypot) {
    errors.honeypot = 'Envío no válido.';
  }

  if (!Number.isFinite(filledAt) || !Number.isFinite(submittedAt) || submittedAt - filledAt < MIN_FILL_MS) {
    errors.timing = 'Espera un momento e inténtalo de nuevo.';
  }

  // Safety net: no mandatory visible field can ever pass without an error, even if
  // a future field is added above without its own format rule.
  for (const field of findMissingRequiredFields(input)) {
    if (!errors[field]) errors[field] = REQUIRED_FIELD_MESSAGE;
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    /** @type {string|null} */
    phone,
    /** @type {string|null} */
    instagramUsername,
  };
}

/**
 * Canonical bounded registration payload for the active n8n webhook.
 *
 * The workflow reads `fullName`, `email`, `phone`, `instagram_username`,
 * `webinar_id`, `webinar_fecha` and `webinar_hora` at the JSON root (no legacy
 * `identity` nesting). event / event_name / surface and the webinar constants are
 * fixed library values (caller overrides ignored). Phone and Instagram travel only
 * in this registration POST — never URL/query/storage/analytics.
 * @param {{
 *   fullName: string,
 *   email: string,
 *   phone?: string,
 *   instagramUsername: string,
 *   consent: boolean,
 *   attribution?: {
 *     visitor_id?: string,
 *     session_id?: string,
 *     first_touch?: Record<string, string>,
 *     current?: Record<string, string>,
 *   },
 *   page?: { path?: string, referrer?: string, title?: string },
 *   eventId?: string,
 *   capturedAt?: string,
 *   surface?: string,
 *   nowIso?: () => string,
 * }} input
 */
export function buildRegistrationPayload(input) {
  const fullName = boundTrimmedString(input.fullName, MAX_FULL_NAME_LENGTH);
  const email = boundTrimmedString(input.email, MAX_EMAIL_LENGTH);
  const phone = normalizePhone(input.phone) || '';
  const canonicalIg =
    normalizeInstagramUsername(input.instagramUsername) ||
    boundTrimmedString(input.instagramUsername, MAX_INSTAGRAM_USERNAME_LENGTH);
  const attribution = input.attribution || {};
  const visitor_id = boundTrimmedString(attribution.visitor_id, MAX_VISITOR_ID_LENGTH);
  const session_id = boundTrimmedString(attribution.session_id, MAX_SESSION_ID_LENGTH);
  const page = sanitizePageContext(input.page || {});
  const eventId = boundTrimmedString(input.eventId || createId('evt'), MAX_EVENT_ID_LENGTH);
  const capturedAt = normalizeCapturedAt(input.capturedAt, input.nowIso);

  return {
    event: REGISTRATION_EVENT,
    event_name: REGISTRATION_EVENT,
    // Surface is fixed for this product; never honor caller/config overrides.
    surface: REGISTRATION_SURFACE,
    event_id: eventId,
    captured_at: capturedAt,
    // Root-level registration fields expected by the active n8n workflow.
    fullName,
    email,
    phone,
    instagram_username: canonicalIg,
    // Fixed webinar identifiers; never derived from caller input.
    webinar_id: WEBINAR_ID,
    webinar_fecha: WEBINAR_FECHA,
    webinar_hora: WEBINAR_HORA,
    consent: Boolean(input.consent),
    visitor_id,
    session_id,
    attribution: {
      visitor_id,
      session_id,
      first_touch: extractAllowlistedParams(attribution.first_touch || {}),
      current: extractAllowlistedParams(attribution.current || {}),
    },
    page,
  };
}

/** Sentinel resolved by the fail-closed timer when the transport does not answer in time. */
const REGISTRATION_TIMEOUT = Symbol('registration_timeout');

/**
 * Race a transport promise against a fail-closed timer.
 * Resolves to REGISTRATION_TIMEOUT when the budget elapses first; the pending
 * request is aborted when the environment supports AbortController.
 * @template T
 * @param {Promise<T>} pending
 * @param {number} ms
 * @param {{ abort: () => void }|null} [controller]
 * @returns {Promise<T|typeof REGISTRATION_TIMEOUT>}
 */
function withRegistrationTimeout(pending, ms, controller) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // aborting is best-effort; the timeout result already fails closed
      }
      resolve(REGISTRATION_TIMEOUT);
    }, ms);
  });
  return Promise.race([pending, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Typed registration integration seam.
 * @param {Partial<typeof DEFAULT_REGISTRATION_CONFIG>} [config]
 * @param {{
 *   transport?: (url: string, options: RequestInit) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>,
 *   redirect?: (path: string) => void,
 *   attributionSnapshot?: () => {
 *     visitor_id?: string,
 *     session_id?: string,
 *     first_touch?: Record<string, string>,
 *     current?: Record<string, string>,
 *   },
 *   pageContext?: () => { path?: string, referrer?: string, title?: string },
 *   createEventId?: () => string,
 *   nowIso?: () => string,
 * }} [deps]
 */
export function createRegistrationClient(config = {}, deps = {}) {
  const cfg = {
    ...DEFAULT_REGISTRATION_CONFIG,
    ...config,
  };

  const transport = deps.transport;
  const redirect = deps.redirect ?? (() => {});
  const attributionSnapshot =
    deps.attributionSnapshot ??
    (() => ({ visitor_id: '', session_id: '', first_touch: {}, current: {} }));
  const pageContext = deps.pageContext ?? (() => ({ path: '/', referrer: '', title: '' }));
  const createEventId = deps.createEventId ?? (() => createId('evt'));
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const configuredTimeout = Number(cfg.timeoutMs);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : REGISTRATION_TIMEOUT_MS;

  let inFlight = false;
  let accepted = false;
  /** Reused across retries until confirmed success for this client lifecycle. */
  let pendingEventId = /** @type {string|null} */ (null);

  /**
   * @param {{
   *   fullName: string,
   *   email: string,
   *   phone?: string,
   *   instagramUsername: string,
   *   consent: boolean,
   *   honeypot?: string,
   *   filledAt: number,
   *   submittedAt: number,
   * }} payload
   */
  async function submit(payload) {
    if (accepted) {
      return {
        status: 'already_submitted',
        clearFields: false,
        message: 'Tu registro ya fue recibido.',
      };
    }

    if (inFlight) {
      return {
        status: 'in_flight',
        clearFields: false,
        message: 'Estamos procesando tu registro. Espera un momento.',
      };
    }

    const validation = validateRegistration(payload);
    if (!validation.ok) {
      return {
        status: 'validation_error',
        errors: validation.errors,
        clearFields: false,
        message: 'Revisa los campos marcados.',
      };
    }

    const canonicalPhone =
      validation.phone || normalizePhone(payload.phone) || '';
    const canonicalIg =
      validation.instagramUsername ||
      normalizeInstagramUsername(payload.instagramUsername) ||
      '';

    const retained = {
      fullName: payload.fullName.trim(),
      email: payload.email.trim(),
      phone: canonicalPhone,
      instagramUsername: canonicalIg,
      consent: Boolean(payload.consent),
    };

    if (cfg.mode === 'pending' || !cfg.mode) {
      return {
        status: 'pending',
        clearFields: false,
        retained,
        message:
          'Estamos finalizando la conexión segura de registro. Tus datos se mantienen en el formulario; inténtalo de nuevo en breve.',
      };
    }

    if (cfg.mode === 'webhook') {
      if (!cfg.endpoint || typeof cfg.endpoint !== 'string') {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'La conexión de registro no está configurada.',
        };
      }

      if (typeof transport !== 'function') {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'No hay transporte de envío disponible.',
        };
      }

      inFlight = true;
      try {
        if (!pendingEventId) {
          pendingEventId = createEventId();
        }
        const eventId = pendingEventId;
        // event / event_name / surface and the webinar_* constants are fixed inside
        // buildRegistrationPayload; cfg.surface and cfg.eventName cannot override the
        // n8n contract. Phone and Instagram exist only in this registration POST.
        const body = buildRegistrationPayload({
          fullName: retained.fullName,
          email: retained.email,
          phone: retained.phone,
          instagramUsername: retained.instagramUsername,
          consent: retained.consent,
          attribution: attributionSnapshot(),
          page: pageContext(),
          eventId,
          capturedAt: nowIso(),
          nowIso,
        });

        const controller =
          typeof AbortController === 'function' ? new AbortController() : null;
        const raced = await withRegistrationTimeout(
          Promise.resolve(
            transport(cfg.endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              credentials: 'omit',
              ...(controller ? { signal: controller.signal } : {}),
            }),
          ),
          timeoutMs,
          controller,
        );

        if (raced === REGISTRATION_TIMEOUT) {
          // Unknown server state: keep fields, keep the pending event id, no redirect.
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'El registro tardó demasiado. Intenta de nuevo en unos minutos.',
          };
        }

        const response = /** @type {{ ok: boolean, status: number, json: () => Promise<unknown> }} */ (
          raced
        );

        if (!response || !response.ok || response.status < 200 || response.status >= 300) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'No se pudo completar el registro. Intenta de nuevo en unos minutos.',
          };
        }

        let data;
        try {
          // A stalled body must not hold the submit lock either.
          data = await withRegistrationTimeout(
            Promise.resolve(response.json()),
            timeoutMs,
            controller,
          );
        } catch {
          // Malformed / non-JSON body (SyntaxError) — fail closed.
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'La respuesta del servidor no es válida. Intenta de nuevo.',
          };
        }

        if (data === REGISTRATION_TIMEOUT) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'El registro tardó demasiado. Intenta de nuevo en unos minutos.',
          };
        }

        if (!isSuccessfulRegistrationResponse(data)) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'No se pudo confirmar el registro. Intenta de nuevo en unos minutos.',
          };
        }

        // Confirmed success: clear pending id and latch so retries do not re-post.
        accepted = true;
        pendingEventId = null;

        if (!isSafeThankYouPath(cfg.thankYouPath)) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'Ruta de confirmación no segura. Registro no redirigido.',
          };
        }

        // Navigation may be owned by the route (no-op redirect adapter).
        redirect(cfg.thankYouPath);
        return {
          status: 'success',
          clearFields: true,
          message: 'Registro recibido.',
          eventId,
        };
      } catch {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'No se pudo completar el registro. Intenta de nuevo en unos minutos.',
        };
      } finally {
        inFlight = false;
      }
    }

    return {
      status: 'error',
      clearFields: false,
      retained,
      message: 'Modo de registro no soportado.',
    };
  }

  return {
    config: cfg,
    submit,
  };
}
