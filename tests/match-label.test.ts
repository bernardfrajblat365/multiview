import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractMatchLabel,
  formatScore,
  labelOverlapsVideo,
  orientScore,
  parseScore,
  placeMatchLabel,
  splitMatchTeams,
  teamsReversed,
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
  assert.equal(labelOverlapsVideo(placement, videoRect), false)
}

function assertInsidePanel(box: NormRect) {
  const eps = 1e-9
  assert.ok(box.x >= -eps, `x ${box.x}`)
  assert.ok(box.y >= -eps, `y ${box.y}`)
  assert.ok(box.x + box.width <= 1 + eps, `direita ${box.x + box.width}`)
  assert.ok(box.y + box.height <= 1 + eps, `base ${box.y + box.height}`)
}

test('posiciona rótulo na barra inferior quando há faixa preta embaixo', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 0.75 }
  const placement = placeMatchLabel({
    panelWidth: 320,
    panelHeight: 180,
    videoRect,
    home: 'Al Ettifaq',
    away: 'Al Ittihad',
  })
  assert.equal(placement.mode, 'bar-bottom')
  assert.equal(placement.layout, 'inline')
  assertNoOverlap(placement, videoRect)
})

test('posiciona rótulo na barra superior quando o vídeo está alinhado embaixo', () => {
  const videoRect: NormRect = { x: 0, y: 0.25, width: 1, height: 0.75 }
  const placement = placeMatchLabel({
    panelWidth: 320,
    panelHeight: 180,
    videoRect,
    home: 'Al Ettifaq',
    away: 'Al Ittihad',
  })
  assert.equal(placement.mode, 'bar-top')
  assertNoOverlap(placement, videoRect)
})

test('barra inferior fina reduz a fonte até 10px antes de cair para outro modo', () => {
  // Barra de 27px: a fonte preferida (13.5px) não cabe em uma linha na largura, uma menor cabe
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 0.9 }
  const placement = placeMatchLabel({
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    home: 'Sociedade Esportiva Palmeiras',
    away: 'Clube Regatas do Flamengo Rio',
  })
  const preferred = 270 * 0.05
  assert.equal(placement.mode, 'bar-bottom')
  assert.equal(placement.layout, 'inline')
  assert.ok(placement.fontPx >= 10, `fontPx ${placement.fontPx}`)
  assert.ok(placement.fontPx < preferred, `fontPx ${placement.fontPx} deveria ser menor que ${preferred}`)
  assertNoOverlap(placement, videoRect)
})

test('nomes longos completos vão para duas linhas quando a barra tem altura para isso', () => {
  // Barras de 54px acima e abaixo: uma linha não cabe na largura, duas linhas cabem
  const videoRect: NormRect = { x: 0, y: 0.2, width: 1, height: 0.6 }
  const placement = placeMatchLabel({
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    home: 'Sociedade Esportiva Palmeiras Futebol Clube',
    away: 'Clube de Regatas do Flamengo Futebol',
  })
  assert.ok(placement.mode === 'bar-bottom' || placement.mode === 'bar-top', `mode ${placement.mode}`)
  assert.equal(placement.layout, 'stacked')
  assert.ok(placement.fontPx >= 10)
  assertNoOverlap(placement, videoRect)
})

test('vídeo 4:3 com só barras laterais recebe a legenda embaixo do vídeo', () => {
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
    home: 'Flamengo',
    away: 'Palmeiras',
  })
  const videoBottom = videoRect.y + videoRect.height
  assert.equal(placement.mode, 'overlay-bottom')
  assert.ok(Math.abs(placement.box.x - videoRect.x) < 1e-9, `x ${placement.box.x}`)
  assert.ok(Math.abs(placement.box.width - videoRect.width) < 1e-9, `largura ${placement.box.width}`)
  assert.ok(Math.abs(placement.box.y + placement.box.height - videoBottom) < 1e-9, `base ${placement.box.y + placement.box.height}`)
  assert.ok(placement.fontPx >= 10, `fontPx ${placement.fontPx}`)
  assert.equal(labelOverlapsVideo(placement, videoRect), true)
})

test('usa overlay-bottom quando o vídeo preenche o painel: largura toda, colado embaixo, fonte maior', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 1 }
  const placement = placeMatchLabel({
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    home: 'Flamengo',
    away: 'Palmeiras',
  })
  assert.equal(placement.mode, 'overlay-bottom')
  assertInsidePanel(placement.box)
  assert.equal(placement.box.x, 0)
  assert.equal(placement.box.width, 1)
  assert.ok(Math.abs(placement.box.y + placement.box.height - 1) < 1e-9)
  assert.ok(placement.fontPx > 14, `fontPx ${placement.fontPx}`)
  assert.equal(labelOverlapsVideo(placement, videoRect), true)
})

test('overlay-bottom com nomes muito longos em painel estreito usa duas linhas com fonte >= 10px', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 1 }
  const placement = placeMatchLabel({
    panelWidth: 200,
    panelHeight: 113,
    videoRect,
    home: 'Sociedade Esportiva Palmeiras Futebol Clube',
    away: 'Clube de Regatas do Flamengo Futebol',
  })
  assert.equal(placement.mode, 'overlay-bottom')
  assert.equal(placement.layout, 'stacked')
  assert.ok(placement.fontPx >= 10, `fontPx ${placement.fontPx}`)
  assertInsidePanel(placement.box)
})

test('placar exige mais largura no inline e reduz a fonte', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 0.9 }
  const base = {
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    home: 'Sociedade Esportiva Palmeira',
    away: 'Clube de Regatas Flamengo',
  }
  const without = placeMatchLabel(base)
  const withScore = placeMatchLabel({ ...base, score: { home: 2, away: 1 } })
  assert.equal(without.mode, 'bar-bottom')
  assert.equal(without.layout, 'inline')
  assert.equal(withScore.mode, 'bar-bottom')
  assert.equal(withScore.layout, 'inline')
  assert.ok(withScore.fontPx < without.fontPx, `${withScore.fontPx} < ${without.fontPx}`)
})

test('videoRect nulo assume conteúdo 16:9 centralizado', () => {
  // Painel 16:9 com conteúdo 16:9 → preenchido → overlay-bottom
  const filled = placeMatchLabel({
    panelWidth: 320,
    panelHeight: 180,
    videoRect: null,
    home: 'A',
    away: 'B',
  })
  assert.equal(filled.mode, 'overlay-bottom')
  assert.equal(labelOverlapsVideo(filled, { x: 0, y: 0, width: 1, height: 1 }), true)

  // Painel mais largo que 16:9 → barras laterais, mas sem barra em cima/embaixo: legenda sobre o vídeo centralizado
  const wide = placeMatchLabel({
    panelWidth: 960,
    panelHeight: 400,
    videoRect: null,
    home: 'A',
    away: 'B',
  })
  const expectedWidth = (16 / 9) * 400 / 960
  const expectedX = (1 - expectedWidth) / 2
  assert.equal(wide.mode, 'overlay-bottom')
  assert.ok(Math.abs(wide.box.width - expectedWidth) < 1e-9, `largura ${wide.box.width}`)
  assert.ok(Math.abs(wide.box.x - expectedX) < 1e-9, `x ${wide.box.x}`)
  assertInsidePanel(wide.box)
})

test('legenda sobre o vídeo cresce com o painel: destaque grande > 26px e ≤ 36px, painel pequeno menor', () => {
  const videoRect: NormRect = { x: 0, y: 0, width: 1, height: 1 }
  const large = placeMatchLabel({
    panelWidth: 1100,
    panelHeight: 620,
    videoRect,
    home: 'Flamengo',
    away: 'Palmeiras',
  })
  const small = placeMatchLabel({
    panelWidth: 480,
    panelHeight: 270,
    videoRect,
    home: 'Flamengo',
    away: 'Palmeiras',
  })
  assert.equal(large.mode, 'overlay-bottom')
  assert.equal(small.mode, 'overlay-bottom')
  assert.ok(large.fontPx > 26 && large.fontPx <= 36, `fontPx grande ${large.fontPx}`)
  assert.ok(small.fontPx < large.fontPx, `${small.fontPx} < ${large.fontPx}`)
})

test('painéis minúsculos com legenda sobre o vídeo mantêm fontPx no mínimo de 10px', () => {
  // A legenda usa o piso de MIN_FIT_FONT_PX (10), não o de 11 das barras
  const placement = placeMatchLabel({
    panelWidth: 120,
    panelHeight: 68,
    videoRect: { x: 0, y: 0, width: 1, height: 1 },
    home: 'A',
    away: 'B',
  })
  assert.equal(placement.mode, 'overlay-bottom')
  assert.equal(placement.fontPx, 10)
})

test('splitMatchTeams separa os times do rótulo e rejeita texto sem confronto', () => {
  assert.deepEqual(splitMatchTeams('Flamengo x Palmeiras'), { home: 'Flamengo', away: 'Palmeiras' })
  assert.equal(splitMatchTeams('Zapping'), null)
})

test('parseScore aceita separadores comuns de placar', () => {
  assert.deepEqual(parseScore('2 - 1'), { home: 2, away: 1 })
  assert.deepEqual(parseScore('2-1'), { home: 2, away: 1 })
  assert.deepEqual(parseScore('2 – 1'), { home: 2, away: 1 })
  assert.deepEqual(parseScore(' 10 : 0 '), { home: 10, away: 0 })
})

test('parseScore ignora texto que não é placar', () => {
  assert.equal(parseScore(''), null)
  assert.equal(parseScore('abc'), null)
  assert.equal(parseScore('2 - '), null)
  assert.equal(parseScore('16:00 - 2'), null)
})

test('formatScore usa en dash entre os números', () => {
  assert.equal(formatScore({ home: 2, away: 1 }), '2 – 1')
})

test('orientScore mantém a ordem quando título e feed listam os times igual', () => {
  const score = orientScore(
    { home: 'Flamengo', away: 'Palmeiras' },
    { home: 'Flamengo', away: 'Palmeiras' },
    { home: 2, away: 1 },
  )
  assert.deepEqual(score, { home: 2, away: 1 })
})

test('orientScore inverte o placar quando o título lista os times na ordem contrária ao feed', () => {
  const score = orientScore(
    { home: 'Palmeiras', away: 'Flamengo' },
    { home: 'Flamengo', away: 'Palmeiras' },
    { home: 2, away: 1 },
  )
  assert.deepEqual(score, { home: 1, away: 2 })
})

test('orientScore ignora acentos, caixa e sufixos como FC', () => {
  // Mesma ordem, grafias diferentes: placar mantido
  const same = orientScore(
    { home: 'São Paulo', away: 'Palmeiras' },
    { home: 'Sao Paulo FC', away: 'Palmeiras' },
    { home: 2, away: 1 },
  )
  assert.deepEqual(same, { home: 2, away: 1 })

  // Ordem invertida, com caixa e acento diferentes: placar invertido
  const reversed = orientScore(
    { home: 'SÃO PAULO', away: 'Grêmio' },
    { home: 'Grêmio', away: 'Sao Paulo FC' },
    { home: 2, away: 1 },
  )
  assert.deepEqual(reversed, { home: 1, away: 2 })
})

test('orientScore mantém o placar quando os nomes não têm relação', () => {
  const score = orientScore(
    { home: 'Grêmio', away: 'Inter' },
    { home: 'Flamengo', away: 'Palmeiras' },
    { home: 2, away: 1 },
  )
  assert.deepEqual(score, { home: 2, away: 1 })
})

test('teamsReversed é verdadeiro quando o feed lista os times trocados e falso na mesma ordem', () => {
  const title = { home: 'Flamengo', away: 'Palmeiras' }
  assert.equal(teamsReversed(title, { home: 'Palmeiras', away: 'Flamengo' }), true)
  assert.equal(teamsReversed(title, { home: 'Flamengo', away: 'Palmeiras' }), false)
})

test('orientScore continua invertendo o placar quando o feed vem ao contrário', () => {
  const title = { home: 'Flamengo', away: 'Palmeiras' }
  assert.deepEqual(orientScore(title, { home: 'Palmeiras', away: 'Flamengo' }, { home: 2, away: 1 }), { home: 1, away: 2 })
  assert.deepEqual(orientScore(title, { home: 'Flamengo', away: 'Palmeiras' }, { home: 2, away: 1 }), { home: 2, away: 1 })
})

test('placeMatchLabel com escudos não aumenta a fonte no mesmo modo e layout', () => {
  const cases = [
    { panelWidth: 400, panelHeight: 300, home: 'Internacional de Porto Alegre', away: 'Sociedade Esportiva Palmeiras' },
    { panelWidth: 1280, panelHeight: 720, home: 'Al Ettifaq', away: 'Al Ittihad' },
    { panelWidth: 240, panelHeight: 400, home: 'Borussia Monchengladbach', away: 'Eintracht Frankfurt', score: { home: 1, away: 0 } },
  ]
  for (const options of cases) {
    const plain = placeMatchLabel(options)
    const withCrests = placeMatchLabel({ ...options, crests: true })
    if (withCrests.mode === plain.mode && withCrests.layout === plain.layout) {
      assert.ok(withCrests.fontPx <= plain.fontPx, `fonte com escudos ${withCrests.fontPx} > ${plain.fontPx}`)
    }
  }
})

test('placeMatchLabel com escudos só muda de layout para empilhado, nunca o contrário', () => {
  const cases = [
    { panelWidth: 400, panelHeight: 300, home: 'Internacional de Porto Alegre', away: 'Sociedade Esportiva Palmeiras' },
    { panelWidth: 240, panelHeight: 400, home: 'Borussia Monchengladbach', away: 'Eintracht Frankfurt', score: { home: 1, away: 0 } },
  ]
  for (const options of cases) {
    const plain = placeMatchLabel(options)
    const withCrests = placeMatchLabel({ ...options, crests: true })
    if (withCrests.layout !== plain.layout) assert.equal(withCrests.layout, 'stacked')
  }
})

test('placeMatchLabel com escudos reduz a fonte ou empilha em barra estreita', () => {
  const options = { panelWidth: 400, panelHeight: 300, home: 'Internacional de Porto Alegre', away: 'Sociedade Esportiva Palmeiras' }
  const plain = placeMatchLabel(options)
  const withCrests = placeMatchLabel({ ...options, crests: true })
  assert.ok(withCrests.fontPx < plain.fontPx || (withCrests.layout === 'stacked' && plain.layout === 'inline'))
})
