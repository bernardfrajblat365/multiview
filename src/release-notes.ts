export type ReleaseNote = { title: string; body: string }
export type Release = { version: string; label: string; notes: ReleaseNote[] }

const STORAGE_KEY = 'quadra:last-seen-version'

/** Newest first. The popup shows the entry whose `version` matches the installed app. */
export const RELEASES: readonly Release[] = [
  {
    version: '1.1.3',
    label: '1.1.3',
    notes: [
      {
        title: 'Jogos do YouTube sem configurar nada',
        body: 'O botão "Abrir jogos ao vivo do YouTube" agora funciona logo depois de instalar: o Quadra já vem com a chave da API do YouTube, então não precisa mais criar uma chave nem mexer no arquivo .env.',
      },
    ],
  },
  {
    version: '1.1.2',
    label: '1.1.2',
    notes: [
      {
        title: 'Escolha quanto tempo o gol fica em destaque',
        body: 'Ao lado de "Destacar o jogo do gol", na tela inicial ou no menu ⋯, dá para escolher por quanto tempo o painel do gol fica grande: de 15 segundos a 3 minutos (o padrão continua 45 segundos). A escolha fica salva para as próximas vezes.',
      },
    ],
  },
  {
    version: '1.1.1',
    label: '1.1.1',
    notes: [
      {
        title: 'Jogos do YouTube pelos canais oficiais',
        body: 'A lista de jogos ao vivo do YouTube agora procura só nos canais que transmitem os jogos com imagens (CazéTV, ge tv, ESPN Brasil, Canal GOAT e outros), então param de aparecer canais não oficiais e entram as lives grandes que antes ficavam de fora. No botão Canais… você adiciona um canal pelo @ ou pelo link, ou remove os que não quer.',
      },
      {
        title: 'Recarregar um painel',
        body: 'O botão de recarregar (seta verde), entre o lápis de editar o link e a lixeira, recarrega só a página daquele painel, sem mexer nos outros.',
      },
      {
        title: 'Desligar os alertas de um painel',
        body: 'O botão do sino, logo à esquerda da lixeira, desliga todos os alertas daquele painel (som, aviso na tela e destaque do gol) sem mexer nos outros. Clique de novo para religar.',
      },
      {
        title: 'Nome do jogo na base do vídeo',
        body: 'Quando o vídeo tem faixas pretas só dos lados (por exemplo, um jogo em destaque), o nome dos times aparece numa legenda na parte de baixo do vídeo, e não mais empilhado numa das faixas. A legenda cresce junto com o painel, então o jogo em destaque fica com o nome maior e dá para ler de longe.',
      },
      {
        title: 'Alertas também nos jogos da BLL sem lances',
        body: 'Quando um jogo da BLL não tem o placar ao vivo da William Hill, o Quadra procura o mesmo jogo no 365Scores, como já faz nas lives do YouTube. Os alertas de gol, pênalti, cartão e VAR voltam a funcionar nesses jogos, e o botão ⏱ do painel ajusta o atraso. Se o Quadra não tiver certeza do jogo, o painel pergunta qual é.',
      },
      {
        title: 'Jogos encontrados no 365Scores com mais precisão',
        body: 'Em dias cheios o Quadra deixava de encontrar parte dos jogos no 365Scores, inclusive do Brasileirão. Agora ele procura em todos os jogos do dia. Gols que o 365Scores mostra no placar antes de registrar o lance também alertam, e um mesmo gol ou cartão vermelho não alerta duas vezes.',
      },
      {
        title: 'Histórico de novidades',
        body: 'Esta janela agora mostra também o que mudou nas versões anteriores. Role para baixo para ver as novidades de cada versão.',
      },
    ],
  },
  {
    version: '1.1.0',
    label: '1.1',
    notes: [
      {
        title: 'Alertas de lances',
        body: 'Nos jogos da BLL e nas lives do YouTube ligadas a um jogo, o Quadra toca um som e destaca o painel quando sai gol, pênalti, cartão vermelho, cartão amarelo ou decisão do VAR. Em "Alertar em" você escolhe quais lances avisam, e em "Som do alerta" escolhe entre 30 sons (clicar num som já toca uma amostra). As escolhas ficam salvas.',
      },
      {
        title: 'Destaque automático do gol',
        body: 'Com 3 telas ou mais, o jogo que teve gol cresce sozinho por 45 segundos e depois volta ao layout de antes. No painel destacado, "📌 Fixar" mantém o destaque e "↩ Voltar" desfaz na hora. Com muitas telas, um segundo painel cresce junto para o gol ficar bem visível. Dá para desligar em "Destacar o jogo do gol por 45 s".',
      },
      {
        title: 'Nome do jogo e placar no painel',
        body: 'Cada painel mostra o nome inteiro dos times e o placar: nas faixas pretas do vídeo quando existem, ou numa legenda na parte de baixo. Em "Placar no painel" você atrasa o placar (10 a 60 s) para não ver o gol antes de ele aparecer no vídeo, ou esconde o placar. O × no rótulo esconde só aquele painel.',
      },
      {
        title: 'Abrir vários jogos da BLL de uma vez',
        body: 'O botão "Abrir vários jogos da BLL", na tela inicial e no menu ⋯, lista os jogos ao vivo agrupados por campeonato, sem abrir o site. Marque os jogos e o Quadra cria uma tela para cada um (até 18). Os players agora abrem um de cada vez e são recarregados sozinhos se ficarem pretos.',
      },
      {
        title: 'Lives de futebol do YouTube',
        body: 'O botão "Abrir jogos ao vivo do YouTube" busca as transmissões de jogos que estão ao vivo agora e abre as que você marcar. Precisa de uma chave da YouTube Data API no arquivo .env do Quadra.',
      },
      {
        title: 'YouTube só com o vídeo',
        body: 'Nas lives e vídeos do YouTube, o painel mostra só o player, ocupando o espaço todo, sem chat nem a página em volta. Anúncios são pulados ou bloqueados quando possível.',
      },
      {
        title: 'Placar e lances do 365Scores nas lives do YouTube',
        body: 'Quando o título da live tem "Time A x Time B", o Quadra encontra o jogo no 365Scores e passa a mostrar placar e alertas desse painel. Se houver dúvida, o painel pergunta "Qual jogo é este?". Como a live costuma vir atrasada, o botão "⏱" no canto superior esquerdo do painel ajusta o atraso dos alertas (até 2 minutos) para não estragar a surpresa.',
      },
      {
        title: 'Botão Voltar no canto',
        body: 'O "← Voltar" saiu da barra de ferramentas e fica no canto superior esquerdo. Ele aparece quando você mexe o mouse ali e some sozinho depois de 2 segundos.',
      },
      {
        title: 'Monitor de lances',
        body: 'O botão "Monitor de lances" abre uma janela com o registro do que o Quadra está lendo de cada jogo. Ajuda a entender por que um alerta tocou ou não.',
      },
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
