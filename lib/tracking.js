export const META_PIXEL_ID = '4207040806214515';
export const CLARITY_PROJECT_ID = 'tvcad381sd';

/**
 * Meta CompleteRegistration is deliberately NOT emitted from the browser.
 *
 * The confirmed server path (n8n) is the single source of that conversion: it
 * fires the Conversions API event only after the registration writes succeed,
 * reusing the `event_id` this client already sends in the registration POST
 * (see `buildRegistrationPayload` in ./registration.js) as the dedup key.
 *
 * Both pages also set `autoConfig` to false before `init`, so Meta automatic
 * events cannot invent a registration success on this surface either. PageView
 * stays in the inline head snippet of each page and is unaffected.
 *
 * No browser-side pixel controller is exported on purpose: there is no client
 * code path left that can emit a registration conversion.
 */

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
