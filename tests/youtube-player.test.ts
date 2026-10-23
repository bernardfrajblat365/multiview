import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isYoutubeWatchUrl,
  YOUTUBE_AD_URL_PATTERNS,
  youtubeAdSkipScript,
  youtubePlayerCss,
} from '../electron/youtube-player.ts'

test('isYoutubeWatchUrl aceita watch e live nos hosts reais do YouTube', () => {
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/watch?v=abc', undefined), true)
  assert.equal(isYoutubeWatchUrl('https://youtube.com/watch?v=abc', undefined), true)
  assert.equal(isYoutubeWatchUrl('https://m.youtube.com/watch?v=abc', undefined), true)
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/live/abc', undefined), true)
})

test('isYoutubeWatchUrl recusa shorts, home, canais, embed e hosts estranhos', () => {
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/shorts/abc', undefined), false)
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/', undefined), false)
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/@canal', undefined), false)
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/embed/abc', undefined), false)
  assert.equal(isYoutubeWatchUrl('https://example.com/watch?v=abc', undefined), false)
})

test('isYoutubeWatchUrl recusa URL inválida, esquemas não HTTP(S) e http nos hosts reais', () => {
  assert.equal(isYoutubeWatchUrl('não é uma url', undefined), false)
  assert.equal(isYoutubeWatchUrl('ftp://www.youtube.com/watch?v=abc', undefined), false)
  assert.equal(isYoutubeWatchUrl('javascript:alert(1)//www.youtube.com/watch', undefined), false)
  assert.equal(isYoutubeWatchUrl('http://www.youtube.com/watch', undefined), false)
})

test('isYoutubeWatchUrl aceita a origem extra só quando a origem bate exatamente', () => {
  assert.equal(
    isYoutubeWatchUrl('http://127.0.0.1:5555/watch?v=x', 'http://127.0.0.1:5555'),
    true,
  )
  assert.equal(
    isYoutubeWatchUrl('http://127.0.0.1:6666/watch?v=x', 'http://127.0.0.1:5555'),
    false,
  )
  assert.equal(isYoutubeWatchUrl('http://127.0.0.1:5555/watch?v=x', 'não é uma url'), false)
})

test('YOUTUBE_AD_URL_PATTERNS cobre as redes de anúncio e começa com *://', () => {
  const joined = YOUTUBE_AD_URL_PATTERNS.join('\n')
  assert.ok(joined.includes('doubleclick'))
  assert.ok(joined.includes('googlesyndication'))
  assert.ok(joined.includes('pagead'))
  assert.ok(joined.includes('api/stats/ads'))
  assert.ok(joined.includes('get_midroll_info'))
  assert.ok(joined.includes('googleadservices'))
  for (const pattern of YOUTUBE_AD_URL_PATTERNS) {
    assert.ok(pattern.startsWith('*://'), `padrão sem *:// : ${pattern}`)
  }
})

test('youtubePlayerCss esconde o chrome do YouTube e fixa o player', () => {
  assert.ok(youtubePlayerCss.includes('#movie_player'))
  assert.ok(youtubePlayerCss.includes('#chat'))
  assert.ok(youtubePlayerCss.includes('position: fixed'))
  assert.equal(youtubePlayerCss.includes('ytd-popup-container'), false)
})

test('youtubeAdSkipScript define o marcador do mundo e o seletor de pular anúncio', () => {
  assert.ok(youtubeAdSkipScript.includes('__quadraYt'))
  assert.ok(youtubeAdSkipScript.includes('ytp-skip-ad-button'))
})
