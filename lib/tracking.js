export const META_PIXEL_ID = '4207040806214515';
export const CLARITY_PROJECT_ID = 'tvcad381sd';

/**
 * Lead fires only after a confirmed registration success, never on direct thank-you.
 * @param {{ registrationConfirmed?: boolean, isThankYouDirectVisit?: boolean }} input
 */
export function shouldFireMetaLead(input = {}) {
  if (!input.registrationConfirmed) return false;
  if (input.isThankYouDirectVisit) return false;
  return true;
}

/**
 * @param {string} eventId
 * @returns {{ eventID: string }}
 */
export function buildMetaLeadOptions(eventId) {
  return { eventID: String(eventId || '') };
}

/**
 * @param {{ fbq?: (...args: unknown[]) => void }} [deps]
 */
export function createMetaPixelController(deps = {}) {
  const fbq =
    typeof deps.fbq === 'function'
      ? deps.fbq
      : (...args) => {
          try {
            if (typeof globalThis !== 'undefined' && typeof globalThis.fbq === 'function') {
              globalThis.fbq(...args);
            }
          } catch {
            // never block UX
          }
        };

  function trackPageView() {
    try {
      fbq('track', 'PageView');
    } catch {
      // ignore
    }
  }

  /**
   * @param {{ registrationConfirmed?: boolean, isThankYouDirectVisit?: boolean, eventId?: string }} input
   */
  function trackLead(input = {}) {
    if (
      !shouldFireMetaLead({
        registrationConfirmed: input.registrationConfirmed,
        isThankYouDirectVisit: input.isThankYouDirectVisit,
      })
    ) {
      return false;
    }
    const eventId = String(input.eventId || '');
    if (!eventId) return false;
    try {
      fbq('track', 'Lead', {}, buildMetaLeadOptions(eventId));
      return true;
    } catch {
      return false;
    }
  }

  return { trackPageView, trackLead };
}

/**
 * Load Clarity after idle/interaction — never blocks first paint critically.
 * @param {{ projectId?: string, document?: Document, win?: Window }} [opts]
 */
export function loadClarityDeferred(opts = {}) {
  const projectId = opts.projectId || CLARITY_PROJECT_ID;
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  if (!doc || !win || !projectId) return;

  let loaded = false;
  function inject() {
    if (loaded) return;
    loaded = true;
    try {
      (function (c, l, a, r, i, t, y) {
        c[a] =
          c[a] ||
          function () {
            (c[a].q = c[a].q || []).push(arguments);
          };
        t = l.createElement(r);
        t.async = 1;
        t.src = 'https://www.clarity.ms/tag/' + i;
        y = l.getElementsByTagName(r)[0];
        y.parentNode.insertBefore(t, y);
      })(win, doc, 'clarity', 'script', projectId);
    } catch {
      // ignore
    }
  }

  const ric = win.requestIdleCallback;
  if (typeof ric === 'function') {
    ric.call(win, inject, { timeout: 4000 });
  } else {
    win.setTimeout(inject, 2500);
  }

  const once = () => {
    inject();
    win.removeEventListener('pointerdown', once);
    win.removeEventListener('keydown', once);
    win.removeEventListener('scroll', once);
  };
  win.addEventListener('pointerdown', once, { once: true, passive: true });
  win.addEventListener('keydown', once, { once: true });
  win.addEventListener('scroll', once, { once: true, passive: true });
}
