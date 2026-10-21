import { playAlertSound } from './alert-sounds'

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

export function alertBadgeLabel(kind: PanelAlertKind, label?: string) {
  const custom = typeof label === 'string' ? label.trim() : ''
  return custom || KIND_LABELS[kind]
}

export function alertTeamLabel(team: PanelAlertTeam) {
  if (team === 'home') return 'casa'
  if (team === 'away') return 'fora'
  return null
}

/** Compact single-line badge text, e.g. "Gol - fora". */
export function formatAlertBadgeLine(kind: PanelAlertKind, label: string | undefined, team: PanelAlertTeam) {
  const raw = alertBadgeLabel(kind, label)
  const title =
    raw === raw.toUpperCase() && raw.length <= 12
      ? raw.charAt(0) + raw.slice(1).toLocaleLowerCase('pt-BR')
      : raw
  const side = alertTeamLabel(team)
  return side ? `${title} - ${side}` : title
}

export function playAlertTone(kind: PanelAlertKind) {
  playAlertSound(undefined, kind)
}
