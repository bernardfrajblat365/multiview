import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoOpenDecision,
  competitionRuleOf,
  defaultAutoOpenSettings,
  mainTeamOf,
  matchesCustomCompetition,
  parseAutoOpenSettings,
  planAutoOpen,
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
