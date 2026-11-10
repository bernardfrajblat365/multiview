import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoOpenDecision,
  autoOpenSound,
  autoSearchPlaceholders,
  competitionRuleOf,
  defaultAutoOpenSettings,
  gameKey,
  mainTeamOf,
  mergeAutoOpenCandidates,
  matchesCustomCompetition,
  parseAutoOpenSettings,
  planAutoOpen,
  youtubeAutoOpenDecision,
  type AutoOpenPanel,
} from '../src/auto-open.ts'

const settings = defaultAutoOpenSettings()
const decide = (name: string, competition: string, extra: { basketball?: boolean } = {}) => autoOpenDecision({ name, competition, ...extra }, settings)

test('competitionRuleOf recognizes listed leagues by country and name', () => {
  assert.equal(competitionRuleOf('England, Premier League')?.id, 'premier-league')
  assert.equal(competitionRuleOf('Spain, LaLiga')?.id, 'laliga')
  assert.equal(competitionRuleOf('Spain, La Liga, Round 10')?.id, 'laliga')
  assert.equal(competitionRuleOf('Italy, Serie A')?.id, 'serie-a')
  assert.equal(competitionRuleOf('Brazil, Serie A')?.id, 'brasileirao')
  assert.equal(competitionRuleOf('Brasil, Brasileirão Série A')?.id, 'brasileirao')
  assert.equal(competitionRuleOf('Germany, Bundesliga')?.id, 'bundesliga')
  assert.equal(competitionRuleOf('France, Ligue 1')?.id, 'ligue-1')
  assert.equal(competitionRuleOf('Germany, DFB-Pokal, Round 2')?.id, 'dfb-pokal')
  assert.equal(competitionRuleOf('England, EFL Cup')?.id, 'efl-cup')
  assert.equal(competitionRuleOf('Spain, Supercopa')?.id, 'supercopa-espana')
})

test('competitionRuleOf recognizes UEFA competitions with or without a region', () => {
  assert.equal(competitionRuleOf('UEFA Champions League, League Phase')?.id, 'champions-league')
  assert.equal(competitionRuleOf('Europe, Champions League')?.id, 'champions-league')
  assert.equal(competitionRuleOf('International Clubs, UEFA Europa League')?.id, 'europa-league')
  assert.equal(competitionRuleOf('UEFA Conference League')?.id, 'conference-league')
  assert.equal(competitionRuleOf('UEFA Super Cup')?.id, 'uefa-super-cup')
})

test('competitionRuleOf leaves out other leagues and women/youth sides', () => {
  assert.equal(competitionRuleOf('England, Championship'), null)
  assert.equal(competitionRuleOf('England, Premier League 2'), null)
  assert.equal(competitionRuleOf('Germany, 2. Bundesliga'), null)
  assert.equal(competitionRuleOf('Russia, Premier League'), null)
  assert.equal(competitionRuleOf('Italy, Serie B'), null)
  assert.equal(competitionRuleOf('Asia, AFC Champions League'), null)
  assert.equal(competitionRuleOf('UEFA Champions League Women'), null)
  assert.equal(competitionRuleOf('Europe, UEFA Youth League'), null)
  assert.equal(competitionRuleOf('England, FA Cup, U21'), null)
  assert.equal(competitionRuleOf('Spain, Cup'), competitionRuleOf('Spain, Copa del Rey'))
})

test('mainTeamOf needs the whole name and skips women, youth and reserve sides', () => {
  const teams = settings.teams
  assert.equal(mainTeamOf('Bayern München x Werder Bremen', teams), 'Bayern de Munique')
  assert.equal(mainTeamOf('Real Madrid x Getafe', teams), 'Real Madrid')
  assert.equal(mainTeamOf('Celta x Atletico Madrid', teams), 'Atlético de Madrid')
  assert.equal(mainTeamOf('AC Milan x Lecce', teams), 'Milan')
  assert.equal(mainTeamOf('Inter Milan x Lecce', teams), 'Internazionale')
  assert.equal(mainTeamOf('Man Utd x Fulham', teams), 'Manchester United')
  assert.equal(mainTeamOf('Tottenham Hotspur x Brentford', teams), 'Tottenham')
  assert.equal(mainTeamOf('Paris Saint-Germain x Lens', teams), 'Paris Saint-Germain')
  assert.equal(mainTeamOf('AS Roma x Torino', teams), 'Roma')
  assert.equal(mainTeamOf('Real Madrid Castilla x Ourense', teams), null)
  assert.equal(mainTeamOf('Barcelona (F) x Levante (F)', teams), null)
  assert.equal(mainTeamOf('Bayern II x Unterhaching', teams), null)
  assert.equal(mainTeamOf('Real Sociedad x Getafe', teams), null)
  assert.equal(mainTeamOf('Sem confronto', teams), null)
})

test('autoOpenDecision opens every game of a league and only main teams in cups', () => {
  assert.deepEqual(decide('Brentford x Fulham', 'England, Premier League'), { open: true, mainTeam: null })
  assert.deepEqual(decide('Flamengo x Palmeiras', 'Brazil, Copa do Brasil'), { open: true, mainTeam: null })
  assert.deepEqual(decide('Brentford x Fulham', 'England, FA Cup'), { open: false, mainTeam: null })
  assert.deepEqual(decide('Brentford x Arsenal', 'England, FA Cup, Round 3'), { open: true, mainTeam: 'Arsenal' })
  assert.deepEqual(decide('Arsenal x Brentford', 'Club Friendlies'), { open: false, mainTeam: 'Arsenal' })
  assert.deepEqual(decide('Real Madrid x Barcelona', 'Euroleague', { basketball: true }), { open: false, mainTeam: null })
})

test('autoOpenDecision follows modes, custom competitions and teams anywhere', () => {
  const custom = parseAutoOpenSettings(JSON.stringify({
    competitions: { 'premier-league': 'teams', bundesliga: 'off' },
    custom: [{ name: 'Portugal, Liga Portugal', mode: 'all' }],
    teams: ['Benfica / SL Benfica', 'Arsenal'],
    teamsAnywhere: true,
  }))
  assert.equal(autoOpenDecision({ name: 'Brentford x Fulham', competition: 'England, Premier League' }, custom).open, false)
  assert.equal(autoOpenDecision({ name: 'Arsenal x Fulham', competition: 'England, Premier League' }, custom).open, true)
  assert.equal(autoOpenDecision({ name: 'Mainz x Freiburg', competition: 'Germany, Bundesliga' }, custom).open, false)
  assert.equal(autoOpenDecision({ name: 'Porto x Braga', competition: 'Portugal, Liga Portugal, Round 9' }, custom).open, true)
  assert.deepEqual(autoOpenDecision({ name: 'SL Benfica x Ajax', competition: 'Club Friendlies' }, custom), { open: true, mainTeam: 'Benfica' })
})

test('matchesCustomCompetition accepts the league or just its name', () => {
  assert.equal(matchesCustomCompetition('Portugal, Liga Portugal, Round 9', 'Liga Portugal'), true)
  assert.equal(matchesCustomCompetition('Portugal, Liga Portugal', 'portugal, liga portugal'), true)
  assert.equal(matchesCustomCompetition('Copa Libertadores, Final', 'Copa Libertadores'), true)
  assert.equal(matchesCustomCompetition('Portugal, Liga Portugal 2', 'Liga Portugal'), false)
  assert.equal(matchesCustomCompetition('Portugal, Liga Portugal', '  '), false)
})

test('parseAutoOpenSettings falls back to defaults on bad data', () => {
  assert.deepEqual(parseAutoOpenSettings(null), defaultAutoOpenSettings())
  assert.deepEqual(parseAutoOpenSettings('{bad'), defaultAutoOpenSettings())
  const parsed = parseAutoOpenSettings(JSON.stringify({
    competitions: { laliga: 'nope', 'fa-cup': 'all' },
    custom: [{ name: 'X', mode: 'bad' }, { name: 'Liga Y', mode: 'teams' }, { name: 'liga y', mode: 'all' }],
    teams: ['Arsenal', 'arsenal', '', 42],
    teamsAnywhere: 'yes',
  }))
  assert.equal(parsed.competitions.laliga, 'all')
  assert.equal(parsed.competitions['fa-cup'], 'all')
  assert.deepEqual(parsed.custom, [{ name: 'Liga Y', mode: 'teams' }])
  assert.deepEqual(parsed.teams, ['Arsenal'])
  assert.equal(parsed.teamsAnywhere, false)
})

test('defaults: leagues and Brazilian cups open all games, domestic European cups only main teams', () => {
  assert.equal(settings.competitions['champions-league'], 'all')
  assert.equal(settings.competitions['copa-do-brasil'], 'all')
  assert.equal(settings.competitions['uefa-super-cup'], 'all')
  assert.equal(settings.competitions['coppa-italia'], 'teams')
  assert.equal(settings.competitions['dfl-supercup'], 'teams')
  assert.equal(settings.teams.length, 22)
})

const panel = (id: string, url: string, auto = false, mainTeam = false): AutoOpenPanel => ({ id, url, auto, mainTeam })

test('planAutoOpen fills empty panels, then adds panels, skipping games already open', () => {
  const plan = planAutoOpen([panel('a', 'u1'), panel('b', '')], [
    { url: 'u1', name: '', mainTeam: false },
    { url: 'u2', name: '', mainTeam: false },
    { url: 'u3', name: '', mainTeam: false },
  ], 18)
  assert.deepEqual(plan, { fill: [{ panelId: 'b', url: 'u2' }], extra: ['u3'], replace: [], skipped: 0 })
})

test('planAutoOpen gives main-team games priority when the grid is full', () => {
  const panels = [panel('a', 'u1'), panel('b', 'u2', true, false), panel('c', 'u3', true, true), panel('d', 'u4', true, false)]
  const plan = planAutoOpen(panels, [
    { url: 'n1', name: '', mainTeam: false },
    { url: 'm1', name: '', mainTeam: true },
    { url: 'm2', name: '', mainTeam: true },
    { url: 'm3', name: '', mainTeam: true },
  ], 4)
  // The user's panel (a) and the main-team panel (c) stay; m3 has nowhere left and waits like n1.
  assert.deepEqual(plan.replace, [{ panelId: 'b', url: 'm1' }, { panelId: 'd', url: 'm2' }])
  assert.deepEqual(plan.fill, [])
  assert.deepEqual(plan.extra, [])
  assert.equal(plan.skipped, 2)
})

test('planAutoOpen puts main-team games first in the remaining room', () => {
  const plan = planAutoOpen([panel('a', 'u1')], [
    { url: 'n1', name: '', mainTeam: false },
    { url: 'm1', name: '', mainTeam: true },
  ], 2)
  assert.deepEqual(plan.extra, ['m1'])
  assert.equal(plan.skipped, 1)
})

test('autoOpenSound: a game Auto mode opens is muted while another game is on screen', () => {
  // The user listens to game a (sound on) and the empty panel b is not muted: the new games still start muted.
  const panels = [{ id: 'a', url: 'u1', muted: false }, { id: 'b', url: '', muted: false }]
  const sound = autoOpenSound(panels, { fill: [{ panelId: 'b', url: 'u2' }], extra: ['u3'], replace: [], skipped: 0 }, false)
  assert.equal(sound.panels.get('b'), true)
  assert.deepEqual(sound.extra, [true])
})

test('autoOpenSound: only the first game of an empty grid keeps the panel sound', () => {
  const panels = [{ id: 'a', url: '', muted: false }, { id: 'b', url: '', muted: false }]
  const sound = autoOpenSound(panels, { fill: [{ panelId: 'a', url: 'u1' }, { panelId: 'b', url: 'u2' }], extra: ['u3'], replace: [], skipped: 0 }, false)
  assert.equal(sound.panels.get('a'), false)
  assert.equal(sound.panels.get('b'), true)
  assert.deepEqual(sound.extra, [true])
  // From the start screen (no panels): the first new panel follows "Mutar todos", the others are muted.
  assert.deepEqual(autoOpenSound([], { fill: [], extra: ['u1', 'u2'], replace: [], skipped: 0 }, false).extra, [false, true])
  assert.deepEqual(autoOpenSound([], { fill: [], extra: ['u1', 'u2'], replace: [], skipped: 0 }, true).extra, [true, true])
})

test('autoOpenSound: muted panels stay muted and a replaced panel keeps its own sound', () => {
  const panels = [{ id: 'a', url: 'u1', muted: false }, { id: 'b', url: 'u2', muted: true }, { id: 'c', url: '', muted: true }]
  const sound = autoOpenSound(panels, { fill: [{ panelId: 'c', url: 'u4' }], extra: [], replace: [{ panelId: 'a', url: 'm1' }, { panelId: 'b', url: 'm2' }], skipped: 0 }, false)
  assert.equal(sound.panels.get('a'), false)
  assert.equal(sound.panels.get('b'), true)
  assert.equal(sound.panels.get('c'), true)
})

test('sources: BLL on and YouTube off by default, kept by the stored settings', () => {
  assert.deepEqual(defaultAutoOpenSettings().sources, { bll: true, youtube: false })
  assert.deepEqual(parseAutoOpenSettings(JSON.stringify({ sources: { bll: false, youtube: true } })).sources, { bll: false, youtube: true })
  // Settings saved before the sources existed, or a broken value, keep the defaults.
  assert.deepEqual(parseAutoOpenSettings(JSON.stringify({ teams: ['Flamengo'] })).sources, { bll: true, youtube: false })
  assert.deepEqual(parseAutoOpenSettings(JSON.stringify({ sources: { bll: 'yes', youtube: 1 } })).sources, { bll: true, youtube: false })
})

test('youtubeAutoOpenDecision maps the competition of the title to the listed ones', () => {
  const yt = (name: string, competition: string, custom = settings) => youtubeAutoOpenDecision({ name, competition }, custom)
  assert.equal(yt('AO VIVO: Flamengo x Palmeiras | Brasileirão 2026', 'Brasileirão').open, true)
  assert.equal(yt('Arsenal x Chelsea - Premier League AO VIVO', 'Premier League').mainTeam, 'Arsenal')
  assert.equal(yt('Porto x Benfica | Champions League', 'Champions League').open, true)
  // Domestic cups only open main-team games; a game outside the lists doesn't open.
  assert.equal(yt('Flamengo x Racing | Libertadores', 'Libertadores').open, false)
  assert.equal(yt('Time A x Time B', 'CazéTV').open, false)
  // Not football, or not the men's first team.
  assert.equal(yt('Chiefs x Eagles | NFL', 'NFL').open, false)
  assert.equal(yt('Corinthians x Palmeiras | Brasileirão Feminino', 'Brasileirão Feminino').open, false)
  // Main team anywhere, and an added competition found in the title or as the channel name.
  assert.equal(yt('Real Madrid x Flamengo | Amistoso', 'CazéTV', { ...settings, teamsAnywhere: true }).mainTeam, 'Real Madrid')
  assert.equal(yt('Real Madrid x Flamengo | Amistoso', 'CazéTV', { ...settings, teamsAnywhere: true }).open, true)
  const custom = { ...settings, custom: [{ name: 'Libertadores', mode: 'all' as const }, { name: 'ge tv', mode: 'all' as const }] }
  assert.equal(yt('Flamengo x Racing | Libertadores 2026', 'Libertadores', custom).open, true)
  assert.equal(yt('Flamengo x Racing | CONMEBOL Libertadores', 'CONMEBOL', custom).open, true)
  assert.equal(yt('Fortaleza x Ceará', 'ge tv', custom).open, true)
  assert.equal(yt('Flamengo x Racing | Libertadores Feminina', 'Libertadores Feminina', custom).open, false)
})

test('gameKey: the same two teams in any order and title format', () => {
  assert.equal(gameKey('Flamengo x Palmeiras'), gameKey('AO VIVO: Palmeiras x Flamengo | Brasileirão'))
  assert.notEqual(gameKey('Flamengo x Palmeiras'), gameKey('Flamengo x Santos'))
  assert.equal(gameKey('Melhores momentos'), null)
})

test('mergeAutoOpenCandidates opens each game once, BLL first', () => {
  const bll = { url: 'bll/1', name: 'Flamengo x Palmeiras', mainTeam: false }
  const ytSame = { url: 'yt/1', name: 'AO VIVO: Flamengo x Palmeiras | Brasileirão', mainTeam: false }
  const ytOther = { url: 'yt/2', name: 'Santos x São Paulo | Paulistão', mainTeam: false }
  const ytOtherAgain = { url: 'yt/3', name: 'SANTOS X SÃO PAULO AO VIVO', mainTeam: false }
  assert.deepEqual(mergeAutoOpenCandidates([bll, ytSame, ytOther, ytOtherAgain], []).map((item) => item.url), ['bll/1', 'yt/2'])
  // A game open in another panel is left out; the candidate of that same panel stays (the plan skips it as open).
  assert.deepEqual(mergeAutoOpenCandidates([bll, ytOther], [{ url: 'yt/9', name: 'Palmeiras x Flamengo' }]).map((item) => item.url), ['yt/2'])
  assert.deepEqual(mergeAutoOpenCandidates([bll], [{ url: 'bll/1', name: 'Flamengo x Palmeiras' }]).map((item) => item.url), ['bll/1'])
  // Without teams in the name there is nothing to compare: kept.
  assert.equal(mergeAutoOpenCandidates([{ url: 'yt/4', name: 'Live', mainTeam: false }, { url: 'yt/5', name: 'Live', mainTeam: false }], []).length, 2)
})

test('autoSearchPlaceholders: 4 temporary screens from the start screen', () => {
  assert.deepEqual(autoSearchPlaceholders({ emptyPanelIds: ['a', 'b'], panelCount: 6, maxPanels: 18, fromChooser: true }), { mark: [], addTemporary: 4 })
})

test('autoSearchPlaceholders: a grid with empty panels marks them', () => {
  assert.deepEqual(autoSearchPlaceholders({ emptyPanelIds: ['panel-2', 'panel-4'], panelCount: 4, maxPanels: 18, fromChooser: false }), { mark: ['panel-2', 'panel-4'], addTemporary: 0 })
})

test('autoSearchPlaceholders: a full grid gets one temporary screen, none at the maximum', () => {
  assert.deepEqual(autoSearchPlaceholders({ emptyPanelIds: [], panelCount: 6, maxPanels: 18, fromChooser: false }), { mark: [], addTemporary: 1 })
  assert.deepEqual(autoSearchPlaceholders({ emptyPanelIds: [], panelCount: 18, maxPanels: 18, fromChooser: false }), { mark: [], addTemporary: 0 })
})
