/**
 * Opening many BLL players at once (batch of up to 18) makes some of them stay black: every
 * player negotiates its stream in the same instant. Loads are spaced out, and a player that
 * shows no running video after a while is reloaded a couple of times.
 */

/** Gap between two sports-player loads. */
export const PLAYER_LOAD_SPACING_MS = 200
/** How often a freshly loaded player is checked for a running video. */
export const PLAYBACK_CHECK_INTERVAL_MS = 3000
/** No running video after this long since the page loaded → reload. */
export const PLAYBACK_TIMEOUT_MS = 25000
/** Automatic reloads per opened URL; after that the user reopens it by hand. */
export const PLAYBACK_MAX_RETRIES = 2

/** Hands out start delays so that consecutive loads are at least `spacingMs` apart. */
export function createLoadPacer(spacingMs: number, now: () => number = Date.now) {
  let nextSlot = 0
  return {
    /** Milliseconds to wait before starting the next load. */
    reserve(): number {
      const current = now()
      const start = Math.max(current, nextSlot)
      nextSlot = start + spacingMs
      return start - current
    },
  }
}

/** Read-only: true when some <video> on the page is actually playing. */
export const playbackProbeScript = `(() => Array.from(document.querySelectorAll('video'))
  .some((video) => video.readyState >= 2 && !video.paused && !video.ended && video.currentTime > 0))()`
