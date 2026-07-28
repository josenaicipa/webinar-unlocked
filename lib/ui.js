/**
 * Run independent startup steps without allowing one failure to abort later
 * initializers. Error reporting is also isolated so diagnostics cannot break boot.
 *
 * @param {Array<[string, () => void]>} initializers
 * @param {(name: string, error: Error) => void} [onError]
 */
export function runInitializersSafely(initializers, onError = () => {}) {
  for (const [name, initialize] of initializers) {
    try {
      initialize();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      try {
        onError(name, error);
      } catch {
        // Diagnostics must never prevent the remaining components from booting.
      }
    }
  }
}

/**
 * Decide whether the mobile sticky CTA should be visible.
 * It appears only after the hero bottom has passed the sticky header offset.
 * Invalid geometry fails closed (hidden), avoiding a duplicate CTA over the
 * now-above-the-fold primary hero action.
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
