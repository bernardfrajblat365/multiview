import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { EDITING_SCRIPT, frameCursorScript, idleFocusTarget, NUDGED_CURSOR } from '../electron/idle-cursor.ts'

const A = 'panel-a'
const B = 'panel-b'

test('idleFocusTarget: o player sob o cursor ganha o foco quando o foco está em outro jogo', () => {
  assert.equal(idleFocusTarget({ quadraActive: true, underCursor: B, focused: A, focusedEditing: false }), B)
})

test('idleFocusTarget: o player sob o cursor ganha o foco quando nenhum player tem foco (foco na interface)', () => {
  assert.equal(idleFocusTarget({ quadraActive: true, underCursor: B, focused: null, focusedEditing: false }), B)
})

test('idleFocusTarget: nada muda quando o player sob o cursor já tem o foco', () => {
  assert.equal(idleFocusTarget({ quadraActive: true, underCursor: A, focused: A, focusedEditing: false }), null)
})

test('idleFocusTarget: não tira o foco de quem está digitando em outro player', () => {
  assert.equal(idleFocusTarget({ quadraActive: true, underCursor: B, focused: A, focusedEditing: true }), null)
})

test('idleFocusTarget: não rouba o foco de outro programa', () => {
  assert.equal(idleFocusTarget({ quadraActive: false, underCursor: B, focused: A, focusedEditing: false }), null)
})

test('idleFocusTarget: sem player sob o cursor, nada muda', () => {
  assert.equal(idleFocusTarget({ quadraActive: true, underCursor: null, focused: A, focusedEditing: false }), null)
})

class FakeSheet {
  text = ''
  replaceSync(text: string) { this.text = text }
}

function fakeFrame() {
  const document = { adoptedStyleSheets: [] as FakeSheet[] }
  const window: Record<PropertyKey, unknown> = {}
  const context = vm.createContext({ window, document, CSSStyleSheet: FakeSheet, Symbol, Object })
  return { document, run: (script: string) => vm.runInContext(script, context) }
}

test('frameCursorScript: esconder, cutucar duas vezes e mostrar', () => {
  const frame = fakeFrame()
  frame.run(frameCursorScript('hide'))
  assert.equal(frame.document.adoptedStyleSheets.length, 1)
  const sheet = frame.document.adoptedStyleSheets[0]
  assert.match(sheet.text, /cursor: none !important/)

  // The nudge changes the rule (a style change Chromium reacts to) but keeps the cursor invisible.
  frame.run(frameCursorScript('nudge'))
  assert.ok(sheet.text.includes(`cursor: ${NUDGED_CURSOR} !important`))
  assert.match(NUDGED_CURSOR, /, none$/, 'falls back to no cursor if the image is blocked')
  frame.run(frameCursorScript('nudge'))
  assert.match(sheet.text, /cursor: none !important/)

  // Hiding again doesn't add a second sheet.
  frame.run(frameCursorScript('hide'))
  assert.equal(frame.document.adoptedStyleSheets.length, 1)

  frame.run(frameCursorScript('show'))
  assert.equal(frame.document.adoptedStyleSheets.length, 0)
})

test('frameCursorScript: cutucar com o cursor visível não esconde nada', () => {
  const frame = fakeFrame()
  frame.run(frameCursorScript('nudge'))
  assert.equal(frame.document.adoptedStyleSheets.length, 0)
  frame.run(frameCursorScript('hide'))
  frame.run(frameCursorScript('show'))
  frame.run(frameCursorScript('nudge'))
  assert.equal(frame.document.adoptedStyleSheets.length, 0)
})

function editing(activeElement: unknown, hasFocus = true): boolean {
  const document = { hasFocus: () => hasFocus, activeElement }
  return vm.runInContext(EDITING_SCRIPT, vm.createContext({ document })) as boolean
}

test('EDITING_SCRIPT: campo de texto com foco conta como digitando', () => {
  assert.equal(editing({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(editing({ tagName: 'INPUT', type: '' }), true)
  assert.equal(editing({ tagName: 'TEXTAREA' }), true)
  assert.equal(editing({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(editing({ tagName: 'DIV', shadowRoot: { activeElement: { tagName: 'INPUT', type: 'search' } } }), true)
})

test('EDITING_SCRIPT: player, botão ou página sem foco não contam', () => {
  assert.equal(editing({ tagName: 'VIDEO' }), false)
  assert.equal(editing({ tagName: 'BODY' }), false)
  assert.equal(editing({ tagName: 'INPUT', type: 'range' }), false)
  assert.equal(editing({ tagName: 'INPUT', type: 'checkbox' }), false)
  assert.equal(editing(null), false)
  assert.equal(editing({ tagName: 'INPUT', type: 'text' }, false), false)
})
