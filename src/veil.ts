// Veils drawn by the overlay over native video views.
//
// The overlay window sits above the main window, so an opaque element here
// hides whatever a WebContentsView is doing underneath. Layout changes cover
// the moving videos, let the main process apply a single setBounds, and lift
// the veil only after it acknowledges the layout. Videos are never moved
// frame by frame.

import { motionAllowed, motionLayer, type ScreenRect } from './motion'

export type VeilFrame = { from: ScreenRect; to: ScreenRect; label: string }
export type Veil = { release: () => void; cancel: () => void }

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const FRAME_MS = 240
const RELEASE_MS = 180

let appliedSeq = -1
const waiters = new Set<{ seq: number; done: () => void }>()

export function noteLayoutApplied(seq: number): void {
  if (!Number.isSafeInteger(seq)) return
  appliedSeq = Math.max(appliedSeq, seq)
  for (const waiter of [...waiters]) {
    if (waiter.seq <= appliedSeq) waiter.done()
  }
}

/** Resolves once the main process applied layout `seq` (or a later one), or after `timeoutMs`. */
export function waitForLayoutApplied(seq: number, timeoutMs: number): Promise<void> {
  if (appliedSeq >= seq) return Promise.resolve()
  return new Promise((resolve) => {
    const waiter = {
      seq,
      done: () => {
        window.clearTimeout(timer)
        waiters.delete(waiter)
        resolve()
      },
    }
    const timer = window.setTimeout(waiter.done, timeoutMs)
    waiters.add(waiter)
  })
}

function placed(className: string, rect: ScreenRect): HTMLElement {
  const element = document.createElement('div')
  element.className = className
  Object.assign(element.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
  })
  return element
}

/**
 * Covers `tiles` (or the whole viewport) with an opaque veil. Frames slide from
 * their old to their new rect to show where each game went. Returns null when
 * motion is not allowed, in which case callers simply snap as before.
 */
export function coverRects(tiles: ScreenRect[] | 'viewport', frames: VeilFrame[] = []): Veil | null {
  if (!motionAllowed()) return null
  const root = document.createElement('div')
  root.className = 'motion-ghost layout-veil'
  if (tiles === 'viewport') {
    const tile = document.createElement('div')
    tile.className = 'layout-veil__tile layout-veil__tile--viewport'
    root.appendChild(tile)
  } else {
    for (const rect of tiles) root.appendChild(placed('layout-veil__tile', rect))
  }
  const frameElements = frames.map((frame) => {
    const element = placed('layout-veil__frame', frame.to)
    element.textContent = frame.label
    root.appendChild(element)
    return { element, frame }
  })
  motionLayer().appendChild(root)

  if (typeof root.animate === 'function') {
    for (const { element, frame: { from, to } } of frameElements) {
      if (to.width <= 0 || to.height <= 0) continue
      element.animate([
        {
          transformOrigin: '0 0',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: FRAME_MS, easing: EASE_OUT })
    }
  }

  let finished = false
  return {
    cancel() {
      if (finished) return
      finished = true
      root.remove()
    },
    release() {
      if (finished) return
      finished = true
      if (typeof root.animate !== 'function') {
        root.remove()
        return
      }
      const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RELEASE_MS, easing: EASE_OUT, fill: 'forwards' })
      fade.finished.then(() => root.remove(), () => root.remove())
      window.setTimeout(() => root.remove(), RELEASE_MS + 200)
    },
  }
}

export const VEIL_FRAME_MS = FRAME_MS
