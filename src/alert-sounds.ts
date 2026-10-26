export type SoundNote = {
  /** Start offset in seconds. */
  at: number
  /** Duration in seconds. */
  dur: number
  freq: number
  /** Optional end frequency for a glide. */
  to?: number
  wave: OscillatorType
  gain: number
}

/** `notes` is empty for sounds that play an audio file (`src`). */
export type AlertSound = { id: string; label: string; notes: SoundNote[]; src?: string }

const n = (at: number, dur: number, freq: number, wave: OscillatorType = 'sine', gain = 0.5, to?: number): SoundNote => ({ at, dur, freq, wave, gain, to })

/** Evenly spaced sequence of notes. */
function seq(freqs: number[], step: number, dur: number, wave: OscillatorType, gain = 0.5): SoundNote[] {
  return freqs.map((freq, index) => n(index * step, dur, freq, wave, gain))
}

/** Same pitch repeated, e.g. whistles and buzzers. */
function repeat(count: number, step: number, dur: number, freq: number, wave: OscillatorType, gain = 0.5, to?: number): SoundNote[] {
  return Array.from({ length: count }, (_, index) => n(index * step, dur, freq, wave, gain, to))
}

/** Bell: fundamental plus inharmonic partials with a long decay. */
function bell(freq: number, dur = 1.2, gain = 0.45): SoundNote[] {
  return [n(0, dur, freq, 'sine', gain), n(0, dur * 0.7, freq * 2.76, 'sine', gain * 0.35), n(0, dur * 0.45, freq * 5.4, 'sine', gain * 0.15)]
}

export const ALERT_SOUNDS: readonly AlertSound[] = [
  { id: 'apito-arbitro', label: 'Apito de árbitro', notes: [n(0, 0.35, 2900, 'square', 0.28), n(0.45, 0.6, 2900, 'square', 0.28, 3100)] },
  { id: 'apito-triplo', label: 'Apito triplo', notes: repeat(3, 0.28, 0.2, 3000, 'square', 0.26) },
  { id: 'sino-igreja', label: 'Sino grave', notes: bell(330, 1.4) },
  { id: 'sino-agudo', label: 'Sino agudo', notes: bell(1040, 1.0) },
  { id: 'gongo', label: 'Gongo', notes: [n(0, 1.5, 110, 'sine', 0.6), n(0, 1.3, 164, 'triangle', 0.3), n(0, 1.0, 297, 'sine', 0.18)] },
  { id: 'campainha', label: 'Campainha', notes: [...seq([880, 660], 0.22, 0.22, 'sine', 0.5), ...seq([880, 660], 0.22, 0.22, 'sine', 0.5).map((note) => ({ ...note, at: note.at + 0.55 }))] },
  { id: 'chime-subindo', label: 'Chime subindo', notes: seq([523, 659, 784, 1047], 0.13, 0.5, 'sine', 0.4) },
  { id: 'chime-descendo', label: 'Chime descendo', notes: seq([1047, 784, 659, 523], 0.13, 0.5, 'sine', 0.4) },
  { id: 'buzina-estadio', label: 'Buzina de estádio', notes: [n(0, 0.9, 220, 'sawtooth', 0.35), n(0, 0.9, 277, 'sawtooth', 0.28), n(0, 0.9, 330, 'sawtooth', 0.25)] },
  { id: 'buzina-curta', label: 'Buzina curta', notes: repeat(2, 0.3, 0.2, 247, 'sawtooth', 0.4) },
  { id: 'sirene', label: 'Sirene', notes: [n(0, 0.5, 600, 'sawtooth', 0.28, 1000), n(0.5, 0.5, 1000, 'sawtooth', 0.28, 600), n(1.0, 0.4, 600, 'sawtooth', 0.28, 900)] },
  { id: 'arcade-moeda', label: 'Arcade: moeda', notes: [n(0, 0.08, 988, 'square', 0.3), n(0.08, 0.5, 1319, 'square', 0.3)] },
  { id: 'arcade-power-up', label: 'Arcade: power-up', notes: seq([392, 523, 659, 784, 1047, 1319], 0.07, 0.12, 'square', 0.25) },
  { id: 'arcade-vitoria', label: 'Arcade: vitória', notes: [...seq([523, 523, 523], 0.12, 0.1, 'square', 0.28), n(0.45, 0.55, 784, 'square', 0.3)] },
  { id: 'sonar', label: 'Sonar', notes: [n(0, 0.9, 1200, 'sine', 0.5), n(0.04, 0.8, 1200, 'sine', 0.15)] },
  { id: 'ping-duplo', label: 'Ping duplo', notes: [n(0, 0.35, 1568, 'sine', 0.45), n(0.22, 0.45, 2093, 'sine', 0.45)] },
  { id: 'xilofone', label: 'Xilofone', notes: seq([784, 988, 1175, 988, 1175, 1568], 0.1, 0.22, 'triangle', 0.45) },
  { id: 'harpa', label: 'Harpa', notes: seq([262, 330, 392, 523, 659, 784, 1047], 0.075, 0.9, 'sine', 0.32) },
  { id: 'fanfarra', label: 'Fanfarra', notes: [n(0, 0.18, 392, 'sawtooth', 0.28), n(0.2, 0.18, 392, 'sawtooth', 0.28), n(0.4, 0.18, 392, 'sawtooth', 0.28), n(0.62, 0.7, 523, 'sawtooth', 0.32)] },
  { id: 'trombeta', label: 'Trombeta', notes: [n(0, 0.25, 523, 'sawtooth', 0.3), n(0.28, 0.25, 659, 'sawtooth', 0.3), n(0.56, 0.7, 784, 'sawtooth', 0.32)] },
  { id: 'alerta-urgente', label: 'Alerta urgente', notes: repeat(4, 0.16, 0.1, 1800, 'square', 0.3) },
  { id: 'alarme-digital', label: 'Alarme digital', notes: [...repeat(3, 0.18, 0.12, 1400, 'square', 0.28), ...repeat(3, 0.18, 0.12, 1900, 'square', 0.28).map((note) => ({ ...note, at: note.at + 0.7 }))] },
  { id: 'bolha', label: 'Bolha', notes: [n(0, 0.18, 300, 'sine', 0.55, 900), n(0.2, 0.15, 400, 'sine', 0.45, 1100)] },
  { id: 'laser', label: 'Laser', notes: [n(0, 0.35, 2400, 'sawtooth', 0.28, 300)] },
  { id: 'tambor', label: 'Tambor', notes: [n(0, 0.25, 140, 'sine', 0.7, 60), n(0.22, 0.25, 140, 'sine', 0.7, 60), n(0.44, 0.45, 120, 'sine', 0.8, 45)] },
  { id: 'acorde-maior', label: 'Acorde maior', notes: [n(0, 1.1, 262, 'triangle', 0.38), n(0, 1.1, 330, 'triangle', 0.32), n(0, 1.1, 392, 'triangle', 0.3), n(0, 1.1, 523, 'triangle', 0.22)] },
  { id: 'acorde-menor', label: 'Acorde menor', notes: [n(0, 1.1, 220, 'triangle', 0.38), n(0, 1.1, 262, 'triangle', 0.32), n(0, 1.1, 330, 'triangle', 0.3), n(0, 1.1, 440, 'triangle', 0.22)] },
  { id: 'telefone', label: 'Telefone antigo', notes: Array.from({ length: 8 }, (_, index) => n(index * 0.07, 0.06, index % 2 === 0 ? 1100 : 1400, 'square', 0.22)) },
  { id: 'corneta', label: 'Corneta de torcida', notes: [n(0, 0.4, 466, 'sawtooth', 0.34), n(0.45, 0.8, 622, 'sawtooth', 0.36)] },
  { id: 'cuco', label: 'Cuco', notes: [n(0, 0.28, 784, 'sine', 0.5), n(0.36, 0.45, 622, 'sine', 0.5)] },
  { id: 'galvao-bueno', label: 'Galvão Bueno', notes: [], src: new URL('./assets/sounds/galvao-bueno.mp3', import.meta.url).href },
  { id: 'gol-torcida', label: 'Gol torcida', notes: [], src: new URL('./assets/sounds/gol-torcida.mp3', import.meta.url).href },
  { id: 'fox-sports', label: 'Fox Sports', notes: [], src: new URL('./assets/sounds/fox-sports.mp3', import.meta.url).href },
]

export const ALERT_SOUND_IDS: readonly string[] = ALERT_SOUNDS.map((sound) => sound.id)
const THROTTLE_MS = 800
let audioContext: AudioContext | null = null
let lastPlayedAt = 0

export function getAlertSound(id: string): AlertSound {
  return ALERT_SOUNDS.find((sound) => sound.id === id) ?? ALERT_SOUNDS[0]
}

function getContext() {
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioContext = new Ctor()
  }
  if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {})
  return audioContext
}

/**
 * Level of the keep-alive signal: ~-80 dBFS DC, inaudible but not digital silence.
 * With every panel muted no other stream holds the output open; Chromium parks a silent
 * AudioContext on a fake sink and some outputs (Bluetooth, HDMI, USB) go idle, so the
 * first ~0.5–1 s of an alert (the whole whistle) was lost while they woke up.
 */
export const KEEP_AWAKE_LEVEL = 1e-4
let keepAwake: ConstantSourceNode | null = null

/** Keeps the alert output stream running while alerts can fire (idempotent). */
export function setAlertAudioAwake(awake: boolean) {
  if (!awake) {
    if (keepAwake) {
      keepAwake.stop()
      keepAwake.disconnect()
      keepAwake = null
    }
    return
  }
  const context = getContext()
  if (!context || keepAwake) return
  keepAwake = context.createConstantSource()
  keepAwake.offset.value = KEEP_AWAKE_LEVEL
  keepAwake.connect(context.destination)
  keepAwake.start()
}

/** Plays a sound. `force` skips the throttle (used by the preview in the picker). */
export function playAlertSound(id: string, options: { volume?: number; force?: boolean } = {}) {
  const now = Date.now()
  if (!options.force && now - lastPlayedAt < THROTTLE_MS) return false
  const volume = Math.max(0, Math.min(1, options.volume ?? 0.8))
  const sound = getAlertSound(id)
  if (sound.src) {
    lastPlayedAt = now
    const audio = new Audio(sound.src)
    audio.volume = volume
    void audio.play().catch(() => {})
    return true
  }
  const context = getContext()
  if (!context) return false
  lastPlayedAt = now
  const start = context.currentTime + 0.02
  for (const note of sound.notes) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const from = start + note.at
    const until = from + note.dur
    oscillator.type = note.wave
    oscillator.frequency.setValueAtTime(note.freq, from)
    if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, until)
    gain.gain.setValueAtTime(0.0001, from)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.gain * volume), from + Math.min(0.015, note.dur / 4))
    gain.gain.exponentialRampToValueAtTime(0.0001, until)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(from)
    oscillator.stop(until + 0.05)
  }
  return true
}
