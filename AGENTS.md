# AGENTS.md — Quadra Multi-view (Single Source of Truth)

Este arquivo é a **fonte única de verdade** para qualquer agente de IA que operar neste repositório. Antes de alterar código, leia este documento por completo e consulte a seção [6. Histórico de Tarefas, Decisões e Estado Atual](#6-histórico-de-tarefas-decisões-e-estado-atual).

Documentação humana complementar (não substitui este arquivo):

| Documento | Uso |
| --- | --- |
| `README.md` | Uso do produto, DRM, atualizações, CI/release e limitações conhecidas |
| `ONBOARDING.md` | Arquitetura, IPC, fluxo de dados e mapa de arquivos de entrada |
| `DIAGNOSTICO.md` | Registro da remoção de integração com navegador externo |
| `PLANO-FULLSCREEN.md` | Diagnóstico de barra de tarefas sobre controles em tela cheia |
| `docs/disney-plus-drm.md` | Investigação Widevine/ECS/EVS e limites de evidência Disney+ |
| `docs/historico-tarefas.md` | Entradas antigas da tabela da seção 6 (consultar só por área/arquivo, não ler tudo) |

---

## 1. Visão Geral e Escopo do Projeto

### Objetivo

**Quadra** (`quadra-multiview`, produto `Quadra`, appId `com.quadra.multiview`) é um aplicativo **desktop Windows** que permite assistir de **1 a 18 páginas/vídeos ao mesmo tempo** em uma única janela. Cada painel é uma `WebContentsView` completa do Chromium — não um iframe — de modo que sites com `X-Frame-Options` continuam abrindo.

Público: usuários que precisam acompanhar várias transmissões (especialmente esportivas) em paralelo. Problema resolvido: multi-view nativo sem depender de embeds bloqueados, com composição automática otimizada para vídeo 16:9, destaques, catálogo BLL, fullscreen e atualizações via GitHub Releases.

### Arquitetura de Alto Nível

Padrão: **aplicação Electron de processo duplo (main + renderer)** com overlay de UI, empacotada por **electron-vite** + **electron-builder (NSIS)**. Não é monorepo, não há backend, ORM, API REST/GraphQL nem banco de dados da aplicação.

Fluxo principal de dados:

```text
Usuário (escolhe telas / URLs / organizar)
    → src/main.ts (estado DOM + painéis)
    → src/layout.ts + src/video-layout.ts (geometria / MIP com yalps)
    → window.quadra (preload IPC)
    → electron/main.ts (BaseWindow + overlay + WebContentsView por painel)
    → páginas remotas / players
```

Contrato central: o renderer envia `LayoutPayload` com bounds reais do DOM; o main valida, reutiliza views por `panelId` e **não deve recriar** a página ao reorganizar, redimensionar, mutar ou alterar a toolbar.

### Principais Módulos / Funcionalidades

| Domínio | Onde vive | Responsabilidade |
| --- | --- | --- |
| Processo principal Electron | `electron/main.ts` | Janela, views, IPC, navegação segura, BLL/WeddBets, fullscreen, ciclo de vida |
| Bridge IPC | `electron/preload.ts`, `src/electron.d.ts` | Expõe `window.quadra` com superfície mínima |
| Atualizações | `electron/update.ts` | `electron-updater` com prompts manuais (só app empacotado) |
| DRM / Widevine prep | `electron/protected-playback.ts` | Preparação de playback protegido / CDM |
| Assinatura VMP (release) | `electron/after-sign.cjs`, `after-pack.cjs`, `after-sign-poc.cjs` | EVS produção vs POC de desenvolvimento |
| UI / estado | `src/main.ts`, `src/style.css` | Seletor 1–18, URLs, mute, destaques, undo, toolbar, drag-and-drop, Zapping |
| Layout geométrico | `src/layout.ts` | Árvore binária, composições, destaques, validação de retângulos |
| Otimização de vídeo | `src/video-layout.ts` | Solver MIP (`yalps`) para maximizar área 16:9; cache RAM 256 |
| Editor de organização | `src/organizer.ts` | Rascunho, validação, miniaturas, posições equivalentes |
| Normalização de URL | `src/routing.ts` | HTTPS, iframe src, conversão YouTube → `watch` |
| Catálogo esportivo | main + UI | BLL ativo na UI; canais WeddBets mantidos no código **sem botão** |
| Testes | `tests/` | Unitários (Node test runner), smokes Electron, ECS/EVS/DRM, instalador |
| CI / release | `.github/workflows/` | PR checks Windows + draft release em tag `v*` |

Persistência: **somente memória** para painéis/URLs/layout (undo ≤ 24). Sessões Chromium: `persist:quadra` (não-BLL) e até 8 `persist:quadra-bll-<id>` (contas BLL nomeadas em `userData/bll-profiles.json`). Sem coleta de credenciais pelo app.

---

## 2. Stack Tecnológica e Comandos Críticos

### Versões esperadas

| Camada | Tecnologia | Versão / pin esperado |
| --- | --- | --- |
| Runtime alvo | Windows desktop (NSIS) | Primário; CI em `windows-latest` |
| Node.js (CI) | Node | **22** |
| Linguagem | TypeScript | `~6.0.2` (target ES2023) |
| Empacotamento dev | electron-vite | `^5.0.0` |
| Bundler | Vite | `^7.3.6` |
| Shell desktop | Electron (Castlabs ECS) | `git+…castlabs/electron-releases.git#v44.1.0+wvcus` |
| Builder | electron-builder | `^26.15.3` |
| Updater | electron-updater | `6.8.9` |
| Solver layout | yalps | `0.6.4` |
| Tipos Node | @types/node | `^24.13.5` |
| EVS (release) | castlabs-evs (Python) | `==1.3.2` + Python **3.12** no CI |
| Banco de dados | — | **Nenhum** |
| Framework UI | — | Vanilla TypeScript/DOM (sem React/Vue) |
| ESLint / Prettier | — | **Não configurados**; qualidade via `tsc` + testes |

Fonte de verdade das versões de pacote: `package.json` / `package-lock.json`. Versão do produto atual: **1.3.1**.

### Variáveis de ambiente relevantes

| Variável | Uso |
| --- | --- |
| `QUADRA_BLLSPORT_URL` | Override da home do catálogo BLL (testes/fixtures) |
| `QUADRA_WEDDBETS_URL` | Override WeddBets (legado no código) |
| `QUADRA_YOUTUBE_API_KEY` | Chave da YouTube Data API v3 do usuário (lote de lives). Lida pelo main do ambiente ou de `.env` (dev: raiz do projeto; empacotado: ao lado do exe ou em `userData`). Nunca versionar; `.env` está no `.gitignore` e fora de `build.files` |
| `QUADRA_BUILTIN_YOUTUBE_API_KEY` | Só no build: chave do projeto embutida no main via `define` (`__QUADRA_BUILTIN_YOUTUBE_API_KEY__`). No release vem do secret `QUADRA_YOUTUBE_API_KEY` do GitHub (o workflow falha sem ele). A chave do usuário (`QUADRA_YOUTUBE_API_KEY`) tem prioridade |
| `QUADRA_YOUTUBE_API_URL` | Override da base da API (`…/youtube/v3`; fixtures do `test:app`) |
| `QUADRA_365SCORES_URL` | Override da base da API web do 365Scores (testes/fixtures) |
| `QUADRA_365SCORES_MOBILE_URL` | Override da base da API mobile do 365Scores (`mobileapi.365scores.com`, game center com o VAR em andamento); sem ele, usa `QUADRA_365SCORES_URL` se definido (fixtures do `test:app`) |
| `QUADRA_365SCORES_IMAGE_URL` | Override do CDN de escudos do 365Scores (`imagecache.365scores.com`; fixtures do `test:app`) |
| `QUADRA_BLL_END_POLL_MS` | Intervalo de releitura da lista da BLL para achar jogos encerrados (padrão 60000; o `test:app` usa 1500) |
| `QUADRA_AUTO_OPEN_POLL_MS` | Intervalo de releitura da lista da BLL pelo modo Auto (padrão 25000; o `test:app` usa 1500). O main repassa ao overlay como `?auto-open-poll-ms=` |
| `QUADRA_TEST_USER_DATA` | Isola perfil Chromium nos smokes |
| `QUADRA_PACKAGED_EXE` | Caminho do `.exe` para `test:packaged` |
| `ELECTRON_RENDERER_URL` | Injetada pelo electron-vite em dev |
| `EVS_AUTH_JSON` / `EVS_CONFIG_FILE` / `EVS_PYTHON` | Autenticação EVS no release (nunca versionar) |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Desligada no release workflow (`false`) |

### Comandos exatos

**Instalação**

```bash
npm ci
```

(`postinstall` baixa o runtime Electron/ECS. Preferir `npm ci` em CI e ambientes limpos; `npm install` também funciona localmente.)

**Desenvolvimento**

```bash
npm run dev
```

Dev server do renderer: host `0.0.0.0`, porta **43123** (`strictPort`). Preview: `npm run preview`.

**Testes**

```bash
npm test                      # routing + layout + update-flow + startup-degraded
npm run test:routing          # só routing
npm run test:startup          # degradado components.whenReady
npm run typecheck             # tsc --noEmit
npm run test:renderer         # smoke UI
npm run test:toolbar          # app real + players / composições (artifacts/toolbar-checks/)
npm run test:app              # integração
npm run test:close            # fechamento
npm run test:packaged         # executável empacotado
npm run test:ecs              # versão/origem ECS + .sig
npm run test:drm-diagnostic   # EME/Widevine local
npm run test:drm-poc          # POC assinatura desenvolvimento
npm run test:evs              # hooks EVS com mocks
npm run test:installer-verifier
npm run test:release-metadata # metadata de release
```

Não há suíte e2e Playwright/Cypress; os smokes Electron em `tests/*.cjs` cobrem integração/e2e de produto.

**Linting, formatação e tipos**

```bash
npm run typecheck
```

Não existem scripts `lint` / `format`. Respeitar as flags do `tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, etc.).

**Build e deploy/bundle**

```bash
npm run build                 # electron-vite build → out/
npm run dist                  # build + electron-builder --win nsis --publish never → release/
npm run dist:release          # alias de dist (usado no CI de release)
npm run dist:drm-poc          # unpacked POC sem secrets EVS → release-drm-poc/
```

Release público: tag `v*` dispara `.github/workflows/windows-release.yml` (draft no GitHub; publicar `latest` só após validação manual, incluindo Disney+ se relevante). Helper local: `abrir-quadra-atual.cmd`.

---

## 3. Estrutura de Diretórios e Convenções de Código

### Mapa de pastas

```text
multiview-desktop/
├── electron/           # Main process, preload, updater, hooks de pack/sign, DRM prep
├── src/                # Renderer: UI, layout, organizer, routing, CSS, tipos do bridge
├── tests/              # Unitários (.ts) e smokes/diagnósticos (.cjs); fixtures/
├── public/             # Ícones (quadra.ico), favicon
├── docs/               # DRM Disney+ e imagens do README
├── .github/workflows/  # windows-pr-checks.yml, windows-release.yml
├── artifacts/          # Saídas de smoke (toolbar-checks gitignored parcial)
├── out/                # Build electron-vite (gitignored)
├── release/            # Instalador NSIS (gitignored)
├── index.html          # Entry do renderer
├── electron.vite.config.ts
├── vite.config.ts      # Config auxiliar Vite (porta 43123)
├── tsconfig.json
├── package.json
├── AGENTS.md           # Este arquivo (SSoT para agentes)
├── README.md / ONBOARDING.md / DIAGNOSTICO.md / PLANO-FULLSCREEN.md
└── abrir-quadra-atual.cmd
```

### Convenções que não devem ser quebradas

**Arquitetura**

- Manter a separação **main / preload / renderer**. Não habilitar `nodeIntegration` no renderer; manter `contextIsolation` e sandbox nos conteúdos remotos.
- IPC só via bridge `window.quadra`; canais com prefixo `quadra:`. Aceitar comandos apenas do overlay (`isUiSender`).
- URLs remotas: apenas HTTP(S), limite **4096** caracteres; bloquear navegações não HTTP(S).
- Reutilizar `WebContentsView` por `panelId`; reorganização não deve recarregar desnecessariamente.
- Overlay transparente + `setIgnoreMouseEvents` para cliques passarem ao vídeo fora dos controles.
- Runtime deve continuar sendo **Castlabs ECS** (Widevine); builds de release passam por assinatura VMP via EVS; POC usa `dist:drm-poc` sem secrets.

**Nomenclatura**

- Arquivos TypeScript em `kebab-case` ou nomes de domínio curtos já existentes (`layout.ts`, `video-layout.ts`, `protected-playback.ts`).
- Testes: `*.test.ts` (unitários Node) e `*-smoke.cjs` / `*-diagnostic.cjs` / checks de release.
- Tipos e funções exportadas em **camelCase** / **PascalCase** para types (`LayoutPayload`, `resolveComposition`).
- Canais IPC: `quadra:<ação>` em kebab-case.

**Commits**

Estilo observado no histórico: Conventional Commits em inglês — `feat:`, `fix:`, `chore:`, `docs:`. Bumps de versão: `chore: bump Quadra to x.y.z`. Tags de release: `v*` alinhadas a `package.json` `version`. Todo bump de versão inclui a entrada da nova versão no topo de `RELEASES` em `src/release-notes.ts` (pop-up "Novidades da versão"), com título e descrição de cada novidade em linguagem para o usuário final; `tests/release-notes.test.ts` falha se a versão do `package.json` não tiver notas. **PRs de feature/correção não fazem bump**: são pequenos (uma mudança explicável numa frase), mergeiam na `main` assim que o CI passa, e cada nota visível ao usuário entra na entrada da próxima versão em `RELEASES`. **O release é um PR próprio** (`release/x.y.z`), aberto quando o usuário decidir lançar: só o bump (`package.json`, `package-lock.json`, versão atual neste arquivo) como commit `chore: bump Quadra to x.y.z`, com a entrada `x.y.z` de `RELEASES` já existente. Depois do merge e do CI verde, a tag `vx.y.z` no commit do merge dispara o draft.

**CI** (`.github/workflows/windows-pr-checks.yml`): o job `changes` classifica os arquivos do PR; os jobs `fast` (typecheck, unitários, DRM/EVS, POC empacotado, `test:renderer`, `test:close`, `test:packaged`), `app` (`test:app`) e `toolbar` (`test:toolbar`, ~6,5 min) rodam em paralelo. PR só de docs (`*.md`, `docs/`) pula os três; o `toolbar` só roda se mudar layout (`src/layout.ts`, `src/video-layout.ts`, `src/organizer.ts`, `src/match-label.ts`, `src/style.css`, `electron/main.ts`, o próprio teste, a fixture de layout, `package*.json` ou workflows). Push na `main` roda tudo, e o release roda `test:renderer`/`test:toolbar`/`test:app`/`test:close` antes do instalador. O status obrigatório da proteção de branch continua sendo `checks` (job final que só passa se os outros passaram ou foram pulados).

**UI / plataforma**

- Alvo exclusivo: **desktop Windows** (mín. ~1024px; referência 1920×1080). Não introduzir layouts mobile nem media queries de telefone/tablet.
- Não reintroduzir navegador externo / perfil auxiliar removidos (ver `DIAGNOSTICO.md`).
- Botão WeddBets foi removido da UI; não reexpor sem pedido explícito (canais IPC podem permanecer).

**Estado e dados**

- Não inventar persistência de URLs/layout em disco sem requisito explícito.
- Não logar nem persistir cookies, tokens, senhas ou corpos de licença DRM.

---

## 4. Protocolo Operacional do Agente (Workflow Mandatório)

Todo agente que receber uma tarefa neste repositório **DEVE** seguir este ciclo:

### 1. Fase de Reconhecimento (antes de qualquer ação)

1. Ler este `AGENTS.md` e a tabela da seção **6**.
2. Verificar se a funcionalidade já existe (total/parcial) ou se há bloqueios documentados (ex.: fullscreen/taskbar em `PLANO-FULLSCREEN.md`; limites Disney+ em `docs/disney-plus-drm.md`; UX de URL no README).
3. Inspecionar os arquivos de domínio certos (`electron/main.ts`, `src/main.ts`, `src/layout.ts`, etc.) antes de propor refatoração.
4. **Não** duplicar nem refatorar código existente sem contexto prévio e necessidade clara da tarefa.

### 2. Fase de Execução

0. **Toda tarefa que altera arquivos (feature, bug, ajuste, docs) roda numa worktree própria**, nunca direto na pasta principal, porque outros agentes podem estar editando o repositório ao mesmo tempo:
   - Criar a partir da `main` atualizada: `git worktree add ../multiview-trabalho-worktrees/<branch> -b <branch> main` (branch no estilo `feat/…`, `fix/…`, `chore/…`, `docs/…`). Em sessões do app Claude, prefira a opção de worktree da própria sessão.
   - Na worktree nova, `npm ci` antes de build/testes (cada worktree tem o próprio `node_modules` e `out/`).
   - Build, testes e commits só dentro da worktree. Não editar arquivos da pasta principal nem de outra worktree.
   - Não rodar `npm run dev` em duas worktrees ao mesmo tempo (porta fixa 43123).
   - Depois do merge do PR: `git worktree remove <caminho>` e apagar a branch local. Se a tarefa for abandonada, avisar o usuário antes de remover (pode haver trabalho não commitado).
   - Exceção: perguntas e leituras sem alteração de arquivo podem ser feitas na pasta principal.
1. Respeitar stack, IPC, segurança Electron e convenções da seção 3.
2. Escrever ou atualizar testes automatizados para código modificado/adicionado (unitário em `tests/*.test.ts` e/ou smoke `.cjs` quando o fluxo for de produto).
3. Rodar validações locais mínimas antes de finalizar:
   - `npm run typecheck`
   - `npm test`
   - e o smoke mais próximo do escopo (`test:renderer`, `test:toolbar`, `test:app`, `test:close`, `test:packaged`, `test:ecs`, etc.).
4. Manter o diff focado no escopo da issue; não “limpar” arquivos não relacionados.

### 3. Fase de Registro (imediatamente após terminar)

Se a tarefa adiciona ou muda algo visível ao usuário, acrescentar/atualizar a nota correspondente na entrada da próxima versão em `src/release-notes.ts` (criando a entrada se ainda não existir).

Atualizar a tabela da seção **6** com: data, escopo, status, arquivos principais, decisões e próximos passos. Se a tarefa ficar bloqueada, registrar o bloqueio e a evidência (comando, erro, doc de referência).

---

## 5. Diretrizes de Segurança, Guardrails e Limites

### Regras de segurança

- **Nunca** versionar `.env`, `EVS_AUTH_JSON`, arquivos de autenticação EVS, certificados, chaves API, cookies, tokens ou dumps de licença DRM.
- Não colar secrets em issues, PRs, chats ou artefatos versionados. No CI, `EVS_AUTH_JSON` fica só no temp do runner.
- Não enfraquecer o modelo de privilégios Electron: `contextIsolation`, `nodeIntegration: false`, sandbox em conteúdos remotos, validação de sender IPC.
- Não ampliar a superfície do preload além do necessário para a feature.
- Updater: manter validação HTTPS + SHA-512 do `latest.yml`; não instalar updates em background sem confirmação do usuário.
- Assinatura: EVS/VMP **não** substitui Authenticode; não afirmar que o instalador está assinado pelo Windows sem certificado.

### O que o agente NÃO DEVE fazer

| Proibido | Motivo |
| --- | --- |
| Trocar o Electron Castlabs ECS por Electron stock sem justificativa explícita e validação DRM | Quebra Widevine / Disney+ path |
| Alterar dependências principais (`electron`, `electron-builder`, `yalps`, `electron-updater`) sem necessidade comprovada da tarefa | Risco de regressão de layout/DRM/release |
| Ignorar falhas de `typecheck`, `npm test` ou smokes relevantes ao escopo | Quebra o contrato de qualidade do repo |
| Modificar arquivos fora do escopo da issue / “drive-by refactors” | Aumenta risco e ruído de review |
| Commitar `node_modules/`, `out/`, `release/`, `release-*`, logs ou artifacts sensíveis | Já cobertos pelo `.gitignore` |
| Publicar release GitHub ou mover tags `v*` públicas | Processo humano + workflow draft |
| Reintroduzir controle de navegador externo / PowerShell auxiliar | Removido de propósito (`DIAGNOSTICO.md`) |
| Afirmar reprodução Disney+ só com `test:drm-diagnostic` | Diagnóstico ≠ licença do serviço |
| Coletar ou exfiltrar credenciais de serviços embutidos nos painéis | Fora do escopo do produto |

### Limitações conhecidas (não “corrigir de passagem” sem pedido)

- Validação UX de URL inválida, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em alguns links YouTube (README).
- Sobreposição da barra de tarefas do Windows sobre a toolbar em certas sequências de fullscreen (`PLANO-FULLSCREEN.md`).
- Evidência Disney+ depende de instalador com VMP de produção + teste manual; diagnóstico local só prova CDM/EME.

---

## 6. Histórico de Tarefas, Decisões e Estado Atual

Tabela viva — **todo agente deve acrescentar uma linha ao concluir (ou bloquear) uma tarefa**.

Entradas antigas estão em `docs/historico-tarefas.md`. Só consulte esse arquivo quando a tarefa tocar numa área específica (procure pelo nome do arquivo ou da feature), sem ler tudo.

| Data | Tarefa / Escopo | Status (Concluído / Parcial / Bloqueado) | Arquivos Principais Afetados | Detalhes & Decisões Tomadas | Próximos Passos |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-11-05 | Matching 365Scores lê títulos com " - " entre os times ("Flamengo - Palmeiras", "AO VIVO \| Bayern München - Dortmund \| Bundesliga") | Concluído no código (typecheck, `npm test` 596/596 com casos positivos e negativos novos, `build`; sem validação ao vivo) | `src/match-label.ts`, `src/livescore-365.ts`, `tests/livescore-365.test.ts`, `tests/match-label.test.ts`, `src/release-notes.ts`, `AGENTS.md` | Pedido do usuário. Novo `extractDashMatchup` (pré-processamento compartilhado com `extractMatchLabel` via `prepareTitle`/`stripLivePrefix`, sem mudar o resultado dele), usado só como reserva em `teamsFromTitle` quando não há rótulo "A x B". Regras: nenhum " x "/" vs "/" v " no título; " - " ou " – " com espaços (hífen sem espaço, como Saint-Germain/Al-Ittihad, nunca separa); exatamente uma parte do `\|` com exatamente dois lados; cada lado com até 40 caracteres e 5 palavras, sem `:`/`#`/`@`, sem palavras de não-jogo (melhores momentos, rodada, highlights…) e que não seja uma competição (`detectCompetition`); placar em volta do traço ("Grêmio 1 - 0 Internacional") é tirado. Na dúvida devolve null (o painel cai na pergunta ou fica sem vínculo). O rótulo do painel (`extractMatchLabel`) **não** mudou: título só com " - " continua sem rótulo, para não mostrar texto que não é jogo (no matching o 365Scores confere os times; no rótulo não há essa conferência). Nota na nova entrada `1.3.2`. | Validar ao vivo com uma live "A - B"; se o usuário quiser, mostrar o rótulo quando o painel estiver ligado ao 365Scores. |
| 2026-11-05 | Revisão de bugs das features recentes (placar WH no gol, várias contas BLL, PIP, gaveta de escalação/tabela, nome do artilheiro 365Scores) | Concluído no código (typecheck, `npm test` 592/592 com o caso novo em `tests/livescore-365.test.ts`, `build`; `npm ci` só com `--ignore-scripts` porque o download do runtime ECS falhou no container; smokes Electron não rodados) | `src/livescore-365.ts`, `src/info-drawer.ts`, `src/main.ts`, `tests/livescore-365.test.ts`, `src/release-notes.ts`, `AGENTS.md` | Pedido do usuário. Revisão por leitura dos commits desde 30/10. Corrigidos: (1) 365Scores: gol anulado (placar cai) deixava o pedido de nome pendente com o mesmo nº de ordem do próximo gol do time, e o nome do gol novo ia para o alerta do anulado (teste falhava antes); agora a queda do placar descarta os pendentes acima do placar novo. (2) Gaveta de informações aberta não recarregava quando o jogo do painel mudava sem trocar a URL (WH resolvido para jogo do 365Scores, novo vínculo pelo título): o main já reenviava `quadra:match-info-ready` com `ready: true`, a UI só tratava o `false`; agora `infoDrawer.refresh`. Sem teste Node (DOM/`electron`). Achados plausíveis não mudados: leitura da lista BLL em andamento durante troca de conta (acesso a `webContents` de janela destruída), `closed` atrasado da janela oculta da BLL zerando a janela nova, limpeza da conta removida só na origem da BLL, sobra de "subida" do placar WH após gol contra/aquecimento (gol seguinte em até 5 s sairia sem o +1). Nota na nova entrada `1.3.2`. | Conferir no app; avaliar os achados plausíveis com o Electron real. |
| 2026-11-05 | Revisão de segurança de IPC, preload e isolamento de sessões | Concluído no código (typecheck, `npm test` 595/595 com o novo `tests/web-security.test.ts`, `build`, `test:renderer`; `test:app`/`test:close` não rodados: exigem `electron.exe` (Windows); sem teste de DRM real) | `electron/web-security.ts`, `electron/main.ts`, `tests/web-security.test.ts`, `package.json`, `AGENTS.md` | Pedido do usuário. Revisados todos os `ipcMain.on/handle` (sender e payloads), os 3 preloads, partições BLL, janelas ocultas e o HTML do overlay/PIP/Monitor com dados remotos. Corrigido: (1) o overlay não pode navegar para fora da própria página nem abrir popups (`will-navigate` + `setWindowOpenHandler`); (2) toda sessão (`session-created`) só concede `fullscreen`, `mediaKeySystem`, escrita no clipboard e storage-access, em vez do padrão do Electron de conceder tudo; (3) o catálogo BLL/WeddBets só abre popups HTTP(S). Sem mudança no preload nem nos arquivos do 365Scores/scanner/gaveta. Pontos de risco baixo ficaram registrados no relatório da sessão. | Conferir no Windows (`test:app`, `test:close`) e com DRM real (BLL/Disney+) que a lista de permissões não bloqueia nada que os players usam. |
| 2026-11-05 | `AGENTS.md` menor: entradas antigas da seção 6 movidas para `docs/historico-tarefas.md` | Concluído (só texto; contagem de linhas de tarefa conferida por script: 99 antes = 23 + 76 depois) | `AGENTS.md`, `docs/historico-tarefas.md` | Pedido do usuário: todo agente lê o arquivo inteiro e a tabela era a maior parte. Ficam as entradas a partir de 2026-10-30 e as mais antigas ainda pendentes (players pretos no lote BLL); o resto foi copiado literalmente para o arquivo. Entradas "Em andamento" de bumps antigos (1.1.x) foram arquivadas porque esses releases já saíram. Ponteiro acima da tabela e na tabela de documentação complementar. | Quando a tabela voltar a crescer, mover as entradas com mais de ~7 dias para o arquivo (mais novas no topo do arquivo). |
| 2026-11-04 | Placar certo no alerta de gol da William Hill (feed com o placar atrasado ou adiantado em relação ao lance) | Concluído no código (typecheck, `npm test` 589/589 com as sequências reais de Feyenoord, Blackburn e Portsmouth; scanner real em 21 jogos da BLL ao vivo, 4 gols corretos; sem gol contra nem VAR ao vivo; sem app com gol real) | `src/match-events.ts`, `electron/scoreboard-scanner.ts`, `tests/match-events.test.ts`, `src/release-notes.ts`, `AGENTS.md` | Pedido do usuário. O lance de gol e o placar da página chegam em tópicos separados: o alerta saía com o placar antigo (2x0 mostrava 1x0). Cada gol é casado com uma subida do placar do mesmo lado: subida já pendente = a página já tem o gol; senão o gol é somado ao placar da página. Placar que cai descarta o pendente daquele lado. Gol contra, gol sem lado e o primeiro minuto de watching (replay) esperam a página, por até 4 s. 365Scores não muda. Nota na `1.3.1`. | Conferir no app com um gol real; ver no log do scanner as linhas "placar previsto" e "placar do feed não mudou". |
| 2026-11-04 | Ícones novos nos controles do painel (destaque, alertas, PIP, tela cheia, estatísticas) | Concluído no código (typecheck, `npm test` 580/580, `build`, `test:renderer`) | `public/*-icon.png`, `src/main.ts`, `src/info-drawer.ts`, `src/pip/pip-page.ts`, `src/style.css`, `src/release-notes.ts`, `AGENTS.md` | Pedido do usuário. Troca ★/☆, sino SVG, PIP SVG, texto "Tela Cheia" e camisa SVG pelos PNGs enviados (mesmo padrão de trash/reload em `public/`). Alertas desligados: borda vermelha + traço; destaque off: estrela esmaecida. Nota na entrada `1.3.1`. | Conferir visualmente nos painéis e na janelinha PIP. |
| 2026-11-03 | Várias contas BLL (partições nomeadas) com dropdown no hover de Abrir vários jogos da BLL | Concluído no código (typecheck, `npm test` 580/580, `build`, `test:renderer`, `test:app` com add/switch de perfil e cookie isolado; sem login real) | `electron/bll-profiles.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/bll-profiles.test.ts`, `tests/app-integration.cjs`, `tests/renderer-smoke.cjs`, README, `AGENTS.md`, `package.json` | Pedido do usuário: time reveza contas BLL no mesmo PC sem perder Auto/alertas. Metadata em `userData/bll-profiles.json` (máx. 8); partição `persist:quadra-bll-<id>`; catálogo/lista/players BLL usam a ativa; resto em `persist:quadra`. Hover/focus-within em `.chooser__bll` lista contas + Adicionar (última) + × remove. Troca recria só views BLL. Migração: cria Principal e limpa cookies BLL da sessão compartilhada. Sem senhas no app. Nota `1.3.1` (package 1.3.0). | Conferir ao vivo com 2 logins reais; bump no PR de release. |
| 2026-10-31 | Botão Voltar com a imagem verde de seta enviada pelo usuário, mais comprido | Parcial (só código; sem `npm ci`, typecheck, build nem conferência visual) | `src/style.css`, `src/main.ts`, `src/assets/back-button.webp` | Pedido do usuário. O `::before` do `.back-corner` mostra a imagem (cortada com `background-size: 140%` por causa da margem branca) e o texto virou só "Voltar" ao lado, com `min-width: 6.4em`; `setBackVisible` continua ajustando altura e posição, e a fileira desliza pela largura medida. Sem nota de versão (ajuste visual). | Conferir visualmente no painel do canto, em painéis pequenos. |
| 2026-10-30 | CI mais rápido (jobs paralelos + filtro por arquivo) e release como PR próprio, sem bump nos PRs de feature | Concluído no código (só workflows e texto; CI medido no próprio PR) | `.github/workflows/windows-pr-checks.yml`, `.github/workflows/windows-release.yml`, `AGENTS.md` | Pedido do usuário. Medido nos últimos runs: ~10 min por PR, dos quais `test:toolbar` 393 s e `test:app` 129 s; `npm ci` só 18 s (cache extra quase não ajuda, por isso não entrou). Agora `fast`, `app` e `toolbar` em paralelo; `toolbar` só quando muda layout; docs-only pula tudo; job final `checks` mantém o nome do status obrigatório. Push na `main` roda a suíte inteira e o release passou a rodar os smokes de produto antes do instalador (antes não rodava nenhum). Linux para typecheck/unitários foi descartado: o `npm ci` baixa o runtime ECS e o job `fast` inteiro já cabe em ~2 min no Windows. Regra de bump da seção 3 trocada: PR de release separado. | Conferir no 1º PR de código o tempo real (esperado ~3 min sem layout, ~7 min com layout) e se o `checks` obrigatório aceita os jobs pulados. |
| 2026-10-30 | Cor própria na borda dos alertas de VAR, touchdown e field goal (antes os três usavam o verde do gol) | Concluído no código (typecheck, `npm test` 499/499, `build`, `test:renderer`; cores conferidas no navegador com o CSS do build; sem alerta real) | `src/style.css`, `src/release-notes.ts`, `AGENTS.md` | Pedido do usuário: um alerta de VAR (📺, decisão já tomada) aparecia com a borda verde igual à do gol, porque `.panel--alert-var`/`-touchdown`/`-field-goal` não tinham regra e caíam no `--alert-color` padrão. Agora VAR = azul `#5fb4ff` (o mesmo do VAR em andamento, mas borda contínua com brilho; a revisão segue tracejada), touchdown = roxo `#c08bff`, field goal = verde-água `#3fe0c4`. Novo `--alert-ink` (texto do selo, caixa do placar de quem marcou e botões Fixar/Voltar) no tom escuro de cada cor; padrão `#101a0c`. Nota na nova entrada `1.2.2` (versão do `package.json` ainda 1.2.1, `v1.2.1` já tem tag). | Bump para 1.2.2 no PR que for virar release. |
| 2026-10-30 | Regra: toda tarefa que altera arquivos roda numa worktree própria | Concluído (só texto) | `AGENTS.md` | Pedido do usuário depois de duas sessões editarem a mesma pasta ao mesmo tempo (artilheiro do 365Scores e lista do ⏱): o `test:app` de uma rodou com o código pela metade da outra. Regra no passo 0 da seção 4.2: worktree em `../multiview-trabalho-worktrees/<branch>` a partir da `main`, `npm ci` na worktree, remover depois do merge. | — |
| 2026-10-30 | Lista do atraso (⏱) dos painéis 365Scores no visual do Quadra, em vez do `<select>` nativo do Windows | Concluído no código (typecheck, `npm test` 499/499, `build`, `test:app` com abrir a lista, escolher 10 s e voltar ao padrão, `test:renderer`; sem conferência visual) | `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/app-integration.cjs` | Pedido do usuário. O ⏱ virou `<button data-live-delay>` e abre `.delay-menu` (listbox no `body`, `position: fixed`, para painel pequeno não cortar; abaixo do botão ou acima se não couber), com o mesmo estilo do seletor de som (fundo verde escuro, item escolhido em verde). Fecha com clique fora, Esc, resize/blur ou se o botão some; setas e Enter funcionam. Correção após teste do usuário (a lista sumia ao levar o cursor até ela): no vão entre o botão e a lista o hit-test soltava o overlay e devolvia o foco aos players (`mainWindow.focus()`), o overlay perdia o foco e o `blur` fechava a lista; agora `setChromeInteractive` não devolve o foco enquanto a lista está aberta. `.delay-menu` entra no hit-test do overlay e segura a toolbar aberta. Nota na entrada `1.2.2` (estava na `1.2.1`, que já tinha tag). | Conferir visualmente num painel pequeno. |
| 2026-10-31 | Rótulo do jogo sem a tag de transmissão ("AO VIVO:", "🔴 EN VIVO -", "com imagens") na frente do time da casa | Concluído no código (typecheck, `npm test` 573/573, `build`; sem conferência visual) | `src/match-label.ts`, `tests/match-label.test.ts` | Vinha de um commit `wip` esquecido na branch do matching por sigla; o resto dele já estava na main. Sem nota de versão (a 1.2.1 pode já ter sido lançada). | — |
| 2026-10-31 | Janela flutuante (picture-in-picture): botão no painel abre o jogo numa janelinha sempre por cima, com alertas, placar e botões | Concluído no código (typecheck, `npm test` com o novo `tests/pip.test.ts` escrito pelo Haiku, `build`, `test:app` com ida e volta sem recarregar o player e mute pela janelinha, `test:renderer`, `test:close`; sem validação com DRM real, com a janela principal minimizada, com alerta real nem em DPI alto) | `src/pip.ts`, `src/pip/pip-page.ts`, `src/pip/pip.css`, `pip.html`, `electron/pip-window.ts`, `electron/pip-preload.ts`, `electron/main.ts`, `electron/preload.ts`, `src/main.ts`, `src/alert-ui.ts`, `src/layout.ts`, `src/style.css`, `src/electron.d.ts`, `electron.vite.config.ts`, `tests/pip.test.ts`, `tests/app-integration.cjs`, `src/release-notes.ts`, README, ONBOARDING | Pedido do usuário (relato de quem trabalha com um monitor só e usava o picture-in-picture da BLL, que não mantém alertas nem botões). O renderer do overlay manda (`pipPanels`, `buildPipState`, `handlePipCommand`); o main só move a `WebContentsView` entre `mainWindow` e a janela flutuante (`removeChildView`/`addChildView`, sem recarregar) e repassa estado e comandos validados (`parsePipCommand`, `isValidPipState`, sender conferido). `PanelPayload.pip` novo. Decisões do usuário: barra fina em cima (sem nada sobre o vídeo), janela principal intacta, vários painéis ao mesmo tempo (pedido posterior do usuário: `createPipWindowController` guarda um mapa `panelId` → janela, o `sender` do IPC identifica o painel, cada janela tem a sua altura de barra e uma posição inicial em `slot` empilhada para cima; `hasAtMostOnePip` saiu), placeholder na grade com "Trazer de volta". Na janelinha: mutar, ✎ (URL/BLL/YouTube/Zapping), recarregar, ⏱, 🔔, "Qual jogo é este?", "Manter aberto", Voltar; sem ★/arrastar/organizar. O painel flutuante fica de fora do auto-destaque de gol/VAR, da troca no intervalo e da substituição do modo Auto; o alerta e o som continuam. Com a janela principal minimizada o overlay não recebe `requestAnimationFrame`, então `scheduleSyncLayout` usa `setTimeout`; painel com bounds inválidos e mesma URL não destrói mais a view. Zoom (teclas e rodinha) na janelinha não mexe na grade. Posição/tamanho só em memória. Nota na nova entrada `1.3.0` de `RELEASES` (versão do `package.json` ainda 1.2.1). | Testar à mão com um jogo BLL real (Widevine) e uma live do YouTube indo e voltando sem tela preta; som do alerta com o Quadra minimizado; janelinha sobre o Quadra em tela cheia; DPI 125%/150%; bump de versão no PR que virar release. |
| 2026-10-31 | Aba "Tabela" na gaveta de informações do jogo (classificação do campeonato com os times do jogo em destaque), ao lado de "Escalação" | Concluído no código (typecheck, `npm test`; sem conferência visual nem `test:app`; construído em cima do branch `feat/lineup-drawer`, que ainda não está no `main`) | `src/match-info.ts`, `src/info-drawer.ts`, `electron/match-info.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/style.css`, `src/release-notes.ts`, `tests/match-info.test.ts`, README | Pedido do usuário. Lido na API real em 31/10: `/web/game/` traz `competitionId`, `seasonNum`, `stageNum`, `groupNum` (só em torneio com grupos) e `hasStandings`; `/web/standings/?competitions=&seasonNum=&stageNum=` devolve ~150 KB com `rows` (posição, J/V/E/D, `ratio` = saldo, pontos, `destinationNum`) e `destinations` (nome e cor das faixas). Em competição com grupos vêm todos os grupos numa lista só, separados por `groupNum`: a UI mostra o do jogo (ou o de um dos times). Escudos por novo canal `quadra:table-crests` (UI → main, até 40 refs validadas por `parseTeamRefs`), no mesmo cache de imagens. Aba nova no `INFO_TABS`; cada aba guarda o último resultado para trocar sem esperar. Painel só com a escalação WH (sem jogo do 365Scores) responde `none` na tabela. Colunas V/E/D/SG somem em gaveta estreita (container query); E e P somem quando a tabela não tem empates/pontos. Nota na entrada `1.2.2`. | Conferir visualmente e ao vivo (tabela com grupos, basquete); bump de versão no PR que for virar release. |
| 2026-10-31 | Botão de camisa (👕) com a escalação do jogo numa gaveta sobre o painel (365Scores, com a escalação do radar William Hill como reserva) | Concluído no código (typecheck, `npm test` 522/522 com o novo `tests/match-info.test.ts` escrito pelo Haiku, `build`, `test:app` com 👕, gaveta, fotos, troca de time, Esc/×, e painel WH sem jogo no 365Scores, `test:renderer`; sem conferência visual nem ao vivo; branch `feat/lineup-drawer`, sem commit) | `src/match-info.ts`, `src/info-drawer.ts`, `src/main.ts`, `src/style.css`, `src/team-crests.ts`, `src/electron.d.ts`, `electron/match-info.ts`, `electron/image-cache.ts`, `electron/team-crests.ts`, `electron/livescore-365.ts`, `electron/scoreboard-scanner.ts`, `electron/main.ts`, `electron/preload.ts`, `src/release-notes.ts`, `tests/match-info.test.ts`, `tests/app-integration.cjs`, `package.json`, README | Pedido do usuário. Novos IPC `quadra:match-info` e `quadra:athlete-photos` (invoke, só `isUiSender`, validação no main) e `quadra:match-info-ready` (main → UI: o 👕 só aparece com `ready`). O jogo do painel vem do linker 365 (`gameIdOf`) ou de `findLinkedGame` (refatorado de `findCrestTeams`, com `reversed`) via `onGame` dos escudos; `createMatchInfo` guarda as fontes e a escalação WH, cache de 30 s por jogo. Fotos e escudos dividem `electron/image-cache.ts` (LRU, 800). Escalação WH: o scanner lê as listas de titulares da página do placar (embrulha `lineups.diffusionHandler` e cai para o DOM `.players_home/.players_away`), nome por `formatPlayerName`; a página não expõe `coachName`, então não há técnico na fonte WH. Gaveta no `body` (`position: fixed` sobre o painel), abas prontas para Tabela/Odds/Jogos (só Escalação visível), clique fora não fecha, escalação não segue o atraso ⏱ (decisão: a lista não mostra gols nem substituições). Nota na entrada `1.2.2` (versão do `package.json` ainda 1.2.1). | Conferir visualmente (painel pequeno e destaque) e ao vivo; depois, abas Tabela/Odds/Jogos. |
| 2026-10-31 | Botão Voltar como 1º botão da fileira de controles do painel do canto superior esquerdo | Concluído (typecheck, `build`, `test:renderer`; conferido pelo usuário) | `src/main.ts`, `src/style.css` | Pedido do usuário. Antes o Voltar ficava acima da fileira (os controles desciam 2,9rem e a altura mudava). Agora `setBackVisible` mede o 1º `.btn` da fileira do painel do canto e põe o botão fixo no mesmo `top`/`left`/altura (fonte proporcional); a fileira ganha `padding-left: var(--back-shift)` (largura do botão + gap) e desliza para a direita. Sem nota de versão (ajuste visual pequeno). | — |
| 2026-10-31 | Chave da YouTube API no dev a partir de qualquer worktree | Concluído no código (typecheck; sem teste automatizado, pois a lógica fica em `electron/youtube-search.ts`, que importa `electron`; sem rodar o app) | `electron/youtube-search.ts`, `AGENTS.md` | Relato do usuário: no `npm run dev` de um worktree o botão do YouTube não carregava, porque o `.env` (gitignored) só existe no checkout principal e o worktree não o leva. Em dev, `envFileCandidates` agora também procura o `.env` do checkout principal, achado pelo arquivo `.git` do worktree (`gitdir: <main>/.git/worktrees/<nome>`, três níveis acima). Prioridade: `.env` do projeto, do cwd e do checkout principal. Empacotado não mudou. Sem nota de versão (só dev). | Conferir ao vivo num worktree novo sem `.env`. |
| 2026-10-30 | Versão 1.2.1 (matching 365Scores por sigla e por um time inequívoco) | Em andamento (bump no próprio PR #27, a pedido do usuário; typecheck, `npm test`; tag `v1.2.1` depois do merge e do CI verde) | `package.json`, `package-lock.json`, `AGENTS.md` | Bump 1.2.0 → 1.2.1 junto da correção, como manda a seção 3. Nota já na entrada `1.2.1` de `RELEASES`. | Conferir o draft (instalador, `latest.yml`, EVS) e testar a atualização 1.2.0 → 1.2.1. |
| 2026-10-30 | Nome de quem marcou nos gols do 365Scores (YouTube e BLL sem William Hill) mesmo quando o nome chega depois do alerta | Concluído no código (typecheck, `npm test` 508/508 com os casos novos de `scorerUpdates` escritos pelo Haiku, `build` + `test:app` (1ª rodada caiu na troca do intervalo, com outra sessão editando `src/main.ts` em paralelo; 2ª passou); medição ao vivo da API, sem teste no app com gol real) | `src/livescore-365.ts`, `electron/livescore-365.ts`, `electron/main.ts`, `tests/livescore-365.test.ts`, `src/release-notes.ts` | Relato do usuário: o app do 365Scores no celular já mostra o artilheiro e o Quadra não. A API traz `playerId` + `members` nos eventos de gol, e o alerta já usava isso, mas medido ao vivo em 30/10: o evento de gol muitas vezes chega **sem jogador** e o nome aparece 3–27 s depois (Roda JC, Helmond, Club Brugge…), ou o evento inteiro chega depois dos 9 s de carência (Rapperswil, +14 s) e o gol alerta pelo placar; nos dois casos o nome nunca era enviado. Agora `LiveState.unnamedGoals` guarda os gols alertados sem nome (nº do gol do lado, minuto, se veio do placar) e `scorerUpdates` procura o n-ésimo evento de gol daquele lado a cada rodada (3 s); quando tem nome, manda pelo mesmo `quadra:match-scorer` do William Hill (o selo já aceitava o nome depois). Gol pelo placar só aceita evento a até 3 min; gol contra não dá nome; desiste em 3 min (`SCORER_WAIT_MS`). Monitor: `nome do gol: Fulano`. Nota na entrada `1.2.2` (estava na `1.2.1`, que já tinha tag). | Ver ao vivo o tempo entre o selo e o nome. |
| 2026-10-30 | Matching YouTube/BLL → 365Scores mais consistente (Le Havre x PSG e Venezia x Inter não ligavam) | Concluído no código (typecheck, testes do 365Scores com os novos casos escritos pelo Haiku; replay com as listas reais do 365Scores de 28 e 30/10; sem validação ao vivo no app) | `src/livescore-365.ts`, `tests/livescore-365.test.ts`, `src/release-notes.ts`, README | Relato do usuário. Log do dia: `nenhum jogo para "AO VIVO: LE HAVRE X PARIS SAINT-GERMAIN \| LIGUE 1…"`; em `langId=31` o 365Scores chama o time só de "PSG" (sem nome longo), então o lado "Paris Saint-Germain" dava 0 e o jogo nem virava candidato (sem pergunta). Venezia x Inter: o 365Scores escreve "Inter de Milão"; "Inter"/"Internacional" (só palavra genérica) davam 0,7 e "Inter Milan" 0,5, então o jogo só virava pergunta, e a busca de escudos e de artilheiro (que só aceitam `matched`) ficava sem nada para o painel BLL/WH. Correções: sigla pelas iniciais (`isAcronymOf`, 2–4 letras, vale 0,9); alias `milao` → `milan`; `pairFit`: um lado inequívoco (≥ 0,9 com palavra distintiva) carrega o outro lado parcial (≥ 0,5) até `LINK_SCORE`, a não ser que o nome do título tenha palavra distintiva que o jogo não tem (`contradicts`: "Real Betis" ≠ "Real Madrid"); a margem `LINK_MARGIN` continua decidindo entre jogos parecidos. Se o outro lado não casa nada, o jogo ao vivo/a menos de 3 h entra como candidato (`CANDIDATE_SCORE`, nome exato antes de prefixo), então o painel pergunta em vez de ficar calado. Muda a decisão antiga "nomes só com palavras genéricas nunca ligam sozinhos": agora ligam quando o outro time é inequívoco e o jogo é o único que serve. Título com " - " entre os times passou a ser lido em 2026-11-05 (`extractDashMatchup`). Nota na nova entrada `1.2.1`. | Validar ao vivo; ver no Monitor se aparecem perguntas demais com o candidato de um lado só. |
| 2026-10-30 | Versão 1.2.0 (primeiros passos, avisos de atualização no visual do Quadra, botão YouTube no painel, zoom dos botões, "Como instalar" no release) + release | Em andamento (typecheck, `npm test`; commit + bump no mesmo PR contra `main` com auto-merge; tag `v1.2.0` depois do merge e do CI verde, pedido explícito do usuário) | `package.json`, `package-lock.json`, `src/release-notes.ts`, `AGENTS.md` | A entrada `1.1.10` de `RELEASES` virou `1.2.0` (rótulo "1.2"), versão escolhida pelo usuário. `artifacts/` ficou fora do commit (capturas). | Conferir o draft (instalador, `latest.yml`, EVS, seção "Como instalar" no topo) e testar a atualização 1.1.9 → 1.2.0. |
| 2026-10-30 | Botão vermelho "YouTube" no painel vazio, entre BLL e Zapping, abrindo o mesmo diálogo "Abrir jogos ao vivo do YouTube" da tela inicial | Concluído no código (typecheck, `npm test` 494/494, `build`, `test:app` com ordem dos botões e abertura/cancelamento do diálogo pelo painel, `test:renderer` com `barsFit` em 1–18 telas; sem conferência visual nem com a API real) | `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/app-integration.cjs` | Pedido do usuário. `openBatch('youtube', id)`: mesmo diálogo (canais, atualizar, lista); o painel que abriu recebe o 1º jogo marcado (`applyBatch(..., firstPanelId)` põe esse painel na frente dos vazios do `planBatchOpen`), os demais seguem a regra do lote (vazios, depois telas novas). Na tela inicial o comportamento não mudou. O `test:app` agora conta canais distintos no `playlistItems`, porque o diálogo aberto pelo painel pode ter feito uma busca antes (cache de 60 s). Nota na entrada `1.2.0` (antes `1.1.10`). | Conferir visualmente em painéis pequenos (4 botões + Abrir/Limpar). |
| 2026-10-30 | Zoom da interface (Ctrl + / Ctrl − / Ctrl 0 e Ctrl + rodinha) também com os painéis abertos | Concluído no código (typecheck, `npm test` com o novo `tests/ui-zoom.test.ts` escrito pelo Haiku, `build`, `test:app` com zoom por teclas e rodinha mandados ao player, `test:renderer`, `test:close`, `test:toolbar`; sem teste com teclado/mouse reais) | `electron/ui-zoom.ts`, `electron/main.ts`, `tests/ui-zoom.test.ts`, `tests/app-integration.cjs`, `src/release-notes.ts`, `package.json`, README | Pedido do usuário. O zoom do overlay já existia, mas só com o foco no overlay; com jogos abertos o foco fica no player e a rodinha cai no player. Agora `before-input-event` do overlay **e das views dos painéis** (`isUiZoomSource`) mudam o zoom do overlay (`zoomOverlay`; teclas engolidas, a página do player nunca recebe zoom), e o `zoom-changed` (Ctrl + rodinha) do overlay e dos painéis faz o mesmo. Monitor, janelas ocultas e catálogo não entram. O Electron emite `zoom-changed` duas vezes por clique da rodinha (~1 ms entre elas): `createWheelZoomGate` ignora o 2º em 30 ms. `applyLayout` já multiplica os bounds pelo fator de zoom, então grade e players não mudam; botões e toolbar (em rem) crescem. O `test:app` sobe o main com `--inspect` e manda as teclas/rodinha com `sendInputEvent` pelo inspector, porque o input do DevTools (`Input.dispatch*`) pula o `before-input-event`/`zoom-changed`. Zoom só em memória, como antes. Nota na entrada `1.2.0` (antes `1.1.10`). | Conferir com teclado e mouse reais (rodinha e touchpad de precisão, que manda muitos eventos pequenos). |
| 2026-10-30 | Avisos de atualização ("Atualização disponível" e "Atualização pronta") desenhados pelo Quadra em vez da caixa nativa do Windows | Concluído no código (typecheck, `npm test` 454/454 com o novo `tests/ui-dialog.test.ts`, `build`, `test:renderer`, `test:close`; diálogos renderizados num Electron com bridge falsa e conferidos em imagem, clique e Esc voltaram o botão certo pelo IPC real; sem atualização real) | `electron/ui-dialog.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/ui-dialog.test.ts`, `package.json` | Pedido do usuário. `createAutoUpdateController` não mudou: continua recebendo um `showMessageBox`, agora `uiMessageBox.show`, que manda `quadra:ui-dialog` (main → UI: `id`, título, mensagem, detalhe, botões, `defaultId`, `cancelId`) e espera `quadra:ui-dialog-response` (UI → main, só `isUiSender`, `id` aberto e índice de botão válido). A UI (`showUiDialog`) usa as classes das janelas existentes (eyebrow verde, título, lista de novidades e botões, como "Novidades da versão"), por cima de qualquer outro diálogo (`.confirm.ui-dialog`, z-index 110; os outros diálogos passaram a remover só `.confirm:not(.ui-dialog)`). Esc = botão de cancelar. Fallback para a caixa nativa se o overlay não existe ou ainda não carregou; overlay fechado ou recarregado conta como "Agora não"/"Depois" (`cancelAll`). Nota na entrada `1.2.0` (criada como `1.1.10`). | Ver ao vivo numa atualização real com o instalador. |
| 2026-10-30 | Seção "Como instalar" no README e no começo da descrição de cada release (passos para baixar o `.exe` e aviso do SmartScreen) | Concluído no código (só texto e workflow; sem rodar o workflow nem testes; nada commitado) | `README.md`, `.github/release-install.md`, `.github/workflows/windows-release.yml`, `AGENTS.md` | Pedido do usuário: colegas de trabalho chegam pela página de Releases, não pelo repositório. O texto do release fica em `.github/release-install.md` e o workflow o passa em `--notes-file` junto com `--generate-notes` (o GitHub põe o texto antes das notas geradas). O instalador não tem Authenticode, então o aviso do SmartScreen/navegador é o ponto principal. A descrição do release publicado `v1.1.9` foi editada com `gh release edit` (texto de instalação antes das novidades; a seção "Versões anteriores" saiu a pedido do usuário, a descrição de cada release leva só as novidades da própria versão, para os Assets não ficarem longe do topo); releases antigos não foram mexidos. Mantenha o texto do README e o de `release-install.md` iguais. | Conferir no próximo release que o draft sai com a seção no topo; se o texto for alterado, editar também o release `latest` na mão. |
| 2026-10-23 | Lote BLL: players que ficavam pretos ao abrir muitos jogos de uma vez | Parcial (typecheck, `npm test` 225/225, `test:app`, `test:close`, `test:renderer`; causa não confirmada ao vivo) | `electron/player-start.ts`, `electron/main.ts`, `tests/player-start.test.ts`, `package.json` | Relato do usuário: com 16 jogos cerca de metade ficava preta, e reabrir um por um resolvia. Hipótese: todos os players BLL (OpenVidu) negociando o stream no mesmo instante. Agora os carregamentos de player de catálogo esportivo são espaçados em 0,2 s (`createLoadPacer`; começou em 1,2 s, reduzido a pedido do usuário), e um vigia checa a cada 3 s se algum `<video>` está tocando; sem vídeo 25 s após o load, recarrega (no máximo 2 vezes por URL, contador zera ao reabrir), com log no Monitor de lances. O log "sem feed de lances" agora traz título/URL do painel (ids `panel-N` são um contador, não a posição). Teste unitário por subagente Haiku. | Validar ao vivo com 16 jogos; ajustar espaçamento/timeout se ainda houver painéis pretos ou se jogos sem stream recarregarem à toa. |

---

## Referência rápida de entrada (para humanos e agentes)

1. `AGENTS.md` (este arquivo) → protocolo e estado.
2. `README.md` → comportamento do produto e release.
3. `electron/main.ts` + `src/main.ts` → integração e UI.
4. `src/layout.ts` + `src/video-layout.ts` → contrato geométrico.
5. `tests/app-integration.cjs` / `tests/toolbar-smoke.cjs` → regressão de produto.
