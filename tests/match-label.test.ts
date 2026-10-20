import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractMatchLabel,
  labelOverlapsVideo,
  placeMatchLabel,
  type NormRect,
} from '../src/match-label.ts'

test('extrai confronto puro do BLL e remove prefixos de canal/hora', () => {
  assert.equal(extractMatchLabel('Al Ettifaq x Al Ittihad'), 'Al Ettifaq x Al Ittihad')
  assert.equal(extractMatchLabel('(2) Flamengo x Palmeiras'), 'Flamengo x Palmeiras')
  assert.equal(extractMatchLabel('14:00 - Flamengo x Palmeiras'), 'Flamengo x Palmeiras')
  assert.equal(extractMatchLabel('(3) 15:00 - Al Ettifaq x Al Ittihad'), 'Al Ettifaq x Al Ittihad')
})

test('remove emoji de som do título do confronto', () => {
  assert.equal(extractMatchLabel('🔊 Flamengo x Palmeiras'), 'Flamengo x Palmeiras')
  assert.equal(extractMatchLabel('(2) 🔊 Al Ettifaq x Al Ittihad'), 'Al Ettifaq x Al Ittihad')
  assert.equal(extractMatchLabel('Flamengo x Palmeiras 🔉'), 'Flamengo x Palmeiras')
  assert.equal(extractMatchLabel('📢 Real Madrid vs Barcelona | AO VIVO - YouTube'), 'Real Madrid x Barcelona')
})

test('extrai confronto de títulos YouTube com vs, × e sufixos', () => {
  assert.equal(
    extractMatchLabel('Flamengo vs Palmeiras | Brasileirão 2026 AO VIVO - YouTube'),
    'Flamengo x Palmeiras',
  )
  assert.equal(
    extractMatchLabel('Real Madrid × Barcelona - El Clasico AO VIVO - YouTube'),
    'Real Madrid x Barcelona',
  )
  assert.equal(
    extractMatchLabel('Liverpool v Chelsea | Premier League'),
    'Liverpool x Chelsea',
  )
})

test('ignora títulos sem confronto e corta rótulos longos', () => {
  assert.equal(extractMatchLabel('Bll'), null)
  assert.equal(extractMatchLabel('YouTube'), null)
  assert.equal(extractMatchLabel('Zapping'), null)
  assert.equal(extractMatchLabel(''), null)

  const longHome = 'A'.repeat(50)
  const longAway = 'B'.repeat(50)
  const label = extractMatchLabel(`${longHome} x ${longAway}`)
  assert.ok(label)
  assert.ok(label!.length <= 80)
  assert.ok(label!.endsWith('…'))
})

function assertNoOverlap(placement: ReturnType<typeof placeMatchLabel>, videoRect: NormRect) {
  if (placement.mode === 'overlay-bottom') return
  assert.equal(labelOverlapsVideo(placement, videoRect), false)
}

test('posiciona rótulo na barra inferior quando há faixa preta embaixo', () => {
  const panelWidth = 320
  const panelHeight = 180
  // Conteúdo 16:4 (muito largo) em painel 16:9 → barras top/bottom
  const videoRect: NormRect = { x: 0, y: 0.375, width: 1, height: 0.25 }
  const placement = placeMatchLabel({
    panelWidth,
    panelHeight,
    videoRect,
    label: 'Al Ettifaq x Al Ittihad',
  })
  assert.equal(placement.mode, 'bar-bottom')
  assertNoOverlap(placement, videoRect)
})

test('posiciona rótulo na barra lateral quando o vídeo é 4:3 em painel 16:9', () => {
  // Painel típico de 16 telas em 1920×1080 (~480×270): barras laterais ~60px
  const panelWidth = 480
  const panelHeight = 270
  const contentW = (4 / 3) * panelHeight
  const side = (panelWidth - contentW) / 2
  const videoRect: NormRect = {
    x: side / panelWidth,
    y: 0,
    width: contentW / panelWidth,
    height: 1,
  }
  assert.ok(side >= 48)
  const placement = placeMatchLabel({
    panelWidth,
    panelHeight,
    videoRect,
    label: 'Flamengo x Palmeiras',
  })
  assert.equal(placement.mode, 'bar-side')
  assert.deepEqual(placement.lines, ['Flamengo', 'x', 'Palmeiras'])
  assertNoOverlap(placement, videoRect)
})

test('usa overlay-bottom quando o vídeo preenche o painel', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 1 }
  const placement = placeMatchLabel({
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    label: 'Time A x Time B',
  })
  assert.equal(placement.mode, 'overlay-bottom')
  assert.equal(placement.box.x, 0)
  assert.equal(placement.box.width, 1)
  assert.ok(placement.box.y + placement.box.height <= 1 + 1e-9)
})

test('videoRect nulo assume conteúdo 16:9 centralizado', () => {
  // Painel 16:9 com conteúdo 16:9 → preenchido → overlay
  const filled = placeMatchLabel({
    panelWidth: 320,
    panelHeight: 180,
    videoRect: null,
    label: 'A x B',
  })
  assert.equal(filled.mode, 'overlay-bottom')

  // Painel mais largo que 16:9 → barras laterais grandes
  const wide = placeMatchLabel({
    panelWidth: 960,
    panelHeight: 400,
    videoRect: null,
    label: 'A x B',
  })
  assert.ok(wide.mode === 'bar-side' || wide.mode === 'bar-bottom' || wide.mode === 'bar-top')
})

test('painéis minúsculos mantêm fontPx no mínimo de 11', () => {
  const placement = placeMatchLabel({
    panelWidth: 120,
    panelHeight: 68,
    videoRect: { x: 0, y: 0, width: 1, height: 1 },
    label: 'A x B',
  })
  assert.equal(placement.fontPx, 11)
})
