/**
 * Faz o painel de uma página `watch`/`live` do YouTube mostrar só o player
 * (pseudo-tela cheia por CSS, sem chat/cabeçalho/sugestões) e pula anúncios.
 */

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

/** Mundo isolado do script de anúncios (distinto de VIDEO_RECT_WORLD). */
export const YOUTUBE_WORLD = 1003

/** Padrões de rede de anúncio cancelados na sessão do Quadra. */
export const YOUTUBE_AD_URL_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://www.youtube.com/pagead/*',
  '*://www.youtube.com/api/stats/ads*',
  '*://www.youtube.com/get_midroll_info*',
]

/** True para páginas `watch` ou `/live/ID` do YouTube (origem extra via env só para fixtures). */
export function isYoutubeWatchUrl(url: string, extraOrigin: string | undefined = process.env.QUADRA_YOUTUBE_WATCH_ORIGIN): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const isWatchPath = parsed.pathname === '/watch' || /^\/live\/[^/]+/.test(parsed.pathname)
  if (!isWatchPath) return false
  if (parsed.protocol === 'https:' && YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return true
  if (extraOrigin) {
    try {
      return parsed.origin === new URL(extraOrigin).origin
    } catch {
      return false
    }
  }
  return false
}

export const youtubePlayerCss = `
html, body { overflow: hidden !important; background: #000 !important; }
#movie_player {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 2147483000 !important;
  background: #000 !important;
}
#masthead-container, #secondary, #below, #chat, ytd-live-chat-frame, #related,
ytd-merch-shelf-renderer, .ytp-ad-overlay-container, ytd-ad-slot-renderer,
#player-ads, .ytp-paid-content-overlay {
  display: none !important;
}
`

export const youtubeAdSkipScript = `(() => {
  if (window.__quadraYt) { window.dispatchEvent(new Event('resize')); return }
  window.__quadraYt = true
  let saved = null
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button__text'
  const tick = () => {
    const player = document.querySelector('#movie_player')
    const video = document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video')
    document.querySelectorAll('ytd-live-chat-frame iframe, #chatframe').forEach((el) => el.remove())
    if (!player || !video) return
    const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')
    if (inAd) {
      const skip = player.querySelector(SKIP)
      if (skip) {
        const button = skip.closest('button') || skip
        button.click()
        return
      }
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate }
      video.muted = true
      try { video.playbackRate = 16 } catch {}
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
        try { video.currentTime = video.duration } catch {}
      }
    } else if (saved) {
      video.muted = saved.muted
      try { video.playbackRate = saved.rate } catch {}
      saved = null
    }
  }
  setInterval(tick, 300)
  const target = document.querySelector('#movie_player')
  if (target) new MutationObserver(tick).observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
  tick()
  window.dispatchEvent(new Event('resize'))
})()`
