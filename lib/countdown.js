/** Target instant for the live class (Thursday 30 July 2026, 8:00 PM Colombia). */
export const TARGET_INSTANT_ISO = '2026-07-31T01:00:00Z';

const LABELS = {
  days: 'días',
  hours: 'horas',
  minutes: 'minutos',
  seconds: 'segundos',
};

/**
 * @param {Date|number|string} now
 * @param {string} [targetIso]
 * @returns {{ expired: boolean, days: number, hours: number, minutes: number, seconds: number, totalMs: number }}
 */
export function getCountdownParts(now, targetIso = TARGET_INSTANT_ISO) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const targetMs = new Date(targetIso).getTime();
  const totalMs = targetMs - nowMs;

  if (!Number.isFinite(nowMs) || !Number.isFinite(targetMs) || totalMs <= 0) {
    return {
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: Math.min(0, Number.isFinite(totalMs) ? totalMs : 0),
    };
  }

  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    expired: false,
    days,
    hours,
    minutes,
    seconds,
    totalMs,
  };
}

/**
 * @param {'days'|'hours'|'minutes'|'seconds'} unit
 * @returns {string}
 */
export function formatCountdownLabel(unit) {
  return LABELS[unit] ?? unit;
}
