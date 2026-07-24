/**
 * Decide whether the mobile sticky CTA should be visible.
 * It appears only after the hero bottom has passed the sticky header offset.
 * Invalid geometry fails closed (hidden).
 *
 * @param {number} heroBottom
 * @param {number} [revealOffset]
 * @returns {boolean}
 */
export function shouldShowStickyCta(heroBottom, revealOffset = 0) {
  if (!Number.isFinite(heroBottom) || !Number.isFinite(revealOffset)) return false;
  return heroBottom <= revealOffset;
}

/**
 * Load testimonial players when the proof section intersects or when the
 * viewport-scan fallback confirms the card is near view. This prevents permanent
 * placeholders when IntersectionObserver fails without loading all players at startup.
 *
 * @param {boolean} isIntersecting
 * @param {boolean} isNearViewport
 * @returns {boolean}
 */
export function shouldLoadTestimonials(isIntersecting, isNearViewport) {
  return Boolean(isIntersecting || isNearViewport);
}
