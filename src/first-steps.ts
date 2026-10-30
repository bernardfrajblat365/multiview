export type FirstStep = { title: string; body: string }

const STORAGE_KEY = 'quadra:first-steps-seen'

export const FIRST_STEPS: readonly FirstStep[] = [
  { title: 'Escolha quantas telas', body: 'De 1 a 18. O Quadra organiza tudo para o vídeo ocupar o máximo da tela.' },
  { title: 'Abra os jogos', body: 'Use "Abrir vários jogos da BLL" ou "Abrir jogos ao vivo do YouTube", ou cole o link de qualquer transmissão em uma tela.' },
  { title: 'Deixe os alertas trabalharem', body: 'Gol, pênalti, cartão e VAR tocam um som e colocam o jogo em destaque. Quando o jogo acaba, a tela fecha sozinha.' },
]

/**
 * Opens by itself only on a fresh install: no guide seen and no "what's new" ever shown.
 * Whoever already ran an older version has the "last seen" mark and finds the guide on the button.
 */
export function shouldShowFirstSteps(guideSeen: boolean, lastSeenVersion: string | null): boolean {
  return !guideSeen && lastSeenVersion === null
}

export function readFirstStepsSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markFirstStepsSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* storage unavailable: the guide opens again next launch */
  }
}
