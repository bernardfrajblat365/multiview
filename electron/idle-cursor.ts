// Hiding a still cursor over the players. Chromium only redraws the cursor without a mouse move in the page that
// has the focus (an active page), and only when that page's style changes. So, on an idle screen, the player under
// the cursor takes the focus and its cursor rule changes once more after that ("nudge"). No Electron import here,
// so the logic is unit-tested.

export type FrameCursorMode = 'hide' | 'show' | 'nudge'

/**
 * Same "no cursor" in two spellings, so a nudge is a real style change without ever showing the cursor:
 * an empty SVG (falls back to `none` if the page's CSP blocks data: images).
 */
export const NUDGED_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E") 0 0, none`

/**
 * Hidden cursor in every frame of a player: `insertCSS` only reaches the main frame (many players live in an iframe)
 * and loses to the page's own `!important` cursor rules. A constructed sheet (not blocked by the page's CSP, removable
 * at will) whose ids in `:not()` outrank those rules. `nudge` swaps the rule between its two spellings.
 */
export function frameCursorScript(mode: FrameCursorMode): string {
  return `(() => {
    const key = Symbol.for('quadra-hidden-cursor')
    const root = ':root' + ':not(#quadra)'.repeat(5)
    const rule = (cursor) => root + ', ' + root + ' * { cursor: ' + cursor + ' !important; }'
    let sheet = window[key]
    const mode = ${JSON.stringify(mode)}
    if (mode === 'hide') {
      if (!sheet) {
        sheet = new CSSStyleSheet()
        sheet.replaceSync(rule('none'))
        Object.defineProperty(window, key, { value: sheet })
      }
      if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    } else if (mode === 'nudge') {
      if (!sheet || !document.adoptedStyleSheets.includes(sheet)) return
      const nudged = sheet.quadraNudged === true
      sheet.replaceSync(rule(nudged ? 'none' : ${JSON.stringify(NUDGED_CURSOR)}))
      sheet.quadraNudged = !nudged
    } else if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet)
    }
  })()`
}

/** True when the frame has the focus on a field the user types in (a chat, a search box, a login). */
export const EDITING_SCRIPT = `(() => {
  if (!document.hasFocus()) return false
  let el = document.activeElement
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|image|color|file)$/i.test(el.type || '')
})()`

export type IdleFocusInput<T> = {
  /** The Quadra (overlay or players window) is the foreground app: never steal the focus from another app. */
  quadraActive: boolean
  /** The player under the mouse cursor, if any. */
  underCursor: T | null
  /** The player that has the focus now, if any. */
  focused: T | null
  /** The focused player has a text field focused (the user may be typing there). */
  focusedEditing: boolean
}

/** Which player takes the focus when the screen goes idle, or null to leave the focus where it is. */
export function idleFocusTarget<T>(input: IdleFocusInput<T>): T | null {
  if (!input.quadraActive || input.underCursor === null) return null
  if (input.underCursor === input.focused) return null
  if (input.focused !== null && input.focusedEditing) return null
  return input.underCursor
}
