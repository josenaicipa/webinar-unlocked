/** Exact live class start (martes 18 de agosto de 2026, 7:00 PM Colombia). */
export const WEBINAR_START_ISO = '2026-08-19T00:00:00Z';

/** Zoom-verified end: 120-minute class (9:00 PM Colombia). */
export const WEBINAR_END_ISO = '2026-08-19T02:00:00Z';

export const WEBINAR_TITLE = 'Protocolo Unlocked — Clase en vivo';

export const WEBINAR_LOCATION = 'En vivo en línea';

/**
 * Public details without capacity, email or messaging claims.
 * Duration is reflected only via calendar start/end timestamps, not prose hours claims.
 */
export const WEBINAR_DETAILS =
  'Clase en vivo Protocolo Unlocked. Martes 18 de agosto de 2026, 7:00 PM hora de Colombia. En vivo y sin costo de inscripción.';

/**
 * Format an ISO instant as YYYYMMDDTHHMMSSZ for Google Calendar / ICS.
 * @param {string} [iso]
 */
export function toUtcBasic(iso = WEBINAR_START_ISO) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return iso === WEBINAR_END_ISO ? '20260819T020000Z' : '20260819T000000Z';
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

/**
 * Google Calendar template URL using the owner-verified 60-minute range.
 * @param {{
 *   title?: string,
 *   startIso?: string,
 *   endIso?: string,
 *   details?: string,
 *   location?: string,
 * }} [opts]
 */
export function buildGoogleCalendarUrl(opts = {}) {
  const title = opts.title || WEBINAR_TITLE;
  const start = toUtcBasic(opts.startIso || WEBINAR_START_ISO);
  const end = toUtcBasic(opts.endIso || WEBINAR_END_ISO);
  const dates = `${start}/${end}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
    details: opts.details || WEBINAR_DETAILS,
    location: opts.location || WEBINAR_LOCATION,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * @param {string} value
 */
function icsEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * RFC-compliant ICS event with owner-verified DTSTART/DTEND (60 minutes).
 * @param {{
 *   title?: string,
 *   startIso?: string,
 *   endIso?: string,
 *   details?: string,
 *   location?: string,
 *   uid?: string,
 * }} [opts]
 */
export function buildIcsContent(opts = {}) {
  const start = toUtcBasic(opts.startIso || WEBINAR_START_ISO);
  const end = toUtcBasic(opts.endIso || WEBINAR_END_ISO);
  const title = icsEscape(opts.title || WEBINAR_TITLE);
  const details = icsEscape(opts.details || WEBINAR_DETAILS);
  const location = icsEscape(opts.location || WEBINAR_LOCATION);
  const uid = icsEscape(opts.uid || `protocolo-unlocked-${start}@webinar.unlockedecom.co`);
  const stamp = toUtcBasic(new Date().toISOString());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Unlocked Ecom//Protocolo Unlocked//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${details}`,
    `LOCATION:${location}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * @param {{ title?: string, startIso?: string, endIso?: string, details?: string, location?: string, uid?: string }} [opts]
 */
export function buildIcsDataUri(opts = {}) {
  const ics = buildIcsContent(opts);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
