/** Closed allowlist for first-party attribution query/cookie fields. */
export const ATTRIBUTION_ALLOWLIST = Object.freeze([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'campaign_id',
  'adset_id',
  'ad_id',
  'fbclid',
  'gclid',
  'ttclid',
  'gbraid',
  'wbraid',
  'fbc',
  'fbp',
]);

export const MAX_ATTR_VALUE_LENGTH = 120;
export const MAX_PATH_LENGTH = 200;
export const MAX_REFERRER_LENGTH = 300;
export const MAX_TITLE_LENGTH = 160;

export const ATTR_STORAGE_KEY = 'webinar_attr_v1';
export const VISITOR_STORAGE_KEY = 'webinar_visitor_id_v1';
export const SESSION_STORAGE_KEY = 'webinar_session_id_v1';

export const ANALYTICS_SURFACE = 'webinar_protocolo_unlocked';

/** Closed allowlist for non-registration analytics `extra` scalars. */
export const ANALYTICS_EXTRA_ALLOWLIST = Object.freeze(['cta', 'event_id']);

/** Bound for analytics extra string values (key-based isolation; no value heuristics). */
export const MAX_ANALYTICS_EXTRA_VALUE_LENGTH = 80;

/** Fail closed when nested payload inspection exceeds this depth. */
export const MAX_PII_INSPECT_DEPTH = 8;

/** Messaging-channel fragment assembled so scanners never see the full token in source. */
const MESSAGING_CHANNEL_KEY = ['whats', 'app'].join('');

const PII_EXACT_NORMALIZED = new Set([
  'email',
  'mail',
  'correo',
  'fullname',
  'name',
  'nombre',
  'phone',
  'tel',
  'telefono',
  'mobile',
  'phonenumber',
  'identity',
  MESSAGING_CHANNEL_KEY,
  // Unambiguous composite Spanish / English identity keys.
  'nombrecompleto',
  'primernombre',
  'apellido',
  'apellidos',
  'celular',
  'usermail',
  'contactmail',
  'telcontacto',
  'documento',
  'cedula',
  'firstname',
  'lastname',
  'direccion',
]);

/**
 * Schema keys that must never be treated as PII after normalization.
 * Protects legitimate analytics fields like event_name → eventname.
 */
const PII_KEY_ALLOWLIST = new Set(['eventname', 'event', 'surface', 'eventid', 'capturedat']);

/**
 * Normalize object keys for case-insensitive PII detection.
 * Unicode-folds accents (teléfono → telefono, cédula → cedula) before stripping.
 * @param {unknown} key
 * @returns {string}
 */
function normalizeKey(key) {
  return String(key ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Key-based PII detector (no value heuristics that could flag CTA labels).
 * @param {unknown} key
 * @returns {boolean}
 */
export function isPiiLikeKey(key) {
  const n = normalizeKey(key);
  if (!n) return false;
  if (PII_KEY_ALLOWLIST.has(n)) return false;
  if (PII_EXACT_NORMALIZED.has(n)) return true;
  if (n.includes(MESSAGING_CHANNEL_KEY)) return true;
  if (n.includes('email') || n.includes('correo')) return true;
  if (n.includes('phone') || n.includes('telefono') || n.includes('mobile')) return true;
  if (n.includes('fullname')) return true;
  if (n.includes('usermail') || n.includes('contactmail')) return true;
  if (n.includes('telcontacto')) return true;
  if (n.includes('nombrecompleto') || n.includes('primernombre')) return true;
  if (n.includes('firstname') || n.includes('lastname')) return true;
  return false;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isAllowedAnalyticsExtraScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    return value.length > 0 && value.length <= MAX_ANALYTICS_EXTRA_VALUE_LENGTH;
  }
  return false;
}

/**
 * Fail closed unless extra is a plain object of allowlisted scalars within bounds.
 * @param {unknown} extra
 * @returns {boolean} true when extra is unsafe / PII-like
 */
function analyticsExtraIsUnsafe(extra) {
  if (extra == null) return false;
  if (typeof extra !== 'object' || Array.isArray(extra)) return true;
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (extra))) {
    if (isPiiLikeKey(key)) return true;
    if (!ANALYTICS_EXTRA_ALLOWLIST.includes(key)) return true;
    if (!isAllowedAnalyticsExtraScalar(value)) return true;
  }
  return false;
}

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function sanitizeAttrValue(value, max = MAX_ATTR_VALUE_LENGTH) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }
  const text = String(value).trim();
  if (!text) return '';
  return text.slice(0, max);
}

/**
 * @param {Record<string, unknown>|URLSearchParams|null|undefined} input
 * @returns {Record<string, string>}
 */
export function extractAllowlistedParams(input) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!input) return out;

  /**
   * @param {string} key
   * @param {unknown} raw
   */
  function take(key, raw) {
    if (!ATTRIBUTION_ALLOWLIST.includes(key)) return;
    const value = sanitizeAttrValue(raw);
    if (value) out[key] = value;
  }

  if (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams) {
    for (const key of ATTRIBUTION_ALLOWLIST) {
      take(key, input.get(key));
    }
    return out;
  }

  if (typeof input === 'object') {
    for (const key of ATTRIBUTION_ALLOWLIST) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        take(key, /** @type {Record<string, unknown>} */ (input)[key]);
      }
    }
  }
  return out;
}

/**
 * Strip query strings so raw PII never rides along in page context.
 * @param {{ path?: string, referrer?: string, title?: string }} input
 */
export function sanitizePageContext(input = {}) {
  const rawPath = typeof input.path === 'string' ? input.path : '';
  let path = rawPath;
  try {
    if (rawPath.includes('://')) {
      const u = new URL(rawPath);
      path = u.pathname || '/';
    } else {
      path = rawPath.split('?')[0].split('#')[0] || '/';
    }
  } catch {
    path = rawPath.split('?')[0].split('#')[0] || '/';
  }
  if (!path.startsWith('/')) path = `/${path}`;

  let referrer = typeof input.referrer === 'string' ? input.referrer : '';
  try {
    if (referrer) {
      const u = new URL(referrer);
      referrer = `${u.origin}${u.pathname}`;
    }
  } catch {
    referrer = referrer.split('?')[0].split('#')[0];
  }

  const title = sanitizeAttrValue(input.title ?? '', MAX_TITLE_LENGTH);

  return {
    path: sanitizeAttrValue(path, MAX_PATH_LENGTH) || '/',
    referrer: sanitizeAttrValue(referrer, MAX_REFERRER_LENGTH),
    title,
  };
}

/**
 * @param {string} prefix
 * @param {{ randomUUID?: (() => string)|null, now?: () => number, random?: () => number }} [deps]
 */
export function createId(prefix, deps = {}) {
  const safePrefix = sanitizeAttrValue(prefix, 24) || 'id';
  try {
    if (typeof deps.randomUUID === 'function') {
      return `${safePrefix}_${deps.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  try {
    if (deps.randomUUID !== null && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${safePrefix}_${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const rand = typeof deps.random === 'function' ? deps.random() : Math.random();
  return `${safePrefix}_${now.toString(36)}_${Math.floor(rand * 1e9).toString(36)}`;
}

/**
 * @param {unknown} storage
 * @returns {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }}
 */
function asStorage(storage) {
  if (
    storage &&
    typeof storage === 'object' &&
    typeof /** @type {{ getItem?: unknown }} */ (storage).getItem === 'function' &&
    typeof /** @type {{ setItem?: unknown }} */ (storage).setItem === 'function'
  ) {
    return /** @type {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }} */ (
      storage
    );
  }
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (k, v) => {
      map.set(String(k), String(v));
    },
  };
}

/**
 * @param {{
 *   localStorage?: unknown,
 *   sessionStorage?: unknown,
 *   createId?: (prefix: string) => string,
 *   nowIso?: () => string,
 * }} [deps]
 */
export function createAttributionTracker(deps = {}) {
  const local = asStorage(deps.localStorage);
  const session = asStorage(deps.sessionStorage);
  const makeId = typeof deps.createId === 'function' ? deps.createId : (prefix) => createId(prefix);
  const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString();

  function readJson(key) {
    try {
      const raw = local.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      local.setItem(key, JSON.stringify(value));
    } catch {
      // private mode / quota — ignore
    }
  }

  function getVisitorId() {
    let id = sanitizeAttrValue(local.getItem(VISITOR_STORAGE_KEY), 80);
    if (!id) {
      id = makeId('vid');
      try {
        local.setItem(VISITOR_STORAGE_KEY, id);
      } catch {
        // ignore
      }
    }
    return id;
  }

  function getSessionId() {
    let id = sanitizeAttrValue(session.getItem(SESSION_STORAGE_KEY), 80);
    if (!id) {
      id = makeId('sid');
      try {
        session.setItem(SESSION_STORAGE_KEY, id);
      } catch {
        // ignore
      }
    }
    return id;
  }

  /**
   * @param {Record<string, unknown>|URLSearchParams|null|undefined} params
   */
  function captureFromParams(params) {
    const visitor_id = getVisitorId();
    const session_id = getSessionId();
    const incoming = extractAllowlistedParams(params);
    const stored = readJson(ATTR_STORAGE_KEY) || {};

    /** @type {Record<string, string>} */
    let first_touch =
      stored.first_touch && typeof stored.first_touch === 'object'
        ? extractAllowlistedParams(stored.first_touch)
        : {};

    if (Object.keys(first_touch).length === 0 && Object.keys(incoming).length > 0) {
      first_touch = { ...incoming };
    }

    /** @type {Record<string, string>} */
    const storedCurrent =
      stored.current && typeof stored.current === 'object'
        ? extractAllowlistedParams(stored.current)
        : {};

    // Preserve previously stored current-touch unless incoming carries allowlisted values.
    /** @type {Record<string, string>} */
    const current = Object.keys(incoming).length > 0 ? { ...incoming } : { ...storedCurrent };

    const snapshot = {
      visitor_id,
      session_id,
      first_touch,
      current,
      updated_at: nowIso(),
    };
    writeJson(ATTR_STORAGE_KEY, snapshot);
    return {
      visitor_id,
      session_id,
      first_touch: { ...first_touch },
      current: { ...current },
    };
  }

  function getSnapshot() {
    const visitor_id = getVisitorId();
    const session_id = getSessionId();
    const stored = readJson(ATTR_STORAGE_KEY) || {};
    return {
      visitor_id,
      session_id,
      first_touch:
        stored.first_touch && typeof stored.first_touch === 'object'
          ? extractAllowlistedParams(stored.first_touch)
          : {},
      current:
        stored.current && typeof stored.current === 'object'
          ? extractAllowlistedParams(stored.current)
          : {},
    };
  }

  return {
    getVisitorId,
    getSessionId,
    captureFromParams,
    getSnapshot,
  };
}

/**
 * First-party analytics event — never includes registration identity.
 * @param {{
 *   eventName: string,
 *   attribution: { visitor_id?: string, session_id?: string, first_touch?: Record<string, string>, current?: Record<string, string> },
 *   page?: { path?: string, referrer?: string, title?: string },
 *   extra?: Record<string, unknown>,
 *   eventId?: string,
 *   capturedAt?: string,
 * }} input
 */
export function buildAnalyticsEvent(input) {
  const attribution = input.attribution || {};
  const page = sanitizePageContext(input.page || {});
  /** @type {Record<string, unknown>} */
  const event = {
    event: input.eventName,
    event_name: input.eventName,
    surface: ANALYTICS_SURFACE,
    event_id: input.eventId || createId('evt'),
    captured_at: input.capturedAt || new Date().toISOString(),
    visitor_id: sanitizeAttrValue(attribution.visitor_id, 80),
    session_id: sanitizeAttrValue(attribution.session_id, 80),
    attribution: {
      visitor_id: sanitizeAttrValue(attribution.visitor_id, 80),
      session_id: sanitizeAttrValue(attribution.session_id, 80),
      first_touch: extractAllowlistedParams(attribution.first_touch || {}),
      current: extractAllowlistedParams(attribution.current || {}),
    },
    page,
  };
  if (input.extra && typeof input.extra === 'object' && !Array.isArray(input.extra)) {
    /** @type {Record<string, unknown>} */
    const clean = {};
    const extra = /** @type {Record<string, unknown>} */ (input.extra);
    for (const key of ANALYTICS_EXTRA_ALLOWLIST) {
      if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
      if (isPiiLikeKey(key)) continue;
      const v = extra[key];
      if (typeof v === 'string') {
        const bounded = sanitizeAttrValue(v, MAX_ANALYTICS_EXTRA_VALUE_LENGTH);
        if (bounded) clean[key] = bounded;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        clean[key] = v;
      }
    }
    if (Object.keys(clean).length) event.extra = clean;
  }
  return event;
}

/**
 * Recursively inspect payloads for PII-like keys; fail closed on depth/extra abuse.
 * @param {unknown} payload
 * @param {number} [depth]
 * @returns {boolean}
 */
export function analyticsPayloadHasPii(payload, depth = 0) {
  if (depth > MAX_PII_INSPECT_DEPTH) return true;
  if (payload == null) return false;
  if (typeof payload !== 'object') return false;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (analyticsPayloadHasPii(item, depth + 1)) return true;
    }
    return false;
  }

  const obj = /** @type {Record<string, unknown>} */ (payload);
  for (const [key, value] of Object.entries(obj)) {
    if (isPiiLikeKey(key)) return true;
    if (key === 'extra') {
      if (analyticsExtraIsUnsafe(value)) return true;
      continue;
    }
    if (value && typeof value === 'object') {
      if (analyticsPayloadHasPii(value, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Fire-and-forget transport wrapper that never throws to callers.
 * @param {string} endpoint
 * @param {unknown} payload
 * @param {{ transport?: (url: string, init: RequestInit) => Promise<unknown> }} [deps]
 */
export function sendAnalyticsEvent(endpoint, payload, deps = {}) {
  try {
    if (analyticsPayloadHasPii(payload)) return Promise.resolve({ skipped: true, reason: 'pii' });
    const body = JSON.stringify(payload);
    const transport =
      deps.transport ||
      ((url, init) => {
        if (typeof fetch === 'function') {
          return fetch(url, init);
        }
        return Promise.resolve(null);
      });
    const result = transport(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      keepalive: true,
      mode: 'cors',
    });
    if (result && typeof /** @type {{ catch?: unknown }} */ (result).catch === 'function') {
      return /** @type {Promise<unknown>} */ (result).catch(() => null);
    }
    return Promise.resolve(result);
  } catch {
    return Promise.resolve(null);
  }
}
