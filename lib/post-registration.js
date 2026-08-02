/**
 * Post-registration destination is a fixed owner-supplied invite.
 * Never derived from query params, form inputs, API responses, storage, or referrer.
 */

/** Exact fixed WhatsApp group invite supplied by Jose (grupo "Protocolo Unlocked"). */
export const FIXED_WHATSAPP_GROUP_INVITE =
  'https://chat.whatsapp.com/DmcL1GhKp0aJhQUxV2HCgy';

/** Accessible confirmation page kept as fallback; not the primary post-success destination. */
export const FALLBACK_THANK_YOU_PATH = '/gracias/';

/**
 * Always returns the fixed owner invite. Callers may pass arbitrary noise; it is ignored.
 * @param {...unknown} _ignored
 * @returns {string}
 */
export function getPostSuccessRedirectUrl(..._ignored) {
  return FIXED_WHATSAPP_GROUP_INVITE;
}

/**
 * Accessible copy announced the instant submit starts, before the registration
 * webhook ACK arrives. Tells the user the registration is processing and that a
 * confirmed write redirects them to WhatsApp to finish — so the wait for the
 * webhook is never silent. Rendered only via `main.js` into `#form-status`
 * (role="status", aria-live="polite"); never baked into static index.html markup
 * (see the fixed-invite allowlist in tests/landing-contract.test.js).
 */
export const SUBMIT_PROCESSING_MESSAGE =
  'Estamos procesando tu registro. No cierres esta ventana: en cuanto se confirme, te llevaremos a WhatsApp para completar tu registro.';

/** Visible label on the submit button while a registration attempt is in flight. */
export const SUBMIT_PROCESSING_BUTTON_LABEL = 'Procesando tu registro…';
