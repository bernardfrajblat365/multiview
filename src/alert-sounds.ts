export type AlertToneKind = 'goal' | 'penalty' | 'red' | 'var'
export type AlertSoundGroup = 'classic' | 'modern' | 'siren'

export type AlertSoundOption = {
  id: number
  name: string
  group: AlertSoundGroup
  blurb: string
}

export const DEFAULT_ALERT_SOUND_ID = 1
export const ALERT_SOUND_STORAGE_KEY = 'quadra.alertSoundId'

export const ALERT_SOUND_GROUP_LABELS: Record<AlertSoundGroup, string> = {
  classic: 'Tons simples',
  modern: 'Mais limpos',
  siren: 'Sirenes',
}

export const ALERT_SOUNDS: AlertSoundOption[] = [
  { id: 1, name: 'Atual (quadrado)', group: 'classic', blurb: '3 notas rápidas — som padrão' },
  { id: 2, name: 'Sino suave', group: 'classic', blurb: 'Toque limpo com eco curto' },
  { id: 3, name: 'Ping brilhante', group: 'classic', blurb: 'Curto e nítido' },
  { id: 4, name: 'Duplo bipe', group: 'classic', blurb: 'Estilo notificação' },
  { id: 5, name: 'Arpejo ascendente', group: 'classic', blurb: 'Três notas subindo' },
  { id: 6, name: 'Alerta grave', group: 'classic', blurb: 'Tom de atenção mais baixo' },
  { id: 7, name: 'Marimba', group: 'classic', blurb: 'Dois toques quentes' },
  { id: 8, name: 'Click-tom', group: 'classic', blurb: 'Estalo + tom médio' },
  { id: 9, name: 'Fanfarra curta', group: 'classic', blurb: 'Três notas abertas' },
  { id: 10, name: 'Pulso + tom', group: 'classic', blurb: 'Batida suave + confirmação' },
  { id: 11, name: 'Sino de vidro', group: 'modern', blurb: 'Harmônicos suaves' },
  { id: 12, name: 'Campainha suave', group: 'modern', blurb: 'Ding-dong limpo' },
  { id: 13, name: 'Quemada de ar', group: 'modern', blurb: 'Sopro filtrado + brilho' },
  { id: 14, name: 'Acorde quente', group: 'modern', blurb: 'Pad curto aveludado' },
  { id: 15, name: 'Gotinha', group: 'modern', blurb: 'Ploc cristalino discreto' },
  { id: 16, name: 'Madeira + ressonância', group: 'modern', blurb: 'Toque seco com eco tonal' },
  { id: 17, name: 'Cristal', group: 'modern', blurb: 'Brilho alto suave' },
  { id: 18, name: 'Notificação limpa', group: 'modern', blurb: 'Dois tons curtos de UI' },
  { id: 19, name: 'Onda ascendente', group: 'modern', blurb: 'Sweep de filtro' },
  { id: 20, name: 'Toque de lounge', group: 'modern', blurb: 'Grave + harmônico alto' },
  { id: 21, name: 'Sirene clássica', group: 'siren', blurb: 'Sobe e desce contínuo' },
  { id: 22, name: 'Sirene rápida', group: 'siren', blurb: 'Wail curto e agitado' },
  { id: 23, name: 'Dois tons (Europa)', group: 'siren', blurb: 'Hi-lo alternando' },
  { id: 24, name: 'Yelp', group: 'siren', blurb: 'Chirps rápidos' },
  { id: 25, name: 'Alarme aéreo', group: 'siren', blurb: 'Sweep longo e grave' },
  { id: 26, name: 'Sirene suave', group: 'siren', blurb: 'Wail mais baixo' },
  { id: 27, name: 'Phaser', group: 'siren', blurb: 'Dois tons batendo' },
  { id: 28, name: 'Pulse sirene', group: 'siren', blurb: 'Tom com tremolo' },
  { id: 29, name: 'Subida única', group: 'siren', blurb: 'Uma subida e corta' },
  { id: 30, name: 'Sirene + golpe', group: 'siren', blurb: 'Wail curto com impacto' },
]

const KIND_HZ: Record<AlertToneKind, number[]> = {
  goal: [880, 1175, 880],
  penalty: [740, 990],
  red: [520, 390, 520],
  var: [660, 660],
}

const SOUND_BY_ID = new Map(ALERT_SOUNDS.map((sound) => [sound.id, sound]))

let audioContext: AudioContext | null = null
let selectedSoundId = loadStoredSoundId()

export function normalizeAlertSoundId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(id) || !SOUND_BY_ID.has(id)) return DEFAULT_ALERT_SOUND_ID
  return id
}

export function getAlertSoundId() {
  return selectedSoundId
}

export function getAlertSoundOption(id = selectedSoundId) {
  return SOUND_BY_ID.get(normalizeAlertSoundId(id)) ?? SOUND_BY_ID.get(DEFAULT_ALERT_SOUND_ID)!
}

export function alertSoundGroups(): { group: AlertSoundGroup; label: string; options: AlertSoundOption[] }[] {
  return (Object.keys(ALERT_SOUND_GROUP_LABELS) as AlertSoundGroup[]).map((group) => ({
    group,
    label: ALERT_SOUND_GROUP_LABELS[group],
    options: ALERT_SOUNDS.filter((sound) => sound.group === group),
  }))
}

export function setAlertSoundId(value: unknown) {
  selectedSoundId = normalizeAlertSoundId(value)
  try {
    globalThis.localStorage?.setItem(ALERT_SOUND_STORAGE_KEY, String(selectedSoundId))
  } catch {
    // Ignore quota / private-mode failures; in-memory selection still applies.
  }
  return selectedSoundId
}

function loadStoredSoundId() {
  try {
    return normalizeAlertSoundId(globalThis.localStorage?.getItem(ALERT_SOUND_STORAGE_KEY))
  } catch {
    return DEFAULT_ALERT_SOUND_ID
  }
}

function getAudioContext() {
  if (audioContext) return audioContext
  const Ctor = globalThis.AudioContext || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

export function playAlertSound(id: unknown = selectedSoundId, kind: AlertToneKind = 'goal') {
  const ctx = getAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {})
  const soundId = normalizeAlertSoundId(id)
  const now = ctx.currentTime
  playSoundAt(ctx, now, soundId, kind)
}

function playSoundAt(ctx: AudioContext, t0: number, soundId: number, kind: AlertToneKind) {
  switch (soundId) {
    case 1:
      beep(ctx, t0, { freqs: KIND_HZ[kind], type: 'square', step: 0.14, dur: 0.12, gain: 0.12 })
      return
    case 2:
      beep(ctx, t0, { freqs: [988], type: 'sine', step: 0, dur: 0.45, gain: 0.16, release: 0.42 })
      beep(ctx, t0 + 0.08, { freqs: [1319], type: 'sine', step: 0, dur: 0.35, gain: 0.08, release: 0.32 })
      return
    case 3:
      beep(ctx, t0, { freqs: [1320, 1760], type: 'triangle', step: 0.09, dur: 0.1, gain: 0.14 })
      return
    case 4:
      beep(ctx, t0, { freqs: [880, 880], type: 'sine', step: 0.18, dur: 0.1, gain: 0.14 })
      return
    case 5:
      beep(ctx, t0, { freqs: [659, 880, 1175], type: 'triangle', step: 0.11, dur: 0.13, gain: 0.13 })
      return
    case 6:
      beep(ctx, t0, { freqs: [392, 330, 392], type: 'square', step: 0.15, dur: 0.13, gain: 0.1 })
      return
    case 7:
      beep(ctx, t0, { freqs: [740, 988], type: 'sine', step: 0.16, dur: 0.28, gain: 0.15, release: 0.26 })
      return
    case 8:
      click(ctx, t0)
      beep(ctx, t0 + 0.04, { freqs: [660], type: 'triangle', step: 0, dur: 0.16, gain: 0.12, release: 0.14 })
      return
    case 9:
      beep(ctx, t0, { freqs: [784, 988, 1175], type: 'sawtooth', step: 0.13, dur: 0.15, gain: 0.07 })
      return
    case 10:
      thump(ctx, t0)
      beep(ctx, t0 + 0.1, { freqs: [880], type: 'sine', step: 0, dur: 0.22, gain: 0.12, release: 0.2 })
      return
    case 11:
      glassBell(ctx, t0, 784, 0.55)
      return
    case 12:
      glassBell(ctx, t0, 659, 0.42)
      glassBell(ctx, t0 + 0.28, 523, 0.5)
      return
    case 13:
      airWhoosh(ctx, t0)
      softPartial(ctx, t0 + 0.12, 880, 0.08, 0.35)
      return
    case 14:
      softChord(ctx, t0, [523, 659, 784], 0.55)
      return
    case 15:
      waterDrop(ctx, t0)
      return
    case 16:
      woodTick(ctx, t0)
      return
    case 17:
      crystal(ctx, t0)
      return
    case 18:
      softPartial(ctx, t0, 1175, 0.11, 0.18)
      softPartial(ctx, t0 + 0.14, 1568, 0.1, 0.22)
      return
    case 19:
      filterSweep(ctx, t0)
      return
    case 20:
      loungeHit(ctx, t0)
      return
    case 21:
      wailSiren(ctx, t0, { lo: 650, hi: 980, cycles: 2, period: 0.55, gain: 0.13 })
      return
    case 22:
      wailSiren(ctx, t0, { lo: 720, hi: 1180, cycles: 3, period: 0.28, gain: 0.12 })
      return
    case 23:
      twoToneSiren(ctx, t0, { hi: 980, lo: 740, step: 0.22, pairs: 3, gain: 0.13 })
      return
    case 24:
      yelpSiren(ctx, t0)
      return
    case 25:
      airRaidSiren(ctx, t0)
      return
    case 26:
      wailSiren(ctx, t0, { lo: 480, hi: 720, cycles: 2, period: 0.42, gain: 0.1, type: 'sine' })
      return
    case 27:
      phaserSiren(ctx, t0)
      return
    case 28:
      pulseSiren(ctx, t0)
      return
    case 29:
      risingSiren(ctx, t0)
      return
    case 30:
      wailSiren(ctx, t0, { lo: 600, hi: 900, cycles: 1.5, period: 0.4, gain: 0.11 })
      thump(ctx, t0 + 0.85)
      softPartial(ctx, t0 + 0.88, 660, 0.1, 0.2)
      return
    default:
      beep(ctx, t0, { freqs: KIND_HZ.goal, type: 'square', step: 0.14, dur: 0.12, gain: 0.12 })
  }
}

function beep(
  audioCtx: AudioContext,
  t0: number,
  {
    freqs,
    type,
    step,
    dur,
    gain,
    release,
  }: {
    freqs: number[]
    type: OscillatorType
    step: number
    dur: number
    gain: number
    release?: number
  },
) {
  const rel = release ?? Math.max(0.08, dur - 0.02)
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    const start = t0 + i * step
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, start + rel)
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  })
}

function click(audioCtx: AudioContext, t0: number) {
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.02), audioCtx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.25))
  }
  const src = audioCtx.createBufferSource()
  const g = audioCtx.createGain()
  src.buffer = buf
  g.gain.value = 0.18
  src.connect(g)
  g.connect(audioCtx.destination)
  src.start(t0)
}

function thump(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(140, t0)
  osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.16)
}

function softPartial(audioCtx: AudioContext, t0: number, freq: number, peak: number, release: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  const filter = audioCtx.createBiquadFilter()
  osc.type = 'sine'
  osc.frequency.value = freq
  filter.type = 'lowpass'
  filter.frequency.value = freq * 3.2
  filter.Q.value = 0.7
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + release)
  osc.connect(filter)
  filter.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + release + 0.03)
}

function glassBell(audioCtx: AudioContext, t0: number, fundamental: number, release: number) {
  const partials: Array<[number, number]> = [
    [1, 0.16],
    [2.0, 0.07],
    [2.76, 0.045],
    [4.07, 0.025],
    [5.43, 0.015],
  ]
  for (const [ratio, peak] of partials) {
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = fundamental * ratio
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + release * (ratio > 2 ? 0.55 : 1))
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + release + 0.05)
  }
}

function noiseBuffer(audioCtx: AudioContext, seconds: number) {
  const len = Math.floor(audioCtx.sampleRate * seconds)
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function airWhoosh(audioCtx: AudioContext, t0: number) {
  const src = audioCtx.createBufferSource()
  const filter = audioCtx.createBiquadFilter()
  const g = audioCtx.createGain()
  src.buffer = noiseBuffer(audioCtx, 0.45)
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(400, t0)
  filter.frequency.exponentialRampToValueAtTime(2400, t0 + 0.28)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
  src.connect(filter)
  filter.connect(g)
  g.connect(audioCtx.destination)
  src.start(t0)
  src.stop(t0 + 0.45)
}

function softChord(audioCtx: AudioContext, t0: number, freqs: number[], release: number) {
  freqs.forEach((freq, i) => softPartial(audioCtx, t0 + i * 0.02, freq, 0.07, release))
}

function waterDrop(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1200, t0)
  osc.frequency.exponentialRampToValueAtTime(620, t0 + 0.18)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.32)
  softPartial(audioCtx, t0 + 0.02, 1800, 0.04, 0.2)
}

function woodTick(audioCtx: AudioContext, t0: number) {
  const src = audioCtx.createBufferSource()
  const filter = audioCtx.createBiquadFilter()
  const g = audioCtx.createGain()
  src.buffer = noiseBuffer(audioCtx, 0.08)
  filter.type = 'bandpass'
  filter.frequency.value = 900
  filter.Q.value = 8
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07)
  src.connect(filter)
  filter.connect(g)
  g.connect(audioCtx.destination)
  src.start(t0)
  src.stop(t0 + 0.08)
  softPartial(audioCtx, t0 + 0.01, 420, 0.09, 0.35)
  softPartial(audioCtx, t0 + 0.015, 840, 0.04, 0.25)
}

function crystal(audioCtx: AudioContext, t0: number) {
  ;[1046, 1568, 2093].forEach((freq, i) => {
    softPartial(audioCtx, t0 + i * 0.06, freq, 0.07 - i * 0.012, 0.55 - i * 0.08)
  })
  const src = audioCtx.createBufferSource()
  const hp = audioCtx.createBiquadFilter()
  const g = audioCtx.createGain()
  src.buffer = noiseBuffer(audioCtx, 0.2)
  hp.type = 'highpass'
  hp.frequency.value = 5000
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
  src.connect(hp)
  hp.connect(g)
  g.connect(audioCtx.destination)
  src.start(t0)
  src.stop(t0 + 0.2)
}

function filterSweep(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const filter = audioCtx.createBiquadFilter()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 220
  filter.type = 'lowpass'
  filter.Q.value = 6
  filter.frequency.setValueAtTime(300, t0)
  filter.frequency.exponentialRampToValueAtTime(3200, t0 + 0.45)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55)
  osc.connect(filter)
  filter.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.58)
  softPartial(audioCtx, t0 + 0.35, 880, 0.06, 0.25)
}

function loungeHit(audioCtx: AudioContext, t0: number) {
  softPartial(audioCtx, t0, 196, 0.14, 0.55)
  softPartial(audioCtx, t0 + 0.02, 392, 0.07, 0.45)
  softPartial(audioCtx, t0 + 0.08, 1175, 0.06, 0.5)
  softPartial(audioCtx, t0 + 0.14, 1568, 0.035, 0.4)
}

function wailSiren(
  audioCtx: AudioContext,
  t0: number,
  {
    lo,
    hi,
    cycles,
    period,
    gain,
    type = 'triangle',
  }: { lo: number; hi: number; cycles: number; period: number; gain: number; type?: OscillatorType },
) {
  const dur = cycles * period
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(lo, t0)
  const steps = Math.max(2, Math.ceil(cycles * 2))
  for (let i = 0; i < steps; i++) {
    const t = t0 + (i + 1) * (period / 2)
    osc.frequency.linearRampToValueAtTime(i % 2 === 0 ? hi : lo, t)
  }
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03)
  g.gain.setValueAtTime(gain, t0 + dur - 0.08)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function twoToneSiren(
  audioCtx: AudioContext,
  t0: number,
  { hi, lo, step, pairs, gain }: { hi: number; lo: number; step: number; pairs: number; gain: number },
) {
  for (let i = 0; i < pairs; i++) {
    const base = t0 + i * step * 2
    toneBurst(audioCtx, base, hi, step * 0.92, gain)
    toneBurst(audioCtx, base + step, lo, step * 0.92, gain)
  }
}

function toneBurst(audioCtx: AudioContext, t0: number, freq: number, dur: number, gain: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.setValueAtTime(gain, t0 + dur - 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function yelpSiren(audioCtx: AudioContext, t0: number) {
  for (let i = 0; i < 6; i++) {
    const start = t0 + i * 0.14
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(700, start)
    osc.frequency.exponentialRampToValueAtTime(1400, start + 0.1)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(0.12, start + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(start)
    osc.stop(start + 0.13)
  }
}

function airRaidSiren(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(320, t0)
  osc.frequency.linearRampToValueAtTime(620, t0 + 0.7)
  osc.frequency.linearRampToValueAtTime(320, t0 + 1.35)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.05)
  g.gain.setValueAtTime(0.14, t0 + 1.2)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + 1.42)
  softPartial(audioCtx, t0, 640, 0.04, 1.3)
}

function phaserSiren(audioCtx: AudioContext, t0: number) {
  const dur = 1.05
  for (const [freq, peak] of [
    [700, 0.09],
    [714, 0.09],
  ] as const) {
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    osc.frequency.linearRampToValueAtTime(freq + 180, t0 + 0.5)
    osc.frequency.linearRampToValueAtTime(freq, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04)
    g.gain.setValueAtTime(peak, t0 + dur - 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }
}

function pulseSiren(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const amp = audioCtx.createGain()
  const lfo = audioCtx.createOscillator()
  const depth = audioCtx.createGain()
  const master = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 880
  amp.gain.value = 0.08
  lfo.type = 'sine'
  lfo.frequency.value = 8
  depth.gain.value = 0.07
  lfo.connect(depth)
  depth.connect(amp.gain)
  osc.connect(amp)
  amp.connect(master)
  master.gain.setValueAtTime(0, t0)
  master.gain.linearRampToValueAtTime(1, t0 + 0.03)
  master.gain.setValueAtTime(1, t0 + 0.85)
  master.gain.linearRampToValueAtTime(0, t0 + 0.95)
  master.connect(audioCtx.destination)
  osc.start(t0)
  lfo.start(t0)
  osc.stop(t0 + 0.97)
  lfo.stop(t0 + 0.97)
}

function risingSiren(audioCtx: AudioContext, t0: number) {
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(400, t0)
  osc.frequency.exponentialRampToValueAtTime(1300, t0 + 0.7)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.04)
  g.gain.setValueAtTime(0.13, t0 + 0.65)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8)
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.82)
}
