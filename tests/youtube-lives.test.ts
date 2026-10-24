import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_YOUTUBE_CHANNELS,
  MAX_YOUTUBE_CHANNELS,
  detectCompetition,
  isLiveGameTitle,
  isValidYoutubeApiKey,
  isYoutubeChannelId,
  parseChannelInput,
  parseChannelList,
  parseLiveVideos,
  parsePlaylistVideoIds,
  parseStoredChannels,
  readEnvValue,
  uploadsPlaylistId,
  youtubeErrorStatus,
} from '../src/youtube-lives.ts'

const CHANNEL = 'UCZiYbVptd3PVPf4f6eR6UaQ'

/** Monta um item de `videos.list` (snippet + liveStreamingDetails) com ao vivo válido por padrão. */
function video(
  id: string,
  title: string,
  extra: { channel?: string; viewers?: unknown; content?: string; started?: boolean; ended?: boolean } = {},
) {
  const details: Record<string, unknown> = {}
  if (extra.started !== false) details.actualStartTime = '2026-10-24T18:00:00Z'
  if (extra.ended) details.actualEndTime = '2026-10-24T20:00:00Z'
  if (extra.viewers !== undefined) details.concurrentViewers = extra.viewers
  return {
    id,
    snippet: { title, channelTitle: extra.channel, liveBroadcastContent: extra.content ?? 'live' },
    liveStreamingDetails: details,
  }
}

/** Id de vídeo válido (11 caracteres) a partir de um número. */
function vid(index: number) {
  return `vid${String(index).padStart(8, '0')}`
}

/** Id de canal válido (UC + 22 caracteres) a partir de um número. */
function channelIdOf(index: number) {
  return `UC${String(index).padStart(22, '0')}`
}

test('isYoutubeChannelId aceita UC seguido de 22 caracteres válidos', () => {
  assert.equal(isYoutubeChannelId(CHANNEL), true)
  assert.equal(isYoutubeChannelId(`UC${'a'.repeat(22)}`), true)
  assert.equal(isYoutubeChannelId(`UC${'_-0'.repeat(8).slice(0, 22)}`), true)
})

test('isYoutubeChannelId rejeita tamanho errado, prefixo errado e caracteres inválidos', () => {
  assert.equal(isYoutubeChannelId(`UC${'a'.repeat(21)}`), false)
  assert.equal(isYoutubeChannelId(`UC${'a'.repeat(23)}`), false)
  assert.equal(isYoutubeChannelId(`uc${'a'.repeat(22)}`), false)
  assert.equal(isYoutubeChannelId(`UD${'a'.repeat(22)}`), false)
  assert.equal(isYoutubeChannelId(`UC${'a'.repeat(21)}.`), false)
  assert.equal(isYoutubeChannelId(`UC${'a'.repeat(21)} `), false)
  assert.equal(isYoutubeChannelId(''), false)
})

test('isYoutubeChannelId rejeita valores que não são string', () => {
  assert.equal(isYoutubeChannelId(null), false)
  assert.equal(isYoutubeChannelId(undefined), false)
  assert.equal(isYoutubeChannelId(42), false)
  assert.equal(isYoutubeChannelId([CHANNEL]), false)
})

test('parseChannelInput aceita id de canal puro', () => {
  assert.deepEqual(parseChannelInput(CHANNEL), { id: CHANNEL })
  assert.deepEqual(parseChannelInput(`  ${CHANNEL}  `), { id: CHANNEL })
})

test('parseChannelInput aceita @handle, handle puro e com espaços em volta', () => {
  assert.deepEqual(parseChannelInput('@canaltest'), { handle: 'canaltest' })
  assert.deepEqual(parseChannelInput('canaltest'), { handle: 'canaltest' })
  assert.deepEqual(parseChannelInput('  @canal.test-1_x  '), { handle: 'canal.test-1_x' })
  assert.deepEqual(parseChannelInput(`@${'a'.repeat(30)}`), { handle: 'a'.repeat(30) })
})

test('parseChannelInput aceita links de @handle, inclusive m. e subcaminhos', () => {
  assert.deepEqual(parseChannelInput('https://www.youtube.com/@canaltest'), { handle: 'canaltest' })
  assert.deepEqual(parseChannelInput('youtube.com/@canaltest/streams'), { handle: 'canaltest' })
  assert.deepEqual(parseChannelInput('https://m.youtube.com/@canaltest/videos'), { handle: 'canaltest' })
  assert.deepEqual(parseChannelInput('https://youtube.com/@canaltest/'), { handle: 'canaltest' })
})

test('parseChannelInput aceita links /channel/ com id de canal', () => {
  assert.deepEqual(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL}`), { id: CHANNEL })
  assert.deepEqual(parseChannelInput(`https://www.youtube.com/channel/${CHANNEL}/videos`), { id: CHANNEL })
})

test('parseChannelInput aceita links /user/ antigos', () => {
  assert.deepEqual(parseChannelInput('https://www.youtube.com/user/CazeTV'), { username: 'CazeTV' })
  assert.deepEqual(parseChannelInput('youtube.com/user/CazeTV/videos'), { username: 'CazeTV' })
})

test('parseChannelInput rejeita entrada vazia ou longa demais', () => {
  assert.equal(parseChannelInput(''), null)
  assert.equal(parseChannelInput('   '), null)
  assert.equal(parseChannelInput(`@${'a'.repeat(300)}`), null)
  assert.equal(parseChannelInput('a'.repeat(301)), null)
})

test('parseChannelInput rejeita links /c/ personalizados', () => {
  assert.equal(parseChannelInput('https://www.youtube.com/c/canaltest'), null)
  assert.equal(parseChannelInput('youtube.com/c/CazéTV'), null)
})

test('parseChannelInput rejeita outros hosts e domínios que só contêm youtube.com', () => {
  assert.equal(parseChannelInput('https://example.com/@canaltest'), null)
  assert.equal(parseChannelInput('https://youtube.com.evil.com/@canaltest'), null)
  assert.equal(parseChannelInput('https://notyoutube.com/@canaltest'), null)
})

test('parseChannelInput rejeita handles curtos ou com caracteres inválidos', () => {
  assert.equal(parseChannelInput('ab'), null)
  assert.equal(parseChannelInput('@ab'), null)
  assert.equal(parseChannelInput('https://www.youtube.com/@ab'), null)
  assert.equal(parseChannelInput(`@${'a'.repeat(31)}`), null)
  assert.equal(parseChannelInput('@canal test'), null)
})

test('parseChannelInput rejeita páginas do YouTube que não são canal', () => {
  assert.equal(parseChannelInput('https://www.youtube.com/watch?v=abcdefghijk'), null)
  assert.equal(parseChannelInput('https://www.youtube.com/'), null)
})

test('uploadsPlaylistId troca UC por UU mantendo o resto do id', () => {
  assert.equal(uploadsPlaylistId('UCxxxx'), 'UUxxxx')
  assert.equal(uploadsPlaylistId(CHANNEL), `UU${CHANNEL.slice(2)}`)
})

test('parsePlaylistVideoIds retorna lista vazia para entrada inválida', () => {
  assert.deepEqual(parsePlaylistVideoIds(null), [])
  assert.deepEqual(parsePlaylistVideoIds('texto'), [])
  assert.deepEqual(parsePlaylistVideoIds({}), [])
  assert.deepEqual(parsePlaylistVideoIds({ items: 'x' }), [])
})

test('parsePlaylistVideoIds lê contentDetails.videoId e ignora lixo', () => {
  const raw = {
    items: [
      { contentDetails: { videoId: 'aaaaaaaaaaa' } },
      null,
      'texto',
      { snippet: { title: 'sem contentDetails' } },
      { contentDetails: { videoId: 'short' } },
      { contentDetails: { videoId: 42 } },
      { contentDetails: { videoId: 'abc/defghij' } },
      { contentDetails: { videoId: 'bbbbbbbbbbb' } },
    ],
  }
  assert.deepEqual(parsePlaylistVideoIds(raw), ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
})

test('parsePlaylistVideoIds remove ids repetidos mantendo a ordem', () => {
  const raw = {
    items: [
      { contentDetails: { videoId: 'bbbbbbbbbbb' } },
      { contentDetails: { videoId: 'aaaaaaaaaaa' } },
      { contentDetails: { videoId: 'bbbbbbbbbbb' } },
    ],
  }
  assert.deepEqual(parsePlaylistVideoIds(raw), ['bbbbbbbbbbb', 'aaaaaaaaaaa'])
})

test('parsePlaylistVideoIds lê no máximo 50 linhas', () => {
  const items = Array.from({ length: 60 }, (_, index) => ({ contentDetails: { videoId: vid(index) } }))
  const ids = parsePlaylistVideoIds({ items })
  assert.equal(ids.length, 50)
  assert.equal(ids[0], vid(0))
  assert.equal(ids[49], vid(49))
})

test('parseLiveVideos retorna lista vazia para entrada inválida', () => {
  assert.deepEqual(parseLiveVideos(null, 2026), [])
  assert.deepEqual(parseLiveVideos('texto', 2026), [])
  assert.deepEqual(parseLiveVideos({}, 2026), [])
  assert.deepEqual(parseLiveVideos({ items: { 0: video('aaaaaaaaaaa', 'A x B') } }, 2026), [])
})

test('parseLiveVideos mantém só transmissões com liveBroadcastContent "live"', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Flamengo x Vasco', { content: 'live' }),
      video('bbbbbbbbbbb', 'Flamengo x Vasco', { content: 'upcoming' }),
      video('ccccccccccc', 'Flamengo x Vasco', { content: 'none' }),
      { id: 'ddddddddddd', snippet: { title: 'Flamengo x Vasco' }, liveStreamingDetails: { actualStartTime: 'x' } },
    ],
  }
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), ['aaaaaaaaaaa'])
})

test('parseLiveVideos exige início real e descarta transmissões que já terminaram', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Flamengo x Vasco'),
      video('bbbbbbbbbbb', 'Flamengo x Vasco', { started: false }),
      video('ccccccccccc', 'Flamengo x Vasco', { ended: true }),
      { id: 'ddddddddddd', snippet: { title: 'Flamengo x Vasco', liveBroadcastContent: 'live' } },
    ],
  }
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), ['aaaaaaaaaaa'])
})

test('parseLiveVideos descarta títulos que não são jogo', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Transmissão ao vivo'),
      video('bbbbbbbbbbb', 'Flamengo x Vasco - REACT'),
      video('ccccccccccc', 'Flamengo x Vasco - Melhores momentos'),
      video('ddddddddddd', 'Vôlei: Brasil x Itália'),
      video('eeeeeeeeeee', 'Flamengo x Vasco'),
    ],
  }
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), ['eeeeeeeeeee'])
})

test('parseLiveVideos descarta reprise de temporada antiga com year informado', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Barcelona 3 x 3 Real Madrid 2006/07'),
      video('bbbbbbbbbbb', 'Arsenal x Chelsea | Premier League 2025/26'),
    ],
  }
  const lives = parseLiveVideos(raw, 2026)
  assert.deepEqual(lives.map((live) => live.id), ['bbbbbbbbbbb'])
  assert.equal(lives[0].competition, 'Premier League')
})

test('parseLiveVideos descarta ids inválidos e linhas que não são objeto', () => {
  const raw = {
    items: [
      null,
      'texto',
      7,
      video('short', 'Flamengo x Vasco'),
      video('abc/defghij', 'Flamengo x Vasco'),
      { ...video('aaaaaaaaaaa', 'Flamengo x Vasco'), id: 42 },
      video('abcdefghi-k', 'Flamengo x Vasco'),
    ],
  }
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), ['abcdefghi-k'])
})

test('parseLiveVideos remove ids repetidos e mantém a primeira ocorrência válida', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Flamengo x Vasco', { channel: 'Canal 1' }),
      video('aaaaaaaaaaa', 'Outro x Jogo', { channel: 'Canal 2' }),
    ],
  }
  const lives = parseLiveVideos(raw, 2026)
  assert.equal(lives.length, 1)
  assert.equal(lives[0].name, 'Flamengo x Vasco')
  assert.equal(lives[0].channel, 'Canal 1')
})

test('parseLiveVideos monta o objeto completo sem campo viewers', () => {
  const raw = { items: [video('dQw4w9WgXcQ', 'Copa do Brasil: Flamengo x Vasco', { channel: 'Canal Esportes', viewers: '1500' })] }
  assert.deepEqual(parseLiveVideos(raw, 2026), [
    {
      id: 'dQw4w9WgXcQ',
      name: 'Copa do Brasil: Flamengo x Vasco',
      channel: 'Canal Esportes',
      competition: 'Copa do Brasil',
      time: '',
      live: true,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    },
  ])
})

test('parseLiveVideos usa o nome do canal como competição quando não identifica uma', () => {
  const raw = { items: [video('abcdefghijk', 'Flamengo x Vasco', { channel: 'Canal Esportes' })] }
  const [live] = parseLiveVideos(raw, 2026)
  assert.equal(live.competition, 'Canal Esportes')
  assert.equal(live.channel, 'Canal Esportes')
})

test('parseLiveVideos usa "YouTube" quando o canal falta ou está vazio', () => {
  const raw = {
    items: [
      video('abcdefghijk', 'Flamengo x Vasco'),
      video('bcdefghijkl', 'Flamengo x Vasco', { channel: '   ' }),
    ],
  }
  const lives = parseLiveVideos(raw, 2026)
  assert.deepEqual(lives.map((live) => live.channel), ['YouTube', 'YouTube'])
  assert.deepEqual(lives.map((live) => live.competition), ['YouTube', 'YouTube'])
})

test('parseLiveVideos remove a marca de som do título', () => {
  const raw = { items: [video('abcdefghijk', '🔊 Flamengo x Vasco 🔇')] }
  assert.equal(parseLiveVideos(raw, 2026)[0].name, 'Flamengo x Vasco')
})

test('parseLiveVideos decodifica entidades HTML do título', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Jogo &quot;Final&quot; Flamengo x Vasco'),
      video('bbbbbbbbbbb', 'Time d&#39;Ávila x Vasco'),
      video('ccccccccccc', 'Flamengo &amp; Amigos x Vasco'),
      video('ddddddddddd', 'Flamengo x Vasco &amp;quot;'),
    ],
  }
  const names = parseLiveVideos(raw, 2026).map((live) => live.name)
  assert.deepEqual(names, [
    'Jogo "Final" Flamengo x Vasco',
    "Time d'Ávila x Vasco",
    'Flamengo & Amigos x Vasco',
    // decodificação em uma única passagem: &amp;quot; vira &quot; e não "
    'Flamengo x Vasco &quot;',
  ])
})

test('parseLiveVideos limita o título a 200 caracteres', () => {
  const raw = { items: [video('abcdefghijk', `Flamengo x Vasco ${'z'.repeat(300)}`)] }
  const [live] = parseLiveVideos(raw, 2026)
  assert.equal(live.name.length, 200)
  assert.ok(live.name.startsWith('Flamengo x Vasco'))
})

test('parseLiveVideos ordena por espectadores simultâneos, do maior para o menor', () => {
  const raw = {
    items: [
      video('aaaaaaaaaaa', 'Time A x Time B', { viewers: 10 }),
      video('bbbbbbbbbbb', 'Time C x Time D', { viewers: 500 }),
      video('ccccccccccc', 'Time E x Time F'),
      video('ddddddddddd', 'Time G x Time H', { viewers: '300' }),
      video('eeeeeeeeeee', 'Time I x Time J', { viewers: 'abc' }),
      video('fffffffffff', 'Time K x Time L', { viewers: Infinity }),
    ],
  }
  // sem número válido conta como 0; empates mantêm a ordem original
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), [
    'bbbbbbbbbbb',
    'ddddddddddd',
    'aaaaaaaaaaa',
    'ccccccccccc',
    'eeeeeeeeeee',
    'fffffffffff',
  ])
})

test('parseLiveVideos lê as transmissões além das 200 primeiras linhas', () => {
  const filler = Array.from({ length: 300 }, (_, index) => video(vid(index), `Programa ${index}`, { content: 'none' }))
  const raw = { items: [...filler, video('zzzzzzzzzzz', 'Flamengo x Vasco')] }
  assert.deepEqual(parseLiveVideos(raw, 2026).map((live) => live.id), ['zzzzzzzzzzz'])
})

test('parseChannelList retorna o primeiro canal com id e título', () => {
  const raw = {
    items: [
      { id: CHANNEL, snippet: { title: '  CazéTV  ' } },
      { id: 'UCP-vp1zdHOa9k2hN_nMT9TA', snippet: { title: 'Outro' } },
    ],
  }
  assert.deepEqual(parseChannelList(raw), { id: CHANNEL, title: 'CazéTV' })
})

test('parseChannelList usa o id como título quando o título falta ou está vazio', () => {
  assert.deepEqual(parseChannelList({ items: [{ id: CHANNEL, snippet: {} }] }), { id: CHANNEL, title: CHANNEL })
  assert.deepEqual(parseChannelList({ items: [{ id: CHANNEL, snippet: { title: '   ' } }] }), { id: CHANNEL, title: CHANNEL })
})

test('parseChannelList retorna null para resposta vazia, inválida ou com id ruim', () => {
  assert.equal(parseChannelList(null), null)
  assert.equal(parseChannelList('texto'), null)
  assert.equal(parseChannelList({}), null)
  assert.equal(parseChannelList({ items: [] }), null)
  assert.equal(parseChannelList({ items: 'x' }), null)
  assert.equal(parseChannelList({ items: [{ id: 'short', snippet: { title: 'X' } }] }), null)
  assert.equal(parseChannelList({ items: [null] }), null)
})

test('parseStoredChannels devolve a lista padrão quando não há valor salvo', () => {
  assert.deepEqual(parseStoredChannels(null), [...DEFAULT_YOUTUBE_CHANNELS])
})

test('parseStoredChannels devolve a lista padrão para JSON corrompido ou que não é array', () => {
  assert.deepEqual(parseStoredChannels('{nao é json'), [...DEFAULT_YOUTUBE_CHANNELS])
  assert.deepEqual(parseStoredChannels(''), [...DEFAULT_YOUTUBE_CHANNELS])
  assert.deepEqual(parseStoredChannels('{}'), [...DEFAULT_YOUTUBE_CHANNELS])
  assert.deepEqual(parseStoredChannels('"texto"'), [...DEFAULT_YOUTUBE_CHANNELS])
  assert.deepEqual(parseStoredChannels('null'), [...DEFAULT_YOUTUBE_CHANNELS])
})

test('parseStoredChannels mantém uma lista salva vazia como vazia', () => {
  assert.deepEqual(parseStoredChannels('[]'), [])
})

test('parseStoredChannels descarta ids inválidos, entradas que não são objeto e duplicados', () => {
  const saved = [
    { id: CHANNEL, title: 'Primeiro' },
    { id: 'short', title: 'Curto' },
    null,
    'texto',
    { id: CHANNEL, title: 'Repetido' },
    { id: 42, title: 'Número' },
    { title: 'Sem id' },
    { id: 'UCP-vp1zdHOa9k2hN_nMT9TA', title: 'Segundo' },
  ]
  assert.deepEqual(parseStoredChannels(JSON.stringify(saved)), [
    { id: CHANNEL, title: 'Primeiro' },
    { id: 'UCP-vp1zdHOa9k2hN_nMT9TA', title: 'Segundo' },
  ])
})

test('parseStoredChannels usa o id como título quando o título falta ou está vazio', () => {
  const saved = [
    { id: CHANNEL },
    { id: channelIdOf(1), title: '   ' },
    { id: channelIdOf(2), title: 123 },
  ]
  assert.deepEqual(parseStoredChannels(JSON.stringify(saved)), [
    { id: CHANNEL, title: CHANNEL },
    { id: channelIdOf(1), title: channelIdOf(1) },
    { id: channelIdOf(2), title: channelIdOf(2) },
  ])
})

test('parseStoredChannels limita a lista a MAX_YOUTUBE_CHANNELS', () => {
  const saved = Array.from({ length: MAX_YOUTUBE_CHANNELS + 10 }, (_, index) => ({ id: channelIdOf(index), title: `Canal ${index}` }))
  const channels = parseStoredChannels(JSON.stringify(saved))
  assert.equal(channels.length, MAX_YOUTUBE_CHANNELS)
  assert.equal(channels[0].id, channelIdOf(0))
  assert.equal(channels.at(-1)?.id, channelIdOf(MAX_YOUTUBE_CHANNELS - 1))
})

test('parseStoredChannels não altera DEFAULT_YOUTUBE_CHANNELS ao mexer na lista devolvida', () => {
  const before = DEFAULT_YOUTUBE_CHANNELS.map((channel) => ({ ...channel }))

  const fromNull = parseStoredChannels(null)
  fromNull.pop()
  fromNull.push({ id: channelIdOf(99), title: 'Novo' })
  assert.deepEqual(DEFAULT_YOUTUBE_CHANNELS, before)

  const fromCorrupt = parseStoredChannels('{nao é json')
  fromCorrupt.length = 0
  assert.deepEqual(DEFAULT_YOUTUBE_CHANNELS, before)
})

test('DEFAULT_YOUTUBE_CHANNELS tem ids válidos e sem repetição', () => {
  for (const channel of DEFAULT_YOUTUBE_CHANNELS) {
    assert.equal(isYoutubeChannelId(channel.id), true, `id inválido: ${channel.id}`)
    assert.ok(channel.title.length > 0)
  }
  const ids = DEFAULT_YOUTUBE_CHANNELS.map((channel) => channel.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('detectCompetition devolve NFL e NBA primeiro quando aparecem', () => {
  assert.equal(detectCompetition('Chiefs vs Bills - NFL'), 'NFL')
  assert.equal(detectCompetition('Lakers x Celtics | NBA'), 'NBA')
  assert.equal(detectCompetition('Copa do Brasil: NFL Chiefs x Bills'), 'NFL')
  assert.equal(detectCompetition('Copa do Brasil NBA: Lakers x Celtics'), 'NBA')
})

test('detectCompetition identifica competições conhecidas', () => {
  assert.equal(detectCompetition('Copa do Brasil: Flamengo x Vasco'), 'Copa do Brasil')
  assert.equal(detectCompetition('Brasileirão Série B: Sport x Ceará'), 'Brasileirão Série B')
  assert.equal(detectCompetition('Serie B - Sport x Ceará'), 'Brasileirão Série B')
  assert.equal(detectCompetition('Brasileirão Série A: Flamengo x Vasco'), 'Brasileirão')
  assert.equal(detectCompetition('Premier League: Arsenal x Chelsea'), 'Premier League')
})

test('detectCompetition distingue Libertadores Feminina de Libertadores', () => {
  assert.equal(detectCompetition('Libertadores Feminina: Corinthians x Boca'), 'Libertadores Feminina')
  assert.equal(detectCompetition('Libertadores: Flamengo x Palmeiras'), 'Libertadores')
})

test('detectCompetition identifica Ligue 1 e Bundesliga', () => {
  assert.equal(detectCompetition('Ligue 1: PSG x Lyon'), 'Ligue 1')
  assert.equal(detectCompetition('Ligue1: Marseille x Nice'), 'Ligue 1')
  assert.equal(detectCompetition('Bundesliga: Bayern x Dortmund'), 'Bundesliga')
})

test('detectCompetition retorna null quando nada combina', () => {
  assert.equal(detectCompetition('Flamengo x Vasco'), null)
  assert.equal(detectCompetition(''), null)
})

test('detectCompetition dá prioridade a Copa do Brasil sobre Brasileirão quando ambos aparecem', () => {
  // a ordem da lista (COMPETITIONS) decide, não a posição do termo no título
  assert.equal(detectCompetition('Brasileirão Série A - Copa do Brasil: Flamengo x Vasco'), 'Copa do Brasil')
  assert.equal(detectCompetition('Copa do Brasil - Brasileirão Série A: Flamengo x Vasco'), 'Copa do Brasil')
})

test('detectCompetition não confunde nome de time com campeonato estadual', () => {
  assert.equal(detectCompetition('Atlético Mineiro x Flamengo'), null)
  assert.equal(detectCompetition('Grêmio x Internacional - Gauchão 2026'), 'Gauchão')
  assert.equal(detectCompetition('Cruzeiro x América - Campeonato Mineiro'), 'Mineiro')
  assert.equal(detectCompetition('Flamengo x Vasco | Carioca 2026'), 'Carioca')
})

test('isLiveGameTitle aceita confrontos com x, ×, vs, vs. e versus', () => {
  assert.equal(isLiveGameTitle('Flamengo x Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo X Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo × Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo vs Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo vs. Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo versus Vasco'), true)
})

test('isLiveGameTitle rejeita títulos sem confronto', () => {
  assert.equal(isLiveGameTitle('x'), false)
  assert.equal(isLiveGameTitle('Jogo ao vivo'), false)
  assert.equal(isLiveGameTitle('Flamengo x'), false)
  assert.equal(isLiveGameTitle(''), false)
})

test('isLiveGameTitle rejeita palavras que não são jogo', () => {
  assert.equal(isLiveGameTitle('REACT Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Reação Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Narração Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('eFootball Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('FC 26 Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Pré-jogo Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco - Melhores momentos'), false)
  assert.equal(isLiveGameTitle('Vôlei Brasil x Itália'), false)
})

test('isLiveGameTitle aceita NFL e NBA quando o título os nomeia, mesmo com outro esporte citado', () => {
  assert.equal(isLiveGameTitle('Lakers x Celtics | NBA'), true)
  assert.equal(isLiveGameTitle('NBA: Lakers x Celtics'), true)
  assert.equal(isLiveGameTitle('Chiefs vs Bills - NFL'), true)
  assert.equal(isLiveGameTitle('Lakers x Celtics | NBA basquete'), true)
  assert.equal(isLiveGameTitle('Lakers x Celtics - NBA basketball'), true)
  assert.equal(isLiveGameTitle('Chiefs x Bills - NFL futebol americano'), true)
  assert.equal(isLiveGameTitle('Chiefs x Bills - NFL American football'), true)
})

test('isLiveGameTitle continua rejeitando outros esportes quando não há NFL nem NBA', () => {
  assert.equal(isLiveGameTitle('Flamengo x Vasco - futebol americano'), false)
  assert.equal(isLiveGameTitle('Eagles x Hawks - American football'), false)
  assert.equal(isLiveGameTitle('Bulls x Knicks - Basquete'), false)
  assert.equal(isLiveGameTitle('Lakers x Celtics - basketball'), false)
  assert.equal(isLiveGameTitle('Bauru x Flamengo - NBB'), false)
  assert.equal(isLiveGameTitle('Brasil x Itália - Vôlei'), false)
  assert.equal(isLiveGameTitle('Brasil x Itália - Volleyball'), false)
  assert.equal(isLiveGameTitle('Brasil x Itália - Handebol'), false)
  assert.equal(isLiveGameTitle('Djokovic x Nadal - Tênis'), false)
  assert.equal(isLiveGameTitle('Pereira x Silva - UFC'), false)
  assert.equal(isLiveGameTitle('Pereira x Silva - MMA'), false)
  assert.equal(isLiveGameTitle('Tyson x Holyfield - Boxe'), false)
})

test('isLiveGameTitle rejeita escola e faculdade mesmo com NFL ou NBA no título', () => {
  assert.equal(isLiveGameTitle('LIVE Football High School: Lincoln x Roosevelt'), false)
  assert.equal(isLiveGameTitle('High School Football: Eagles x Hawks NFL'), false)
  assert.equal(isLiveGameTitle('HS Football: Eagles x Hawks NFL'), false)
  assert.equal(isLiveGameTitle('HS Basketball: Lakers x Celtics NBA'), false)
  assert.equal(isLiveGameTitle('College Football: Alabama x Georgia NFL'), false)
  assert.equal(isLiveGameTitle('NCAA: Alabama x Georgia NFL'), false)
  assert.equal(isLiveGameTitle('Lakers x Celtics | NBA High School'), false)
})

test('isLiveGameTitle rejeita as novas palavras bloqueadas', () => {
  assert.equal(isLiveGameTitle('Jogo completo: Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Relembre: Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco 24/7'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco 24h'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco - 24 horas'), false)
  assert.equal(isLiveGameTitle('Vamos assistir o jogo juntos: Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Watch Along: Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco watchalong'), false)
  assert.equal(isLiveGameTitle('Resenha: Flamengo x Vasco'), false)
  assert.equal(isLiveGameTitle('Sinuca: Ronnie x Judd'), false)
  assert.equal(isLiveGameTitle('Snooker: Ronnie x Judd'), false)
  assert.equal(isLiveGameTitle('Bilhar: Flamengo x Vasco'), false)
})

test('isLiveGameTitle mantém jogos ao vivo parecidos com as palavras novas', () => {
  assert.equal(isLiveGameTitle('Vamos assistir ao jogo: Flamengo x Vasco'), true)
  assert.equal(isLiveGameTitle('Flamengo x Vasco ao vivo'), true)
  assert.equal(isLiveGameTitle('Flamengo x Vasco 2026'), true)
})

test('isLiveGameTitle rejeita reprises de temporadas antigas (ano explícito 2026)', () => {
  assert.equal(isLiveGameTitle('Barcelona 3 x 3 Real Madrid 2006/07', 2026), false)
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2025/26', 2026), true)
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2025-26', 2026), true)
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2024/25', 2026), false)
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2024-25', 2026), false)
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2023/24', 2026), false)
  // em 2025 a temporada 2024/25 ainda é a atual
  assert.equal(isLiveGameTitle('Arsenal x Chelsea | Premier League 2024/25', 2025), true)
})

test('isLiveGameTitle rejeita videogame com NBA/NFL no título e aceita a liga real', () => {
  assert.equal(isLiveGameTitle('Lakers x Celtics | NBA 2K26 Live'), false)
  assert.equal(isLiveGameTitle('Chiefs x Bills | Madden NFL 26'), false)
  assert.equal(isLiveGameTitle('Flamengo x Vasco 24hs'), false)
  assert.equal(isLiveGameTitle('Lakers x Celtics | NBA'), true)
})

test('isValidYoutubeApiKey aceita chave no formato AIza com 39 caracteres', () => {
  assert.equal(isValidYoutubeApiKey(`AIza${'x'.repeat(35)}`), true)
  assert.equal(isValidYoutubeApiKey(`AIza${'a1-_'.repeat(9).slice(0, 35)}`), true)
})

test('isValidYoutubeApiKey respeita os limites de 30 e 100 caracteres', () => {
  assert.equal(isValidYoutubeApiKey('a'.repeat(29)), false)
  assert.equal(isValidYoutubeApiKey('a'.repeat(30)), true)
  assert.equal(isValidYoutubeApiKey('a'.repeat(100)), true)
  assert.equal(isValidYoutubeApiKey('a'.repeat(101)), false)
})

test('isValidYoutubeApiKey rejeita chave curta', () => {
  assert.equal(isValidYoutubeApiKey('AIzaShort'), false)
  assert.equal(isValidYoutubeApiKey(''), false)
})

test('isValidYoutubeApiKey rejeita espaços, & e /', () => {
  assert.equal(isValidYoutubeApiKey(`AIza${'x'.repeat(34)} `), false)
  assert.equal(isValidYoutubeApiKey(`AIza${'x'.repeat(30)}&key=1`), false)
  assert.equal(isValidYoutubeApiKey(`AIza${'x'.repeat(30)}/abc`), false)
})

test('isValidYoutubeApiKey rejeita valores que não são string', () => {
  assert.equal(isValidYoutubeApiKey(null), false)
  assert.equal(isValidYoutubeApiKey(undefined), false)
  assert.equal(isValidYoutubeApiKey(123), false)
  assert.equal(isValidYoutubeApiKey({}), false)
  assert.equal(isValidYoutubeApiKey([`AIza${'x'.repeat(35)}`]), false)
})

test('readEnvValue lê valor simples', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY=abc123', 'YOUTUBE_API_KEY'), 'abc123')
})

test('readEnvValue remove aspas simples e duplas', () => {
  assert.equal(readEnvValue("YOUTUBE_API_KEY='abc 123'", 'YOUTUBE_API_KEY'), 'abc 123')
  assert.equal(readEnvValue('YOUTUBE_API_KEY="abc"', 'YOUTUBE_API_KEY'), 'abc')
  assert.equal(readEnvValue('YOUTUBE_API_KEY=""', 'YOUTUBE_API_KEY'), '')
})

test('readEnvValue aceita prefixo export', () => {
  assert.equal(readEnvValue('export YOUTUBE_API_KEY=abc', 'YOUTUBE_API_KEY'), 'abc')
  assert.equal(readEnvValue('export YOUTUBE_API_KEY="abc"', 'YOUTUBE_API_KEY'), 'abc')
})

test('readEnvValue ignora linhas de comentário', () => {
  assert.equal(readEnvValue('# YOUTUBE_API_KEY=abc', 'YOUTUBE_API_KEY'), null)
  assert.equal(readEnvValue('# comentário\nYOUTUBE_API_KEY=abc', 'YOUTUBE_API_KEY'), 'abc')
})

test('readEnvValue remove comentário inline de valor sem aspas', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY=abc # minha chave', 'YOUTUBE_API_KEY'), 'abc')
  // "#" colado ao valor (sem espaço antes) faz parte do valor
  assert.equal(readEnvValue('YOUTUBE_API_KEY=abc#resto', 'YOUTUBE_API_KEY'), 'abc#resto')
})

test('readEnvValue remove aspas mesmo com comentário depois', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY="abc" # c', 'YOUTUBE_API_KEY'), 'abc')
})

test('readEnvValue aceita linhas terminadas em CRLF', () => {
  assert.equal(readEnvValue('A=1\r\nYOUTUBE_API_KEY=xyz\r\n', 'YOUTUBE_API_KEY'), 'xyz')
  assert.equal(readEnvValue('YOUTUBE_API_KEY="xyz"\r\n', 'YOUTUBE_API_KEY'), 'xyz')
})

test('readEnvValue retorna null quando o nome não existe', () => {
  assert.equal(readEnvValue('OUTRA=1', 'YOUTUBE_API_KEY'), null)
  assert.equal(readEnvValue('', 'YOUTUBE_API_KEY'), null)
})

test('readEnvValue retorna string vazia para valor vazio', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY=', 'YOUTUBE_API_KEY'), '')
  assert.equal(readEnvValue('YOUTUBE_API_KEY=   ', 'YOUTUBE_API_KEY'), '')
})

test('readEnvValue usa a última ocorrência do nome', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY=1\nYOUTUBE_API_KEY=2', 'YOUTUBE_API_KEY'), '2')
  assert.equal(readEnvValue('YOUTUBE_API_KEY=1\nYOUTUBE_API_KEY=', 'YOUTUBE_API_KEY'), '')
})

test('readEnvValue ignora nomes parecidos', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY_OLD=x\nYOUTUBE_API_KEY=y', 'YOUTUBE_API_KEY'), 'y')
  assert.equal(readEnvValue('XYOUTUBE_API_KEY=x', 'YOUTUBE_API_KEY'), null)
})

test('readEnvValue aceita espaços em volta do = e = dentro do valor', () => {
  assert.equal(readEnvValue('YOUTUBE_API_KEY  =  abc', 'YOUTUBE_API_KEY'), 'abc')
  assert.equal(readEnvValue('YOUTUBE_API_KEY=a=b', 'YOUTUBE_API_KEY'), 'a=b')
})

test('youtubeErrorStatus mapeia quotaExceeded para quota', () => {
  const raw = { error: { errors: [{ reason: 'quotaExceeded' }] } }
  assert.equal(youtubeErrorStatus(403, raw), 'quota')
})

test('youtubeErrorStatus mapeia limites de taxa e diários para quota', () => {
  assert.equal(youtubeErrorStatus(429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }), 'quota')
  assert.equal(youtubeErrorStatus(403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }), 'quota')
})

test('youtubeErrorStatus mapeia accessNotConfigured e serviceDisabled para api-disabled', () => {
  assert.equal(youtubeErrorStatus(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }), 'api-disabled')
  assert.equal(youtubeErrorStatus(403, { error: { errors: [{ reason: 'serviceDisabled' }] } }), 'api-disabled')
})

test('youtubeErrorStatus mapeia keyInvalid para invalid-key', () => {
  assert.equal(youtubeErrorStatus(400, { error: { errors: [{ reason: 'keyInvalid' }] } }), 'invalid-key')
  assert.equal(youtubeErrorStatus(400, { error: { errors: [{ reason: 'API_KEY_INVALID' }] } }), 'invalid-key')
})

test('youtubeErrorStatus trata 403 sem corpo como invalid-key', () => {
  assert.equal(youtubeErrorStatus(403, null), 'invalid-key')
  assert.equal(youtubeErrorStatus(403, undefined), 'invalid-key')
})

test('youtubeErrorStatus trata 400 e 401 sem motivo conhecido como invalid-key', () => {
  assert.equal(youtubeErrorStatus(400, {}), 'invalid-key')
  assert.equal(youtubeErrorStatus(401, { error: { errors: [{}] } }), 'invalid-key')
})

test('youtubeErrorStatus devolve unavailable para erro de servidor sem motivo conhecido', () => {
  assert.equal(youtubeErrorStatus(500, null), 'unavailable')
  assert.equal(youtubeErrorStatus(503, { error: { errors: [{ reason: 'backendError' }] } }), 'unavailable')
})

test('youtubeErrorStatus dá prioridade a quota sobre outros motivos', () => {
  const raw = { error: { errors: [{ reason: 'keyInvalid' }, { reason: 'quotaExceeded' }] } }
  assert.equal(youtubeErrorStatus(403, raw), 'quota')
})
