const PLAYER_BASE =
  'https://scripts.converteai.net/8ba86d68-f33e-4b11-b5af-9ee741dc655d/players';

/** Approved Vturb testimonial player IDs (order preserved). */
export const TESTIMONIAL_IDS = Object.freeze([
  '699c655f9730614acbab042a',
  '6973e0b51aa57af6574f5db0',
  '6973e119f6f1b1efe6db5e2e',
  '6973e17c89efec3d227bc65e',
  '6973e1b89d7c4ee5433b5707',
  '6973e1ec050bb6dd3c31d9c1',
]);

/**
 * @param {unknown} id
 * @returns {string}
 */
function assertId(id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Player id is required');
  }
  return id.trim();
}

/**
 * @param {string} id
 * @returns {string}
 */
export function buildPlayerScriptUrl(id) {
  const safe = assertId(id);
  return `${PLAYER_BASE}/${safe}/v4/player.js`;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function buildPlayerElementId(id) {
  const safe = assertId(id);
  return `vid-${safe}`;
}

/**
 * @param {readonly string[]} [ids]
 * @returns {{ id: string, elementId: string, scriptUrl: string }[]}
 */
export function buildLazyPlayerDescriptors(ids = TESTIMONIAL_IDS) {
  return ids.map((id) => ({
    id,
    elementId: buildPlayerElementId(id),
    scriptUrl: buildPlayerScriptUrl(id),
  }));
}
