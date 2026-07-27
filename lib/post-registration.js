/**
 * Post-registration destination is a fixed owner-supplied invite.
 * Never derived from query params, form inputs, API responses, storage, or referrer.
 */

/** Exact fixed WhatsApp group invite supplied by Jose. */
export const FIXED_WHATSAPP_GROUP_INVITE =
  'https://chat.whatsapp.com/KUQx7C0AHFv4qmAYo5D41V?s=cl&p=i&ilr=2&amv=1';

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
