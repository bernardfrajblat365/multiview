import { athletePhotoUrl, parseLineups, photoKey, type LineupTeam, type MatchInfoReady, type MatchInfoRequest, type MatchInfoResult, type PhotoRef } from '../src/match-info'
import { apiUrl, fetchJson } from './livescore-365'
import { loadImage } from './image-cache'

type PanelGame = { gameId: number; reversed: boolean }
type Lineup = [LineupTeam, LineupTeam]

const CACHE_MS = 30_000
const PHOTO_CONCURRENCY = 6
const IMAGE_BASE_URL = process.env.QUADRA_365SCORES_IMAGE_URL

/**
 * Qual jogo do 365Scores cada painel está vendo e as informações dele (escalação por enquanto).
 * Duas fontes de jogo: o vínculo do 365Scores (YouTube, BLL sem William Hill) e o jogo achado pelos escudos
 * (BLL com William Hill, já na ordem do feed). Painel BLL com William Hill também pode ter a escalação do
 * próprio radar, usada quando o 365Scores não tem a dele. Nada é buscado até a UI pedir.
 */
export function createMatchInfo(options: {
  onReady: (update: MatchInfoReady) => void
  /** Troque nos testes; por padrão, `/web/game/` do 365Scores. */
  fetchGame?: (gameId: number) => Promise<unknown>
}) {
  const linked = new Map<string, number>()
  const resolved = new Map<string, PanelGame>()
  const whLineups = new Map<string, Lineup>()
  /** O que a UI já sabe do painel (jogo ou só a escalação WH): só avisa quando muda. */
  const announced = new Map<string, string>()
  const games = new Map<number, { at: number; raw: Promise<unknown> }>()
  const fetchGame = options.fetchGame ?? ((gameId: number) => fetchJson(apiUrl('/web/game/', { gameId: String(gameId) })))

  function gameOf(panelId: string): PanelGame | null {
    const gameId = linked.get(panelId)
    if (gameId !== undefined) return { gameId, reversed: false }
    return resolved.get(panelId) ?? null
  }

  function announce(panelId: string) {
    const game = gameOf(panelId)
    const state = game ? `game:${game.gameId}` : whLineups.has(panelId) ? 'wh' : ''
    if (state === (announced.get(panelId) ?? '')) return
    if (!state) {
      announced.delete(panelId)
      options.onReady({ panelId, ready: false })
    } else {
      announced.set(panelId, state)
      options.onReady({ panelId, ready: true })
    }
  }

  /** Vínculo do 365Scores (null: desfeito). */
  function setLinked(panelId: string, gameId: number | null) {
    if (gameId === null) linked.delete(panelId)
    else linked.set(panelId, gameId)
    announce(panelId)
  }

  /** Jogo achado pelos nomes do feed William Hill (null: desfeito); `reversed`: o mandante do feed é o visitante no 365Scores. */
  function setResolved(panelId: string, game: PanelGame | null) {
    if (game === null) resolved.delete(panelId)
    else resolved.set(panelId, game)
    announce(panelId)
  }

  /** Escalação do radar William Hill do painel (null: desfeita). */
  function setWhLineup(panelId: string, lineup: Lineup | null) {
    if (lineup === null) whLineups.delete(panelId)
    else whLineups.set(panelId, lineup)
    announce(panelId)
  }

  /** O painel saiu do jogo (nova página, fechado): esquece as três fontes. */
  function clear(panelId: string) {
    linked.delete(panelId)
    resolved.delete(panelId)
    whLineups.delete(panelId)
    announce(panelId)
  }

  function reset() {
    for (const panelId of [...announced.keys()]) clear(panelId)
    games.clear()
  }

  /** Um pedido por vez por jogo: pedidos simultâneos compartilham a mesma resposta, que vale 30 s. */
  function rawGame(gameId: number) {
    const cached = games.get(gameId)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.raw
    const raw = fetchGame(gameId)
    const entry = { at: Date.now(), raw }
    games.set(gameId, entry)
    raw.catch(() => {
      if (games.get(gameId) === entry) games.delete(gameId)
    })
    if (games.size > 40) games.delete(games.keys().next().value as number)
    return raw
  }

  async function loadLineup(panelId: string): Promise<MatchInfoResult> {
    const game = gameOf(panelId)
    const wh = whLineups.get(panelId)
    let fallback: MatchInfoResult = { status: 'no-game' }
    if (game) {
      try {
        const parsed = parseLineups(await rawGame(game.gameId), game.gameId)
        if (parsed.status === 'ok') {
          const teams = game.reversed ? [parsed.teams[1], parsed.teams[0]] as Lineup : parsed.teams
          return { status: 'ok', tab: 'lineup', teams, live: parsed.live, source: '365' }
        }
        fallback = parsed.status === 'none' ? { status: 'none' } : { status: 'error' }
      } catch {
        fallback = { status: 'error' }
      }
    }
    // O 365Scores não tem a escalação (ou nem o jogo): o radar da William Hill, se o painel tem um.
    if (wh) return { status: 'ok', tab: 'lineup', teams: wh, live: true, source: 'wh' }
    return fallback
  }

  async function load(request: MatchInfoRequest): Promise<MatchInfoResult> {
    switch (request.tab) {
      case 'lineup':
        return loadLineup(request.panelId)
      default:
        return { status: 'error' }
    }
  }

  return { setLinked, setResolved, setWhLineup, clear, reset, load, gameOf }
}

/** Fotos dos atletas como data URLs, 6 por vez; `null`: sem foto (a UI mostra as iniciais). */
export async function loadAthletePhotos(refs: readonly PhotoRef[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  let next = 0
  const worker = async () => {
    while (next < refs.length) {
      const ref = refs[next++]
      result[photoKey(ref)] = await loadImage(`athlete:${photoKey(ref)}`, athletePhotoUrl(ref, IMAGE_BASE_URL))
    }
  }
  await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, refs.length) }, worker))
  return result
}
