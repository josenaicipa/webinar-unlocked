/** Canonical VTurb workspace from mentoria.unlockedecom.co/newbuyer */
export const VTURB_WORKSPACE_ID = '7baaaf1a-6c98-44e5-9d7a-422164a91a0a';

const PLAYER_BASE =
  `https://scripts.converteai.net/${VTURB_WORKSPACE_ID}/players`;

/** Approved Vturb testimonial player IDs (order preserved from source markup). */
export const TESTIMONIAL_IDS = Object.freeze([
  '67639d11c30331c3b7e9e031',
  '67639d1ad30d7bd0bf71d90f',
  '67639d02d30d7bd0bf71d901',
  '68f900ed374e2f1185528ebe',
  '67639d0a4c30e94b5ab57cfc',
  '67639cf68f3142d2d0991a1f',
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
