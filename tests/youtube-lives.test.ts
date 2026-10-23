import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectCompetition,
  isLiveGameTitle,
  isValidYoutubeApiKey,
  parseYoutubeSearch,
  readEnvValue,
  youtubeErrorStatus,
} from '../src/youtube-lives.ts'

/** Monta um item de `search.list` com ao vivo válido por padrão. */
function item(videoId: string, title: string, extra: { channelTitle?: string; liveBroadcastContent?: string } = {}) {
  return {
    id: { videoId },
    snippet: {
      title,
      channelTitle: extra.channelTitle,
      liveBroadcastContent: extra.liveBroadcastContent ?? 'live',
    },
  }
}

test('parseYoutubeSearch retorna lista vazia para entrada que não é objeto', () => {
  assert.deepEqual(parseYoutubeSearch(null), [])
  assert.deepEqual(parseYoutubeSearch(undefined), [])
  assert.deepEqual(parseYoutubeSearch('texto'), [])
  assert.deepEqual(parseYoutubeSearch(42), [])
  assert.deepEqual(parseYoutubeSearch([item('abcdefghijk', 'A x B')]), [])
})

test('parseYoutubeSearch retorna lista vazia quando items falta ou não é array', () => {
  assert.deepEqual(parseYoutubeSearch({}), [])
  assert.deepEqual(parseYoutubeSearch({ items: 'x' }), [])
  assert.deepEqual(parseYoutubeSearch({ items: { 0: item('abcdefghijk', 'A x B') } }), [])
})

test('parseYoutubeSearch ignora linhas que não são objeto', () => {
  const raw = { items: [null, 'texto', 7, item('abcdefghijk', 'Flamengo x Vasco')] }
  const lives = parseYoutubeSearch(raw)
  assert.deepEqual(lives.map((live) => live.id), ['abcdefghijk'])
})

test('parseYoutubeSearch mantém só transmissões com liveBroadcastContent "live"', () => {
  const raw = {
    items: [
      item('aaaaaaaaaaa', 'Flamengo x Vasco', { liveBroadcastContent: 'live' }),
      item('bbbbbbbbbbb', 'Flamengo x Vasco', { liveBroadcastContent: 'upcoming' }),
      item('ccccccccccc', 'Flamengo x Vasco', { liveBroadcastContent: 'none' }),
      { id: { videoId: 'ddddddddddd' }, snippet: { title: 'Flamengo x Vasco' } },
    ],
  }
  assert.deepEqual(parseYoutubeSearch(raw).map((live) => live.id), ['aaaaaaaaaaa'])
})

test('parseYoutubeSearch descarta videoId inválido', () => {
  const raw = {
    items: [
      item('short', 'Flamengo x Vasco'),
      item('toolongvideoid1', 'Flamengo x Vasco'),
      item('abc/defghij', 'Flamengo x Vasco'),
      item('abc defghi', 'Flamengo x Vasco'),
      item('abcdefghij.', 'Flamengo x Vasco'),
      item('abcdefghi-k', 'Flamengo x Vasco'),
      { id: { videoId: 42 }, snippet: { title: 'Flamengo x Vasco', liveBroadcastContent: 'live' } },
      { snippet: { title: 'Flamengo x Vasco', liveBroadcastContent: 'live' } },
    ],
  }
  assert.deepEqual(parseYoutubeSearch(raw).map((live) => live.id), ['abcdefghi-k'])
})

test('parseYoutubeSearch descarta ids duplicados e mantém a primeira ocorrência', () => {
  const raw = {
    items: [
      item('abcdefghijk', 'Flamengo x Vasco', { channelTitle: 'Canal 1' }),
      item('abcdefghijk', 'Outro x Jogo', { channelTitle: 'Canal 2' }),
    ],
  }
  const lives = parseYoutubeSearch(raw)
  assert.equal(lives.length, 1)
  assert.equal(lives[0].name, 'Flamengo x Vasco')
  assert.equal(lives[0].channel, 'Canal 1')
})

test('parseYoutubeSearch monta o objeto completo de uma transmissão válida', () => {
  const raw = { items: [item('dQw4w9WgXcQ', 'Copa do Brasil: Flamengo x Vasco', { channelTitle: 'Canal Esportes' })] }
  assert.deepEqual(parseYoutubeSearch(raw), [
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

test('parseYoutubeSearch usa o nome do canal como competição quando não identifica uma', () => {
  const raw = { items: [item('abcdefghijk', 'Flamengo x Vasco', { channelTitle: 'Canal Esportes' })] }
  const [live] = parseYoutubeSearch(raw)
  assert.equal(live.competition, 'Canal Esportes')
  assert.equal(live.channel, 'Canal Esportes')
})

test('parseYoutubeSearch usa "YouTube" quando o canal falta ou está vazio', () => {
  const raw = {
    items: [
      item('abcdefghijk', 'Flamengo x Vasco'),
      item('bcdefghijkl', 'Flamengo x Vasco', { channelTitle: '   ' }),
    ],
  }
  const lives = parseYoutubeSearch(raw)
  assert.deepEqual(lives.map((live) => live.channel), ['YouTube', 'YouTube'])
  assert.deepEqual(lives.map((live) => live.competition), ['YouTube', 'YouTube'])
})

test('parseYoutubeSearch remove a marca de som do título', () => {
  const raw = { items: [item('abcdefghijk', '🔊 Flamengo x Vasco 🔇')] }
  assert.equal(parseYoutubeSearch(raw)[0].name, 'Flamengo x Vasco')
})

test('parseYoutubeSearch decodifica entidades HTML do título', () => {
  const raw = {
    items: [
      item('aaaaaaaaaaa', 'Jogo &quot;Final&quot; Flamengo x Vasco'),
      item('bbbbbbbbbbb', 'Time d&#39;Ávila x Vasco'),
      item('ccccccccccc', 'Flamengo &amp; Amigos x Vasco'),
      item('ddddddddddd', 'Flamengo x Vasco &amp;quot;'),
    ],
  }
  const names = parseYoutubeSearch(raw).map((live) => live.name)
  assert.deepEqual(names, [
    'Jogo "Final" Flamengo x Vasco',
    "Time d'Ávila x Vasco",
    'Flamengo & Amigos x Vasco',
    // decodificação em uma única passagem: &amp;quot; vira &quot; e não "
    'Flamengo x Vasco &quot;',
  ])
})

test('parseYoutubeSearch limita o título a 200 caracteres', () => {
  const raw = { items: [item('abcdefghijk', `Flamengo x Vasco ${'z'.repeat(300)}`)] }
  const [live] = parseYoutubeSearch(raw)
  assert.equal(live.name.length, 200)
  assert.ok(live.name.startsWith('Flamengo x Vasco'))
})

test('parseYoutubeSearch descarta títulos sem confronto', () => {
  const raw = {
    items: [
      item('aaaaaaaaaaa', 'Transmissão ao vivo'),
      item('bbbbbbbbbbb', 'x'),
      item('ccccccccccc', 'Flamengo × '),
      item('ddddddddddd', 'vs'),
      item('eeeeeeeeeee', 'Flamengo x Vasco'),
    ],
  }
  assert.deepEqual(parseYoutubeSearch(raw).map((live) => live.id), ['eeeeeeeeeee'])
})

test('parseYoutubeSearch descarta títulos com palavras bloqueadas', () => {
  const titles = [
    'Flamengo x Vasco - REACT',
    'Reação: Flamengo x Vasco',
    'Flamengo x Vasco (Narração)',
    'eFootball Flamengo x Vasco',
    'FC 26 Flamengo x Vasco',
    'Pré-jogo: Flamengo x Vasco',
    'Flamengo x Vasco - Melhores momentos',
    'Basquete: Flamengo x Vasco',
    'Vôlei: Brasil x Itália',
  ]
  const raw = { items: titles.map((title, index) => item(`vid${String(index).padStart(8, '0')}`, title)) }
  assert.deepEqual(parseYoutubeSearch(raw), [])
})

test('parseYoutubeSearch processa no máximo as 200 primeiras linhas', () => {
  const items = Array.from({ length: 201 }, (_, index) =>
    item(`vid${String(index).padStart(8, '0')}`, `Time ${index} x Outro`),
  )
  const lives = parseYoutubeSearch({ items })
  assert.equal(lives.length, 200)
  assert.equal(lives[199].id, `vid${String(199).padStart(8, '0')}`)
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

test('parseYoutubeSearch descarta reprise de temporada antiga com year informado', () => {
  const raw = {
    items: [
      item('aaaaaaaaaaa', 'Barcelona 3 x 3 Real Madrid 2006/07'),
      item('bbbbbbbbbbb', 'Arsenal x Chelsea | Premier League 2025/26'),
    ],
  }
  const lives = parseYoutubeSearch(raw, 2026)
  assert.deepEqual(lives.map((live) => live.id), ['bbbbbbbbbbb'])
  assert.equal(lives[0].competition, 'Premier League')
})

test('parseYoutubeSearch inclui NBA e NFL com competição própria', () => {
  const raw = {
    items: [
      item('aaaaaaaaaaa', 'Lakers x Celtics | NBA', { channelTitle: 'Canal EUA' }),
      item('bbbbbbbbbbb', 'Chiefs vs Bills - NFL', { channelTitle: 'Canal EUA' }),
    ],
  }
  const lives = parseYoutubeSearch(raw, 2026)
  assert.deepEqual(lives.map((live) => live.competition), ['NBA', 'NFL'])
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
  assert.equal(detectCompetition('Libertadores Feminina: Corinthians x Boca'), 'Libertadores')
  assert.equal(detectCompetition('Premier League: Arsenal x Chelsea'), 'Premier League')
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
