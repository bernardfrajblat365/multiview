import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUrl } from '../src/routing.ts'

test('normaliza URLs simples e adiciona HTTPS', () => {
  assert.equal(normalizeUrl('  twitch.tv/example  '), 'https://twitch.tv/example')
  assert.equal(normalizeUrl(''), '')
})

test('extrai iframe e converte formatos YouTube para watch', () => {
  assert.equal(
    normalizeUrl('<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>'),
    'https://www.youtube.com/watch?v=abcdefghijk',
  )
  assert.equal(normalizeUrl('youtu.be/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(normalizeUrl('https://youtube.com/shorts/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk')
})

test('preserva páginas YouTube watch e live já válidas', () => {
  assert.equal(
    normalizeUrl('https://www.youtube.com/watch?v=abcdefghijk&list=xyz'),
    'https://www.youtube.com/watch?v=abcdefghijk&list=xyz',
  )
  assert.equal(
    normalizeUrl('https://www.youtube.com/live/abcdefghijk'),
    'https://www.youtube.com/live/abcdefghijk',
  )
})

test('mantém qualquer site como uma URL comum', () => {
  assert.equal(normalizeUrl('https://video.example.com/title/1'), 'https://video.example.com/title/1')
  assert.equal(normalizeUrl('https://live.example.com/video/1'), 'https://live.example.com/video/1')
  assert.equal(normalizeUrl('https://case.tv/live'), 'https://case.tv/live')
})
