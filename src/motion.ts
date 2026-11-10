// Small motion helpers for the overlay UI.
//
// Rules (see the animation plan):
// - only transform and opacity are animated;
// - state and DOM change synchronously; motion is purely visual;
// - exit animations run on an inert clone ("ghost") inside a shadow root, so
//   document.querySelector (app code and tests) never sees it;
// - everything collapses to an instant cut under reduced motion, the
//   `motion=off` flag, or while the window is being resized.

const reducedMotionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

const RESIZE_SETTLE_MS = 150
let resizeTimer: number | null = null
let layer: HTMLElement | null = null
const pendingOneShots = new WeakMap<HTMLElement, (event: AnimationEvent) => void>()

export function initMotion(): void {
  const params = new URLSearchParams(window.location.search)
  if (params.get('motion') === 'off') document.documentElement.dataset.motion = 'off'
  prewarmGhostStyles()
}

/** Motion is allowed at all (user preference and test flag), regardless of resizes. */
export function motionAllowed(): boolean {
  return !reducedMotionQuery?.matches && document.documentElement.dataset.motion !== 'off'
}

export function motionEnabled(): boolean {
  return motionAllowed() && !document.documentElement.classList.contains('is-resizing')
}

/** Suspends every transition while the window is being resized or changes fullscreen. */
export function markResizing(): void {
  const root = document.documentElement
  if (!root.classList.contains('is-resizing')) root.classList.add('is-resizing')
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null
    root.classList.remove('is-resizing')
  }, RESIZE_SETTLE_MS)
}

export function motionLayer(): HTMLElement {
  if (layer?.isConnected) return layer
  layer = document.createElement('div')
  layer.id = 'motion-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)
  return layer
}

/** Restarts a one-shot CSS animation class and removes it when the animation ends. */
export function oneShot(element: Element | null | undefined, className: string): void {
  if (!(element instanceof HTMLElement) || !motionEnabled()) return
  const previous = pendingOneShots.get(element)
  if (previous) {
    element.removeEventListener('animationend', previous)
    element.removeEventListener('animationcancel', previous)
  }
  if (element.classList.contains(className)) {
    element.classList.remove(className)
    void element.offsetWidth
  }
  const done = (event: AnimationEvent) => {
    if (event.target !== element) return
    element.classList.remove(className)
    element.removeEventListener('animationend', done)
    element.removeEventListener('animationcancel', done)
    pendingOneShots.delete(element)
  }
  pendingOneShots.set(element, done)
  element.addEventListener('animationend', done)
  element.addEventListener('animationcancel', done)
  element.classList.add(className)
}

export type ScreenRect = { left: number; top: number; width: number; height: number }
export type FlipEntry = { el: HTMLElement; from: ScreenRect }

const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const activeFlips = new WeakMap<HTMLElement, Animation>()

/**
 * FLIP with the Web Animations API: the element is already at its final layout;
 * it is drawn from `from` and slides back to none. Only transform is animated,
 * nothing is written to inline styles, and the animation disappears when done.
 * Never call this on an element that carries a native video view.
 */
export function flip(entries: FlipEntry[], durationMs: number, onDone?: () => void): void {
  if (!motionEnabled() || typeof Element.prototype.animate !== 'function') {
    onDone?.()
    return
  }
  const animations: Animation[] = []
  for (const { el, from } of entries) {
    activeFlips.get(el)?.cancel()
    const to = el.getBoundingClientRect()
    if (to.width <= 0 || to.height <= 0 || from.width <= 0 || from.height <= 0) continue
    const dx = from.left - to.left
    const dy = from.top - to.top
    const sx = from.width / to.width
    const sy = from.height / to.height
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue
    const animation = el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: durationMs, easing: FLIP_EASING })
    activeFlips.set(el, animation)
    animations.push(animation)
  }
  if (!onDone) return
  if (animations.length === 0) {
    onDone()
    return
  }
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => onDone())
}

/** A short light flash over a screen rect (e.g. a panel that just received a player). */
export function flashRect(rect: ScreenRect, durationMs = 420): void {
  if (!motionEnabled() || rect.width <= 0 || rect.height <= 0) return
  const flash = document.createElement('div')
  flash.className = 'motion-ghost motion-flash'
  Object.assign(flash.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
  })
  motionLayer().appendChild(flash)
  window.setTimeout(() => flash.remove(), durationMs + 60)
}

let ghostSheet: CSSStyleSheet | null = null

/** The page's own rules, adopted by every ghost's shadow root (built once, lazily). */
function ghostStyleSheets(): CSSStyleSheet[] {
  if (!ghostSheet || ghostSheet.cssRules.length === 0) {
    const rules: string[] = []
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of [...sheet.cssRules]) {
          if (!(rule instanceof CSSImportRule)) rules.push(rule.cssText)
        }
      } catch {
        // Cross-origin sheets (web fonts) cannot be read; fonts still apply through the document.
      }
    }
    ghostSheet = new CSSStyleSheet()
    ghostSheet.replaceSync(rules.join('\n'))
  }
  return [ghostSheet]
}

/** Builds the ghost stylesheet while the app is idle, so the first exit does not pay for it. */
export function prewarmGhostStyles(): void {
  const build = () => { try { ghostStyleSheets() } catch { /* built on demand instead */ } }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(build, { timeout: 5000 })
  else window.setTimeout(build, 1000)
}

/**
 * Plays an exit animation on an inert copy of `element`. Call it right before the
 * real element is removed or hidden; the real DOM change stays synchronous.
 *
 * The copy keeps its classes (so it looks exactly like the original) but lives in
 * a shadow root: document.querySelector never reaches it, so neither app code nor
 * tests can find it. The exit itself is the `.is-leaving` rule of each component.
 */
export function ghostOut(element: Element | null | undefined, durationMs: number): void {
  if (!(element instanceof HTMLElement) || !element.isConnected || !motionEnabled()) return
  if (typeof element.attachShadow !== 'function' || typeof CSSStyleSheet === 'undefined') return
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const sources = [element, ...element.querySelectorAll<HTMLElement>('*')]
  const scrolled = sources.flatMap((node, index) => (node.scrollTop > 0 ? [[index, node.scrollTop] as const] : []))
  const zIndex = getComputedStyle(element).zIndex

  let sheets: CSSStyleSheet[]
  try {
    sheets = ghostStyleSheets()
  } catch {
    return
  }

  const ghost = element.cloneNode(true) as HTMLElement
  const copies = [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]
  ghost.classList.add('is-leaving')
  ghost.removeAttribute('hidden')
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    maxHeight: 'none',
    pointerEvents: 'none',
    zIndex: zIndex === 'auto' ? '' : zIndex,
  })

  const host = document.createElement('div')
  host.className = 'motion-ghost-host'
  host.inert = true
  host.setAttribute('aria-hidden', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.adoptedStyleSheets = sheets
  shadow.appendChild(ghost)
  motionLayer().appendChild(host)
  for (const [index, top] of scrolled) copies[index]?.scrollTo({ top })
  window.setTimeout(() => host.remove(), durationMs + 60)
}
