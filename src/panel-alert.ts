export type PanelAlertKind = 'goal' | 'penalty' | 'red' | 'var'
export type PanelAlertTeam = 'home' | 'away' | null

export type PanelAlertPayload = {
  panelId: string
  kind: PanelAlertKind
  team: PanelAlertTeam
  label: string
}

const KIND_LABELS: Record<PanelAlertKind, string> = {
  goal: 'GOL',
  penalty: 'PÊNALTI',
  red: 'VERMELHO',
  var: 'VAR',
}

const TONE_HZ: Record<PanelAlertKind, number[]> = {
  goal: [880, 1175, 880],
  penalty: [740, 990],
  red: [520, 390, 520],
  var: [660, 660],
}

let audioContext: AudioContext | null = null

export function alertBadgeLabel(kind: PanelAlertKind, label?: string) {
  const custom = typeof label === 'string' ? label.trim() : ''
  return custom || KIND_LABELS[kind]
}

export function alertTeamLabel(team: PanelAlertTeam) {
  if (team === 'home') return 'Casa'
  if (team === 'away') return 'Fora'
  return null
}

function getAudioContext() {
  if (audioContext) return audioContext
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

export function playAlertTone(kind: PanelAlertKind) {
  const ctx = getAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {})
  const freqs = TONE_HZ[kind]
  const now = ctx.currentTime
  freqs.forEach((freq, index) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = freq
    const start = now + index * 0.14
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.12)
  })
}
