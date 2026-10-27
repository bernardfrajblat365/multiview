export type ReleaseNote = { title: string; body: string }
export type Release = { version: string; label: string; notes: ReleaseNote[] }

const STORAGE_KEY = 'quadra:last-seen-version'

/** Newest first. The popup shows the entry whose `version` matches the installed app. */
export const RELEASES: readonly Release[] = [
  {
    version: '1.1.6',
    label: '1.1.6',
    notes: [
      { title: 'Fecha qualquer jogo da BLL', body: 'Quando a BLL marca o jogo como encerrado, o painel fecha sozinho: basquete, tênis e futebol sem radar.' },
      { title: 'Placar do basquete', body: 'Jogos 🏀 da BLL (NBA, Euroliga) mostram times, escudos e placar ao vivo. Ainda sem alertas.' },
      { title: '🏀 na lista da BLL', body: 'Em "Abrir vários jogos da BLL", os jogos de basquete aparecem com 🏀.' },
      { title: 'Placar do basquete discreto', body: 'O placar não acende a cada cesta: só os números rolam.' },
      { title: 'Som próprio para o gol', body: 'Escolha um "Som do gol" e um "Som dos outros alertas".' },
      { title: '× só com o mouse em cima', body: 'O × que esconde o nome dos times só aparece com o mouse sobre os nomes.' },
    ],
  },
  {
    version: '1.1.5',
    label: '1.1.5',
    notes: [
      { title: 'Escudos dos times', body: 'O nome do jogo no painel mostra o escudo de cada time.' },
      { title: 'BLL separada por liga', body: 'Em "Abrir vários jogos da BLL", os jogos ficam juntos por liga, em ordem alfabética.' },
      { title: 'Novos sons de gol', body: 'Galvão Bueno, Gol torcida e Fox Sports.' },
      { title: 'Painel fecha no fim do jogo', body: 'Quando o jogo acaba, o painel fecha sozinho (padrão 1 min). "Manter aberto" cancela; o tempo é ajustável.' },
      { title: 'Alerta com tudo mudo', body: 'O som do alerta toca mesmo com todas as telas sem som.' },
    ],
  },
  {
    version: '1.1.3',
    label: '1.1.3',
    notes: [
      { title: 'YouTube sem configurar nada', body: 'O botão de jogos ao vivo do YouTube funciona logo após instalar, sem chave própria.' },
    ],
  },
  {
    version: '1.1.2',
    label: '1.1.2',
    notes: [
      { title: 'Tempo do destaque do gol', body: 'Escolha por quanto tempo o gol fica em destaque: de 15 s a 3 min (padrão 45 s).' },
    ],
  },
  {
    version: '1.1.1',
    label: '1.1.1',
    notes: [
      { title: 'YouTube pelos canais oficiais', body: 'A lista de lives vem só dos canais oficiais. "Canais…" adiciona ou remove canais.' },
      { title: 'Recarregar um painel', body: 'A seta verde recarrega só aquele painel.' },
      { title: 'Desligar alertas de um painel', body: 'O sino desliga os alertas daquele painel.' },
      { title: 'Nome do jogo na base do vídeo', body: 'Com faixas pretas só dos lados, o nome vira legenda embaixo, maior no destaque.' },
      { title: 'Alertas na BLL sem lances', body: 'Jogos da BLL sem William Hill usam o 365Scores para placar e alertas.' },
      { title: '365Scores mais preciso', body: 'Encontra mais jogos e não repete o mesmo gol ou cartão.' },
      { title: 'Histórico de novidades', body: 'Role para baixo para ver as versões anteriores.' },
    ],
  },
  {
    version: '1.1.0',
    label: '1.1',
    notes: [
      { title: 'Alertas de lances', body: 'Som e destaque no painel em gol, pênalti, cartões e VAR. Escolha os lances e o som.' },
      { title: 'Destaque automático do gol', body: 'Com 3+ telas, o jogo do gol cresce por 45 s. "Fixar" mantém, "Voltar" desfaz.' },
      { title: 'Nome do jogo e placar', body: 'Cada painel mostra os times e o placar, com atraso opcional contra spoiler.' },
      { title: 'Vários jogos da BLL de uma vez', body: 'Marque os jogos ao vivo e o Quadra abre uma tela para cada (até 18).' },
      { title: 'Lives do YouTube', body: 'Busca os jogos ao vivo no YouTube e abre os que você marcar.' },
      { title: 'YouTube só com o vídeo', body: 'Só o player, sem chat; anúncios pulados quando possível.' },
      { title: '365Scores nas lives do YouTube', body: 'Placar e alertas pelo 365Scores; o botão ⏱ ajusta o atraso.' },
      { title: 'Voltar no canto', body: 'O "← Voltar" fica no canto superior esquerdo e some sozinho.' },
      { title: 'Monitor de lances', body: 'Mostra o que o Quadra está lendo de cada jogo.' },
    ],
  },
]

/** Notes to show on this launch: only when the installed version has notes and they were not seen yet. */
export function releaseToShow(currentVersion: string, lastSeen: string | null, releases: readonly Release[] = RELEASES): Release | null {
  if (lastSeen === currentVersion) return null
  return releases.find((release) => release.version === currentVersion) ?? null
}

/** The given release, then every older one: the popup lists them all so earlier changes stay a scroll away. */
export function releaseHistory(release: Release, releases: readonly Release[] = RELEASES): Release[] {
  const index = releases.findIndex((entry) => entry.version === release.version)
  return index < 0 ? [release] : releases.slice(index)
}

export function readLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function markVersionSeen(version: string) {
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {
    /* storage unavailable: the notes show again next launch */
  }
}
