# Quadra — Multi-view

App desktop (Electron) para assistir de 1 a 18 páginas ao mesmo tempo em uma única janela. Cada painel é uma `WebContentsView` completa do Chromium, então até sites que bloqueiam incorporação (`X-Frame-Options`) abrem normalmente.

![Tela inicial do Quadra](docs/images/tela-inicial.png)

## Como rodar

```bash
npm ci          # instala dependências e baixa o runtime ECS da Castlabs
npm run dev     # modo desenvolvimento
```

Build e instalador Windows (gerado em `release/`, roda sem Vite ou servidor local):

```bash
npm run build
npm run dist:release
```

## Como usar

1. Na tela inicial, escolha quantas telas quer (1 a 18) ou clique em **Começar com uma tela**.
2. Cole uma URL em cada painel e clique em **Abrir** (ou **Abrir todos**).
   - **BLL:** clique no botão **BLL** do painel, faça login uma vez e escolha o jogo. Os próximos jogos vão para a próxima tela vazia.
   - **Vários jogos da BLL de uma vez:** na tela inicial, **Abrir vários jogos da BLL** — escolha os jogos e o Quadra abre direto com uma tela para cada jogo (2 jogos → 2 telas, 12 jogos → 12 telas). Com a grade já aberta, use o menu **⋯** → **Abrir vários jogos da BLL…**. O Quadra lê a lista da página inicial da BLL (só leitura) e mostra os jogos ao vivo agrupados por competição. Marque a competição inteira ou só alguns jogos e clique em **Abrir N jogos**: as telas vazias são preenchidas primeiro e o Quadra cria as que faltarem (até 18). Jogos já abertos aparecem como "já aberto"; jogos previstos só aparecem quando começam (a BLL não deixa abri-los antes). O site da BLL não aparece: a lista é lida numa página oculta com o mesmo login salvo, e é atualizada sozinha toda vez que o menu abre (o botão **Atualizar lista** recarrega quando quiser). Se a lista não vier, confira o login abrindo a BLL em um painel. **Desfazer** volta ao estado anterior.
   - **Jogos ao vivo do YouTube:** na tela inicial, **Abrir jogos ao vivo do YouTube** (ou menu **⋯** → **Abrir jogos ao vivo do YouTube…** com a grade aberta). Funciona igual ao lote da BLL, mas a lista vem da YouTube Data API v3 e só dos canais de uma lista: para cada canal o Quadra lê os últimos 50 vídeos enviados e pergunta quais estão ao vivo agora (não usa a busca aberta do YouTube, que trazia canais não oficiais e deixava de fora lives grandes). A lista padrão tem CazéTV, CazéTV 2, ge tv, ESPN Brasil, Canal GOAT, TNT Sports Brasil, SBT Sports, Paulistão, CONMEBOL e N Sports; o botão **Canais…** do diálogo adiciona um canal pelo @ ou pelo link (`youtube.com/@canal`, `youtube.com/channel/UC…`), remove canais ou restaura a lista padrão (até 50 canais, salvos no app). Dentro desses canais continuam de fora lives sem confronto no título (`Time A x Time B`), reacts, pré/pós-jogo, resenhas, melhores momentos, reprises de temporadas antigas, videogame e outros esportes (exceto NFL e NBA). Os grupos são o campeonato citado no título (Brasileirão, Libertadores, La Liga, Ligue 1…) ou o canal; os jogos com mais gente assistindo vêm primeiro. Precisa de uma chave própria da API: copie `.env.example` para `.env` e preencha `QUADRA_YOUTUBE_API_KEY=` (no app instalado, o `.env` fica ao lado do `Quadra.exe` ou na pasta de dados do app). O `.env` não vai para o git nem para o instalador. Cada busca gasta cerca de 2 das 10.000 unidades diárias gratuitas por canal (20 com a lista padrão); o Quadra reaproveita o resultado por 1 minuto.
- **YouTube só com o vídeo:** painéis com links `watch`/`live` do YouTube (colados ou vindos do lote) mostram só o player, ocupando todo o painel (pseudo-tela cheia por CSS, sem cabeçalho, chat ao vivo, sugestões), mantendo os controles do YouTube. O Quadra também pula/acelera anúncios (clica em "Pular"; senão silencia e avança o anúncio) e bloqueia domínios de anúncio (doubleclick, googlesyndication, `/pagead/`…) na sessão do app. É melhor esforço: anúncios inseridos no próprio stream de lives não dá para separar, o YouTube pode exibir aviso anti-bloqueador e mudanças nas classes da página exigem ajuste dos seletores.
3. **+ Adicionar tela** cria um painel novo; a lixeira remove um painel. O layout se reorganiza sozinho.
4. **Organizar** permite escolher a composição, marcar telas principais (destaques) e a posição delas. **Aplicar** confirma; **Cancelar** ou Esc descarta.
5. Outros controles: **Sem destaques**, **Organizar automaticamente**, **Mostrar/Ocultar nomes dos jogos**, **Desfazer**, seletor **Telas**, **Voltar**, **Tela Cheia** e editar URL do painel.

### Como o layout funciona

- O tamanho dos painéis é calculado automaticamente para maximizar a área visível de vídeo (referência 16:9), sem cortar a imagem — por isso painéis da mesma composição podem ter tamanhos diferentes.
- Players esportivos são ajustados ao painel mantendo a proporção, com barras pretas quando necessário.
- Quando o título da página traz um confronto (`Time A x Time B` — típico do BLL e de muitos links YouTube), o Quadra mostra esse nome no painel, sempre com o **nome inteiro** dos times: na faixa preta de baixo ou de cima (a fonte encolhe para caber em faixas finas e, se precisar, quebra em duas linhas, uma por time), ou, se não houver faixa em cima nem embaixo (vídeo ocupando tudo ou só com faixas laterais, como um jogo em destaque), numa legenda ao longo da base do vídeo, com fundo em degradê (mais escuro embaixo, transparente em cima) e fonte proporcional à altura do painel (até 36 px), para ler de longe quando o painel cresce. Marcadores de áudio no título (ex.: 🔊) são removidos. O **×** no rótulo oculta só aquele painel; **Abrir** de novo restaura. O menu **⋯** oculta/mostra todos. Zapping e páginas sem confronto no título ficam sem rótulo (exceto jogos BLL com feed, que usam os nomes do feed).
- Destacar um jogo (estrela) coloca ele no espaço grande; um segundo destaque troca para uma composição que comporte dois.
- Não há divisórias manuais. Ao redimensionar a janela, tudo é recalculado preservando destaques e posições.
- A barra de controles fica sempre visível, inclusive em tela cheia.

### Alertas de lances

- Para jogos do BLL, o Quadra lê o feed de lances do William Hill (o mesmo do card de estatísticas) em uma janela oculta, sem mexer no vídeo nem usar sua sessão BLL. O painel continua só com a imagem.
- **Gol**, **Pênalti**, **Cartão vermelho** e **Cartão amarelo** disparam som e uma borda pulsante com selo no painel do jogo (gol fica 45 s, os demais 12 s). Cada tipo liga/desliga na tela inicial ou no menu **⋯**; o amarelo vem desligado.
- O **Som do alerta** tem 30 opções: clicar em uma já seleciona e toca.
- Com **3 ou mais telas**, o jogo do gol vira destaque por **45 s** (opção "Destacar o jogo do gol"). Vários gols acumulam destaques até o limite da composição; quando passa o limite, o mais antigo sai. Quando um destaque só fica pequeno e dois ficam bem maiores (ex.: 12 telas: 8% da tela contra 28%), o primeiro outro painel da grade entra junto como companheiro, só enquanto o gol estiver em destaque. Cada painel mostra a contagem e os botões **Fixar** (mantém em destaque) e **Voltar** (volta agora). Qualquer mudança manual de layout cancela o modo automático.
- **Placar no painel**: o rótulo do jogo mostra o placar lido do mesmo feed, e os números piscam quando ele muda. Como o feed costuma chegar antes do vídeo, a opção **Placar no painel** (tela inicial ou menu **⋯**) segura cada mudança por 10–60 s, ou **Não mostrar**; o padrão é **Na hora**. O placar existente quando o jogo é aberto aparece sem atraso. Os alertas de lance não são atrasados.
- O feed William Hill não informa VAR (a fonte 365Scores abaixo informa, para lives do YouTube). **Monitor de lances** (tela inicial ou menu **⋯**) mostra os logs da engine, com um selo em cada linha dizendo a fonte (**William Hill** ou **365Scores API**; lances da narração do 365Scores terminam com "· narração"); eles também ficam em `logs/` no perfil do app, com o prefixo `[William Hill]` ou `[365Scores API]`.
- Preferências de som e alertas ficam salvas no `localStorage`; URLs e layout continuam só em memória.

#### Lives do YouTube (fonte 365Scores)

- Painéis do YouTube (`watch`/`live`) cujo título tem `Time A x Time B` são ligados a um jogo do **365Scores**, pela API web não documentada (`webws.365scores.com`): sem login nem cookies, consultada só pelo processo principal. O Quadra compara os nomes (ignora acentos e FC/EC, entende apelidos como Galo/Verdão, sufixos MG/PR e marcadores de sub-XX, feminino e reservas) com os jogos ao vivo e a agenda inteira do dia (num sábado passa de 800 jogos; até 4 h da manhã entra também a agenda de ontem), com a lista guardada por 30 s.
- Jogo claro: o painel fica vinculado. Mais de um possível: o painel pergunta **Qual jogo é este?** com até 3 opções e **Nenhum**. Nenhum encontrado: tenta de novo a cada 2 min, até 5 vezes.
- Jogo vinculado: o detalhe é consultado a cada 3 s (o cache da API também é de 3 s), e para quando o jogo termina. Se uma consulta trava (normalmente a resposta vem em ~0,1 s), o Quadra desiste em 4 s e tenta de novo na hora, até 3 vezes; depois espera 3, 6, 12 e no máximo 15 s entre tentativas, e a partir da 2ª falha seguida dá 10 s para cada resposta, caso a API esteja só lenta. Erro HTTP (bloqueio, fora do ar) espera mais, até 60 s. Quando volta, o Monitor mostra "365Scores voltou a responder após N falha(s) (X s sem dados)". A narração e a contagem de vermelhos também desistem em 4 s, para não segurar o próximo placar. Ligas com lances: gols (inclusive pênalti e contra), cartões (inclusive 2º amarelo), pênalti perdido e VAR de **gol anulado**. Como o detalhe não traz o **pênalti marcado** nem as revisões do VAR (só os resultados), o Quadra lê também a **narração ao vivo** do jogo (`game.playByPlay.feedURL`, host `pbpgenerator.365scores.com`, sempre por https), a cada 5 s (o cache da fonte é de 15 s), só nos jogos que a têm: "pênalti marcado" vira alerta de **Pênalti**, e "Decisão do VAR: …" vira **VAR** com a decisão (gol anulado, gol confirmado, pênalti, pênalti cancelado, cartão vermelho ou revisão). Gols e cartões continuam vindo dos eventos, que são mais rápidos. Uma mesma revisão do VAR pode aparecer em até 3 relatos; só o primeiro para o mesmo time em 3 minutos alerta. A chave do evento não inclui o subtipo, então o gol que o 365Scores reclassifica depois (de pênalti para gol normal) não alerta duas vezes. O placar é a referência dos gols: os eventos trazem os detalhes (pênalti, contra), mas às vezes chegam atrasados ou faltam (placar 1 x 2 com só 1 x 1 nos eventos). Um gol que os eventos não mostram em 9 s alerta pelo placar, e o evento que chega depois não alerta de novo. Jogo ainda sem nenhum lance não tem lista de eventos (um 0 x 0 de liga grande parece "só placar"): ali o gol alerta na hora pelo placar e o evento posterior não repete. Ligas sem cobertura ("só placar"): gols pela mudança do placar, vermelhos pela contagem (lida em `/web/games/?games=<id>`, porque o detalhe do jogo não traz cartões) e placar que diminui vira alerta de VAR.
- O alerta **VAR** (ligado por padrão) fica em **Alertar em**; só o VAR de **gol anulado** solta o destaque automático de gol daquele painel (um VAR que confirma o gol não solta).
- **Jogos da BLL sem feed William Hill:** se o player da BLL carrega o jogo sem `williamHillId`, o Quadra busca o jogo no 365Scores pelo nome do evento (`evento.nome`), do mesmo jeito que nas lives do YouTube (mesmo matching, pergunta "Qual jogo é este?", lances, botão **⏱ N s**). Se o player nem chega a informar o jogo em 60 s, a busca usa o título da página. A detecção continua por 60 s: se o `williamHillId` aparecer depois, o feed William Hill assume e o vínculo 365Scores é desfeito.
- **Proteção contra spoiler:** nos painéis do YouTube vinculados, o atraso do placar vale também para os alertas e para o destaque automático. Cada painel tem seu botão **⏱ N s** entre os botões do canto superior esquerdo (Mutar, ★, ✎, antes da lixeira), visível ao passar o mouse; ao clicar abre a lista **Atraso** (padrão / na hora / 10 a 120 s), só em memória. A dica do botão mostra o jogo do 365Scores vinculado e "só placar" quando a liga não tem lances. Os alertas de BLL/William Hill continuam na hora (jogos da BLL que caíram no 365Scores seguem as regras do 365Scores).
- Limites: a API não é oficial e pode mudar ou bloquear sem aviso; pênalti marcado e decisões do VAR dependem da narração do jogo, e nem todo jogo ou liga a tem (sem ela só chegam os resultados, como gol anulado); a 365Scores nem sempre registra a checagem do VAR; a tabela de tipos de lance veio de 40 jogos encerrados em 22/10/2026; ainda não foi validado ao vivo no app.

### Sessão e dados

- URLs ficam só em memória durante a execução.
- O BLL usa a sessão persistente `quadra` (login uma única vez). Outros serviços não têm integração específica.
- Credenciais, cookies, tokens e licenças não são coletados.

## Especificações técnicas

### DRM (Widevine / Disney+)

- Runtime: **Castlabs ECS `v44.1.0+wvcus`** (Electron com Widevine). O app aguarda `components.whenReady()` antes de criar os painéis e usa o user-agent real do Chromium.
- Se o Widevine falhar, o app mostra um aviso e continua funcionando; só o conteúdo protegido fica indisponível.
- Assinatura VMP de produção exige `castlabs-evs==1.3.2` com autenticação EVS. O hook `electron/after-sign.cjs` assina e verifica; falhas ou assinatura de desenvolvimento interrompem o build.
- `npm run dist:drm-poc` gera um build de teste com assinatura de desenvolvimento (não serve para release).
- EVS/VMP **não** substitui Authenticode: sem certificado, o instalador não é assinado pelo Windows.
- Detalhes da investigação: [docs/disney-plus-drm.md](docs/disney-plus-drm.md).

| Comando | Verifica |
| --- | --- |
| `npm run test:ecs` | Versão, origem e binário do ECS + arquivo `.sig` |
| `npm run test:drm-diagnostic` | EME/Widevine local (não garante reprodução em um serviço) |

### Atualizações automáticas

- Só o app empacotado para Windows verifica o release estável do GitHub (via `electron-updater`) ao abrir.
- Sempre pergunta antes de baixar e antes de reiniciar. Nada é instalado em segundo plano.
- O botão **Verificar atualizações** na tela inicial força a verificação.
- O updater valida HTTPS e o SHA-512 do `latest.yml`.
- **Novidades:** na primeira abertura de uma versão nova, o Quadra mostra uma janela com a lista do que mudou (uma vez por versão; a última versão vista fica no `localStorage` do app). O botão **Novidades** na tela inicial reabre a lista. As notas ficam em `src/release-notes.ts`: a cada release, acrescente a entrada da nova versão no topo de `RELEASES` (o teste `tests/release-notes.test.ts` falha se a versão do `package.json` não tiver notas).

### CI e release

- **`windows-pr-checks.yml`** — em cada PR: instalação limpa, checagem do ECS, testes e smokes.
- **`windows-release.yml`** — ao enviar uma tag `v*`: confere tag × `package.json`, assina com EVS, valida metadata, blockmap e payload do NSIS, e cria um release **draft**.

Para publicar:

1. Faça merge e crie uma tag nova apontando para o commit integrado (nunca reutilize nem mova tags públicas).
2. Baixe o instalador do draft, confira `release-verification.json` e os hashes.
3. Teste Disney+ no instalador (incluindo recarga e tela cheia).
4. Publique o draft como `latest`.

### Testes

```bash
npm test               # layout, roteamento, updater e inicialização
npm run typecheck
npm run test:renderer  # interface
npm run test:toolbar   # app real com vídeos em reprodução
npm run test:app       # integração
npm run test:close     # fechamento
npm run test:packaged  # app empacotado
```

Cobrem todas as quantidades de 1 a 18, composições e destaques, adição/remoção de telas, edição, abertura de várias páginas e páginas com `X-Frame-Options`. O `test:toolbar` valida o encaixe dos players esportivos (16:9, 4:3, 3:4, 16:4) em vários tipos de player, além de tela cheia, redimensionamento, barra de controles e as 142 combinações de composição/posição. As capturas ficam em `artifacts/toolbar-checks/`.

### Limitações conhecidas

Validação de URL, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em alguns links do YouTube ainda não foram tratados.
