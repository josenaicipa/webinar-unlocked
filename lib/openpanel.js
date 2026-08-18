import {
  ATTRIBUTION_ALLOWLIST,
  ANALYTICS_EXTRA_ALLOWLIST,
  MAX_ANALYTICS_EXTRA_VALUE_LENGTH,
  MAX_PII_INSPECT_DEPTH,
  extractAllowlistedParams,
  isPiiLikeKey,
  sanitizeAttrValue,
  sanitizePageContext,
} from './attribution.js';

/** Self-hosted OpenPanel ingest (public client id; no secret in the browser). */
export const OPENPANEL_API_URL = 'https://analytics.unlockedecom.co/api';

/** Official self-hosted script-tag SDK. Never the vendor SaaS host. */
export const OPENPANEL_SDK_SRC = 'https://analytics.unlockedecom.co/op1.js';

/**
 * Existing Unlocked Ecom OpenPanel project client.
 * Shared with other first-party landings so the server-side bridge can join
 * this surface to the same project. Public, not a secret.
 */
export const OPENPANEL_CLIENT_ID = '6b9d66b2-3af8-4574-abca-19d1b5bc78fb';

export const OPENPANEL_SURFACE = 'webinar_protocolo_unlocked';
export const OPENPANEL_LANDING_ID = 'webinar_protocolo_unlocked';
export const OPENPANEL_FUNNEL = 'webinar_protocolo_unlocked';
export const OPENPANEL_VARIANT = 'webinar';
export const OPENPANEL_ENVIRONMENT = 'production';

/**
 * Semantic events this surface is allowed to emit.
 * screen_view is sent via the SDK `screenView` API (not trackScreenViews).
 */
export const OPENPANEL_EVENTS = Object.freeze({
  SCREEN_VIEW: 'screen_view',
  CTA_CLICKED: 'webinar_cta_clicked',
  FORM_STARTED: 'form_started',
  REGISTERED: 'webinar_registered',
  THANK_YOU_VIEWED: 'thank_you_viewed',
});

/**
 * Events this surface must never invent. Attendance, offer and checkout are
 * not observable here — do not add them without a real source.
 */
export const FORBIDDEN_OPENPANEL_EVENTS = Object.freeze([
  'webinar_attended',
  'webinar_no_show',
  'no_show',
  'checkout_started',
  'purchase',
  'offer',
  'offer_viewed',
]);

export const OPENPANEL_EXTRA_ALLOWLIST = ANALYTICS_EXTRA_ALLOWLIST;

const ALLOWED_EVENT_SET = new Set(Object.values(OPENPANEL_EVENTS));
const FORBIDDEN_EVENT_SET = new Set(FORBIDDEN_OPENPANEL_EVENTS);

const URLISH = /^(?:https?:)?\/\/|^\//;
const ADDRESS_SHAPED = /[^\s@]+@[^\s@.]+\.[a-z]{2,}/i;
const PHONE_SHAPED = /^\+?[0-9][0-9\s().-]{6,18}[0-9]$/;

/**
 * Reduce any URL-shaped value to origin + pathname (no query, no fragment).
 * Empty input stays empty so we never fabricate a self-referrer.
 * @param {unknown} value
 * @param {string} [baseHref]
 * @returns {string}
 */
export function sanitizeOpenPanelUrl(value, baseHref) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value, baseHref || 'https://webinar.unlockedecom.co/');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return sanitizeAttrValue(`${parsed.origin}${parsed.pathname}`, 220);
  } catch {
    return sanitizeAttrValue(value.split('#')[0].split('?')[0], 220);
  }
}

/**
 * @param {unknown} eventName
 * @returns {boolean}
 */
export function isAllowedOpenPanelEvent(eventName) {
  if (typeof eventName !== 'string' || !eventName) return false;
  if (FORBIDDEN_EVENT_SET.has(eventName)) return false;
  return ALLOWED_EVENT_SET.has(eventName);
}

/**
 * webinar_registered is only legal after the real persisted-write ACK.
 * @param {{ registrationConfirmed?: boolean, ackComplete?: boolean }} [input]
 */
export function shouldEmitWebinarRegistered(input = {}) {
  return input.registrationConfirmed === true && input.ackComplete === true;
}

/**
 * visitor_id is the only legal profileId. Reject empty, PII-shaped or
 * overlong values so an email/phone can never identify the profile.
 * @param {unknown} visitorId
 * @returns {string}
 */
export function resolveOpenPanelProfileId(visitorId) {
  const id = sanitizeAttrValue(visitorId, 80);
  if (!id) return '';
  if (ADDRESS_SHAPED.test(id) || PHONE_SHAPED.test(id)) return '';
  if (id.includes('@') || /\s/.test(id)) return '';
  if (!/^vid_[A-Za-z0-9._-]+$/.test(id)) return '';
  return id;
}

/**
 * Flatten allowlisted attribution (current wins, first-touch fills gaps).
 * @param {{ first_touch?: Record<string, string>, current?: Record<string, string> }} attribution
 * @returns {Record<string, string>}
 */
export function flattenAllowlistedAttribution(attribution = {}) {
  const first = extractAllowlistedParams(attribution.first_touch || {});
  const current = extractAllowlistedParams(attribution.current || {});
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of ATTRIBUTION_ALLOWLIST) {
    const value = current[key] || first[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * PII-safe properties attached to every OpenPanel event.
 * Never includes name, email, phone, Instagram, form answers, raw URL,
 * query string or full referrer.
 * @param {{
 *   attribution?: {
 *     visitor_id?: string,
 *     session_id?: string,
 *     first_touch?: Record<string, string>,
 *     current?: Record<string, string>,
 *   },
 *   page?: { path?: string, referrer?: string, title?: string },
 *   extra?: Record<string, unknown>,
 * }} [input]
 */
export function buildOpenPanelProperties(input = {}) {
  const attribution = input.attribution || {};
  const page = sanitizePageContext(input.page || {});
  const visitor_id = sanitizeAttrValue(attribution.visitor_id, 80);
  const session_id = sanitizeAttrValue(attribution.session_id, 80);

  /** @type {Record<string, unknown>} */
  const props = {
    landing_id: OPENPANEL_LANDING_ID,
    funnel: OPENPANEL_FUNNEL,
    variant: OPENPANEL_VARIANT,
    environment: OPENPANEL_ENVIRONMENT,
    surface: OPENPANEL_SURFACE,
    visitor_id,
    session_id,
    path: page.path,
    __referrer: sanitizeOpenPanelUrl(page.referrer),
    ...flattenAllowlistedAttribution(attribution),
  };

  if (input.extra && typeof input.extra === 'object' && !Array.isArray(input.extra)) {
    const extra = /** @type {Record<string, unknown>} */ (input.extra);
    for (const key of OPENPANEL_EXTRA_ALLOWLIST) {
      if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
      if (isPiiLikeKey(key)) continue;
      const raw = extra[key];
      if (typeof raw === 'string') {
        const bounded = sanitizeAttrValue(raw, MAX_ANALYTICS_EXTRA_VALUE_LENGTH);
        if (bounded) props[key] = bounded;
      } else if (typeof raw === 'number' || typeof raw === 'boolean') {
        props[key] = raw;
      }
    }
  }

  return props;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function valueLeaks(value) {
  if (typeof value !== 'string' || !value) return false;
  if (ADDRESS_SHAPED.test(value)) return true;
  if (URLISH.test(value) && (value.includes('?') || value.includes('#'))) return true;
  return false;
}

/**
 * Fail-closed inspector: PII-like keys, query/fragment URLs, or over-deep trees.
 * @param {unknown} payload
 * @param {number} [depth]
 * @returns {boolean}
 */
export function openPanelPayloadHasPii(payload, depth = 0) {
  if (depth > MAX_PII_INSPECT_DEPTH) return true;
  if (payload == null) return false;
  if (typeof payload === 'string') return valueLeaks(payload);
  if (typeof payload !== 'object') return false;

  if (Array.isArray(payload)) {
    return payload.some((item) => openPanelPayloadHasPii(item, depth + 1));
  }

  const obj = /** @type {Record<string, unknown>} */ (payload);
  for (const [key, value] of Object.entries(obj)) {
    // The installed SDK's own envelope names the event under `name`
    // (e.g. { type: 'track', payload: { name: 'screen_view', ... } }), not
    // eventName/event_name like our first-party sink. isPiiLikeKey('name')
    // otherwise treats every event as a leaked person name and the SDK's
    // `filter` hook silently drops it before /api/track is ever requested.
    // Only exempt it when the value is one of this surface's fixed,
    // developer-controlled event ids — never free-form input — so a real
    // personal name under an unrelated `name` key still fails closed.
    if (key === 'name' && ALLOWED_EVENT_SET.has(value)) continue;
    if (isPiiLikeKey(key)) return true;
    if (openPanelPayloadHasPii(value, depth + 1)) return true;
  }
  return false;
}

/**
 * SDK `filter` hook: re-sanitize URL-shaped strings, drop the payload if
 * anything still looks like PII or a raw query/fragment.
 * Returning false makes the SDK drop the event.
 * @param {unknown} envelope
 * @returns {boolean}
 */
export function openPanelPrivacyFilter(envelope) {
  try {
    sanitizeUrlTree(envelope, 0);
    return !openPanelPayloadHasPii(envelope);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} node
 * @param {number} depth
 */
function sanitizeUrlTree(node, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_PII_INSPECT_DEPTH) return;
  const obj = /** @type {Record<string, unknown>} */ (node);
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && URLISH.test(value)) {
      obj[key] = sanitizeOpenPanelUrl(value);
    } else if (value && typeof value === 'object') {
      sanitizeUrlTree(value, depth + 1);
    }
  }
}

/**
 * Official script-tag queue shim. `op1.js` expects this exact Proxy shape.
 * @param {{ op?: unknown }} [win]
 * @returns {(...args: unknown[]) => unknown}
 */
export function installOpenPanelQueue(win = globalThis) {
  const host = win && typeof win === 'object' ? win : {};
  if (typeof host.op === 'function') {
    return /** @type {(...args: unknown[]) => unknown} */ (host.op);
  }

  const q = [];
  const op = new Proxy(
    function () {
      if (arguments.length) q.push([].slice.call(arguments));
    },
    {
      get(target, key) {
        return key === 'q' ? q : function () {
          q.push([key].concat([].slice.call(arguments)));
        };
      },
      has(target, key) {
        return key === 'q';
      },
    },
  );
  host.op = op;
  return op;
}

/**
 * Inject the self-hosted SDK once. Failures never throw.
 * @param {Document|{ getElementById?: Function, createElement?: Function, head?: { appendChild?: Function }, documentElement?: { appendChild?: Function } }|null} [doc]
 */
export function ensureOpenPanelSdk(doc) {
  try {
    if (!doc || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') {
      return false;
    }
    if (doc.getElementById('op-sdk-script')) return true;
    const script = doc.createElement('script');
    script.id = 'op-sdk-script';
    script.src = OPENPANEL_SDK_SRC;
    script.async = true;
    script.defer = true;
    const parent = doc.head || doc.documentElement;
    if (parent && typeof parent.appendChild === 'function') {
      parent.appendChild(script);
      return true;
    }
  } catch {
    // fire-and-forget
  }
  return false;
}

/**
 * Typed OpenPanel client. Failures never propagate to the caller.
 * @param {{
 *   op?: (...args: unknown[]) => unknown,
 *   win?: { op?: unknown, document?: Document },
 *   document?: Document,
 *   loadSdk?: boolean,
 *   attributionSnapshot?: () => {
 *     visitor_id?: string,
 *     session_id?: string,
 *     first_touch?: Record<string, string>,
 *     current?: Record<string, string>,
 *   },
 *   pageContext?: () => { path?: string, referrer?: string, title?: string },
 * }} [deps]
 */
export function createOpenPanelClient(deps = {}) {
  const win = deps.win || (typeof globalThis !== 'undefined' ? globalThis : {});
  const doc =
    deps.document ||
    (deps.win && deps.win.document) ||
    (typeof document !== 'undefined' ? document : null);
  const loadSdk = deps.loadSdk !== false;
  const attributionSnapshot =
    deps.attributionSnapshot ||
    (() => ({ visitor_id: '', session_id: '', first_touch: {}, current: {} }));
  const pageContext = deps.pageContext || (() => ({ path: '/', referrer: '', title: '' }));

  const op =
    typeof deps.op === 'function' ? deps.op : installOpenPanelQueue(win);

  let initialized = false;
  let screenViewed = false;
  let formStarted = false;
  let registered = false;
  let thankYouViewed = false;

  function safeCall(method, ...args) {
    try {
      return op(method, ...args);
    } catch {
      return null;
    }
  }

  function currentProps(extra) {
    return buildOpenPanelProperties({
      attribution: attributionSnapshot(),
      page: pageContext(),
      extra,
    });
  }

  function init() {
    if (initialized) return true;
    try {
      const snapshot = attributionSnapshot();
      const profileId = resolveOpenPanelProfileId(snapshot.visitor_id);
      safeCall('init', {
        apiUrl: OPENPANEL_API_URL,
        clientId: OPENPANEL_CLIENT_ID,
        trackScreenViews: false,
        trackHashChanges: false,
        trackOutgoingLinks: false,
        trackAttributes: false,
        filter: openPanelPrivacyFilter,
        ...(profileId ? { profileId } : {}),
      });
      if (profileId) {
        safeCall('identify', { profileId });
      }
      const globals = currentProps();
      if (!openPanelPayloadHasPii(globals)) {
        safeCall('setGlobalProperties', globals);
      }
      if (loadSdk) ensureOpenPanelSdk(doc);
      initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Explicit sanitized screen view. Never uses the SDK auto tracker.
   */
  function trackScreenView() {
    if (screenViewed) return false;
    try {
      init();
      const page = sanitizePageContext(pageContext());
      const path = page.path || '/';
      const props = currentProps();
      if (openPanelPayloadHasPii(props) || openPanelPayloadHasPii(path)) return false;
      safeCall('screenView', path, props);
      screenViewed = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} eventName
   * @param {Record<string, unknown>} [extra]
   */
  function track(eventName, extra) {
    try {
      if (!isAllowedOpenPanelEvent(eventName)) return false;
      init();
      const props = currentProps(extra);
      if (openPanelPayloadHasPii(props)) return false;
      safeCall('track', eventName, props);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {unknown} cta
   */
  function trackCtaClicked(cta) {
    const label = sanitizeAttrValue(cta, MAX_ANALYTICS_EXTRA_VALUE_LENGTH);
    return track(OPENPANEL_EVENTS.CTA_CLICKED, label ? { cta: label } : {});
  }

  function trackFormStarted() {
    if (formStarted) return false;
    const ok = track(OPENPANEL_EVENTS.FORM_STARTED);
    if (ok) formStarted = true;
    return ok;
  }

  /**
   * Only after the real webhook ACK. Never on submit, validation or /gracias.
   * @param {{ registrationConfirmed?: boolean, ackComplete?: boolean, eventId?: string }} [input]
   */
  function trackRegistered(input = {}) {
    if (registered) return false;
    if (!shouldEmitWebinarRegistered(input)) return false;
    const eventId = sanitizeAttrValue(input.eventId, MAX_ANALYTICS_EXTRA_VALUE_LENGTH);
    const ok = track(
      OPENPANEL_EVENTS.REGISTERED,
      eventId ? { event_id: eventId } : {},
    );
    if (ok) registered = true;
    return ok;
  }

  function trackThankYouViewed() {
    if (thankYouViewed) return false;
    const ok = track(OPENPANEL_EVENTS.THANK_YOU_VIEWED);
    if (ok) thankYouViewed = true;
    return ok;
  }

  return {
    init,
    track,
    trackScreenView,
    trackCtaClicked,
    trackFormStarted,
    trackRegistered,
    trackThankYouViewed,
  };
}
