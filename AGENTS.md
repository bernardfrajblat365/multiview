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

Persistência: **somente memória** para painéis/URLs/layout (undo ≤ 24). Única sessão persistente deliberada: Chromium `persist:quadra` (login BLL/cookies). Sem coleta de credenciais pelo app.

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

Fonte de verdade das versões de pacote: `package.json` / `package-lock.json`. Versão do produto atual: **1.1.2**.

### Variáveis de ambiente relevantes

| Variável | Uso |
| --- | --- |
| `QUADRA_BLLSPORT_URL` | Override da home do catálogo BLL (testes/fixtures) |
| `QUADRA_WEDDBETS_URL` | Override WeddBets (legado no código) |
| `QUADRA_YOUTUBE_API_KEY` | Chave da YouTube Data API v3 do usuário (lote de lives). Lida pelo main do ambiente ou de `.env` (dev: raiz do projeto; empacotado: ao lado do exe ou em `userData`). Nunca versionar; `.env` está no `.gitignore` e fora de `build.files` |
| `QUADRA_YOUTUBE_API_URL` | Override da base da API (`…/youtube/v3`; fixtures do `test:app`) |
| `QUADRA_365SCORES_URL` | Override da base da API web do 365Scores (testes/fixtures) |
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

Estilo observado no histórico: Conventional Commits em inglês — `feat:`, `fix:`, `chore:`, `docs:`. Bumps de versão: `chore: bump Quadra to x.y.z`. Tags de release: `v*` alinhadas a `package.json` `version`. Todo bump de versão inclui a entrada da nova versão no topo de `RELEASES` em `src/release-notes.ts` (pop-up "Novidades da versão"), com título e descrição de cada novidade em linguagem para o usuário final; `tests/release-notes.test.ts` falha se a versão do `package.json` não tiver notas.

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

| Data | Tarefa / Escopo | Status (Concluído / Parcial / Bloqueado) | Arquivos Principais Afetados | Detalhes & Decisões Tomadas | Próximos Passos |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-10-24 | Versão 1.1.2 (tempo do destaque do gol) + release | Em andamento (PR de bump com Auto-fix e auto-merge; tag `v1.1.2` e publicação depois do merge, pedido explícito do usuário) | `package.json`, `package-lock.json`, `AGENTS.md` | Bump 1.1.1 → 1.1.2. Notas já em `RELEASES` (entrada `1.1.2`, do PR #14). | Conferir o draft do workflow (`latest.yml`, instalador) antes de publicar; testar a atualização 1.1.1 → 1.1.2. |
| 2026-10-24 | Tempo do auto-destaque de gol escolhido pelo usuário | Concluído (typecheck, `npm test` 323/323, `build` + `test:renderer`; controle conferido no renderer no navegador, incluindo salvar e desabilitar; sem validação ao vivo com gol real) | `src/alert-settings.ts`, `src/auto-highlight.ts`, `src/alert-ui.ts`, `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/match-events.test.ts`, `tests/auto-highlight.test.ts`, README | Pedido do usuário. Novo campo `autoHighlightSec` nas preferências de alerta (`localStorage`, como as demais), opções `AUTO_HIGHLIGHT_OPTIONS` 15/30/45/60/90/120/180 s, padrão 45; valor salvo fora da lista volta para 45. `registerGoal` ganhou `durationMs` (padrão `AUTO_HIGHLIGHT_MS`); a escolha vale para gols novos, não muda a contagem de um destaque já ativo. Select ao lado de "Destacar o jogo do gol (3+ telas) por", desabilitado quando o destaque está desligado. A borda do alerta de gol continua 45 s (`GOAL_HOLD_MS`), independente. Nota em nova entrada `1.1.2` de `RELEASES` (versão do `package.json` ainda 1.1.1). Testes unitários por subagente Haiku. | Bump para 1.1.2 no próximo release; avaliar se a borda do gol deve seguir o mesmo tempo. |
| 2026-10-24 | Versão 1.1.1 + histórico de versões na janela de Novidades | Concluído (typecheck, `npm test`, `test:renderer`, captura da janela; release publicado depois do merge, ver linha seguinte se houver) | `src/release-notes.ts`, `src/main.ts`, `src/style.css`, `tests/release-notes.test.ts`, `tests/renderer-smoke.cjs`, `package.json`, `package-lock.json`, README | Pedido do usuário: as notas anteriores ficam disponíveis rolando a janela. `releaseHistory(release)` devolve a versão mostrada e todas as mais antigas de `RELEASES`; a janela lista cada uma numa seção (as anteriores com título "Versão X" e linha divisória), rolando num só contêiner (`.release-notes__scroll`). Versões até 1.0.16 não têm notas em `RELEASES`, então o histórico começa na 1.1. Testes unitários por subagente Haiku. | — |
| 2026-10-24 | CI do PR #11: lixeira do painel do canto coberta pelo botão Voltar (`test:toolbar`, 18 telas em 1024 px) | Concluído localmente (typecheck, `npm test` 309/309, `test:toolbar` completo 1584 checks, `test:renderer`; CI pendente) | `src/main.ts`, `src/style.css` | Com ↻ e 🔔 os controles quebram para uma 2ª linha em painéis estreitos, e ela caía embaixo do Voltar. Causa real: `setBackVisible` achava o painel do canto com `elementsFromPoint`, que ignora painéis tocando (`.panel--loaded` tem `pointer-events: none`), então o desvio nunca valia com vídeo. Agora acha por geometria. Com o desvio ativo, mandar os controles para a direita estourava painéis estreitos; agora descem para baixo do botão (`top: 2.9rem`). | Confirmar no CI. |
| 2026-10-24 | Botão 🔔 desligar alertas por painel (logo à esquerda da lixeira) | Concluído (typecheck, `npm test` 309/309, `build` + `test:app`, `test:renderer`; sem conferência visual ao vivo) | `src/main.ts`, `src/alert-ui.ts`, `src/style.css`, `src/release-notes.ts`, `tests/app-integration.cjs` | Pedido do usuário. Campo `alertsOff` no `Panel` (só memória, entra no undo como `muted`). Desligado: `onMatchEvent` e `deliverMatchEvent` descartam o lance (sem anel, som nem auto-destaque); ao desligar limpa alertas pendentes do atraso, o alerta na tela (`clearAlert` agora exportado) e solta o auto-destaque. Só aparece em painel com URL; o ⏱ do 365Scores passa a ser inserido antes do sino, então a ordem é ✎ ↻ ⏱ 🔔 🗑. Ícone SVG inline (sino, cortado quando desligado, em vermelho). `test:app` checa a ordem e o liga/desliga. Nota na entrada `1.1.1`. | Validar ao vivo que um painel desligado não toca nem destaca. |
| 2026-10-24 | Rótulo do jogo: legenda na base do vídeo também quando só há barras laterais | Concluído (typecheck, `match-label` 23/23, `test:renderer`, `test:toolbar` completo; `npm test` 223/224 com falha só em `youtube-lives.test.ts` por edição paralela fora do escopo em `src/youtube-lives.ts`; sem conferência visual ao vivo) | `src/match-label.ts`, `src/main.ts`, `src/style.css`, `tests/match-label.test.ts`, `tests/toolbar-smoke.cjs`, `src/release-notes.ts`, README | Pedido do usuário (opção C de 3 propostas): o modo `bar-side` (nomes empilhados com × e "x" no meio da barra preta) ficava estranho num jogo em destaque. Modo removido: sem barra em cima/embaixo, vai para `overlay-bottom`. Teto da fonte da legenda 26 → 36 px (`MAX_OVERLAY_FONT_PX`; segue 6% da altura do painel) para o destaque ler de longe. Testes unitários por subagente Haiku. | Validar ao vivo com um jogo em destaque. |
| 2026-10-24 | Lote do YouTube por lista de canais oficiais (sem busca aberta) | Concluído (typecheck, `npm test`, `build` + `test:app`, `test:renderer`, `test:close`; conferido contra a API real; sem conferência visual do editor de canais) | `src/youtube-lives.ts`, `electron/youtube-search.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/youtube-lives.test.ts`, `tests/app-integration.cjs`, README | Relato do usuário: muito ruído de canais não oficiais e as lives da CazéTV (LaLiga com 134 mil pessoas, Ligue 1) não apareciam. Conferido: o filtro aceitava os títulos, mas `search.list` (por `q` e até sem `q` com `order=viewCount`) não devolvia essas lives. Opção escolhida pelo usuário: lista de canais. Para cada canal, `playlistItems.list` da playlist de uploads (`UC…` → `UU…`, 50 vídeos, 1 unidade; 404 = canal sem uploads, ignorado) e `videos.list` em lotes de 50 (`snippet,liveStreamingDetails`, 1 unidade) mantendo `live` com `actualStartTime` e sem `actualEndTime`; filtro de título mantido; ordenado por espectadores. 10 canais padrão (ids resolvidos por `forHandle`) = 20 unidades por busca (antes 100). Busca real em 24/10: 9 jogos aceitos nos 10 canais (só o vôlei cortado). Lista de canais em `localStorage` (`quadra:youtube-channels`, como as preferências de alerta; até 50); editor "Canais…" no diálogo (adicionar por @/link via novo canal `quadra:resolve-youtube-channel`, `channels.list`, 1 unidade; remover; restaurar padrão). Os ids vão do renderer ao main e são validados lá. `parseYoutubeSearch` removido. Testes unitários por subagente Haiku. | Validar ao vivo no app; o usuário completar a lista de canais. Futsal (CONMEBOL) passa no filtro. |
| 2026-10-24 | Botão ↻ recarregar painel (entre ✎ e lixeira) | Concluído (typecheck, `npm test` 261/261, `build` + `test:app`, `test:renderer`; sem conferência visual ao vivo) | `src/main.ts`, `src/style.css`, `src/release-notes.ts`, `tests/app-integration.cjs` | Pedido do usuário: mesmo efeito de "Abrir" com a URL já preenchida. Só aparece em painel com URL; chama `applyPanelUrl(id, panel.url)` (usa a URL aberta, não o rascunho do campo) → `forceReload` recarrega a view existente, sem recriar. Botão redondo (`.panel__reload`). O "⏱" do 365Scores continua sendo inserido antes da lixeira, então fica entre ↻ e 🗑. Nota em nova entrada `1.1.1` de `RELEASES` (versão do `package.json` ainda 1.1.0). `test:app` checa a ordem dos botões e que só o player do painel recarrega. | Bump para 1.1.1 no próximo release. |
| 2026-10-24 | 365Scores: consulta travada não atrasa mais os dados | Concluído (typecheck, `npm test` 279/279, `test:app` com a 1ª consulta do detalhe travada de propósito, `test:close`; sem validação ao vivo) | `src/livescore-365.ts`, `electron/livescore-365.ts`, `tests/livescore-365.test.ts`, `tests/app-integration.cjs`, README | Relato do usuário: "365Scores falhou (timeout); tentando em 6 s / 12 s" num jogo enquanto outro jogo 365 e os 10 WH seguiam normais; a API respondia em ~0,1 s logo depois (oscilação pontual do 365Scores). O problema era a reação: 8 s de espera + pausa de 6, 12… até 60 s (um gol podia atrasar ~40 s), e nenhum aviso de volta. Agora `detailTimeoutMs` (4 s; 10 s a partir da 2ª falha seguida, caso a API esteja só lenta) e `retryDelayMs`: travada/queda (`stall`) tenta de novo na hora 3 vezes, depois 3/6/12 s, teto 15 s; erro HTTP (`HttpError`) 6 s dobrando até 60 s. Narração e contagem de vermelhos também param em 4 s, porque rodam na mesma rodada e seguravam o próximo placar. Monitor: "tentando de novo agora" e "365Scores voltou a responder após N falha(s) (X s sem dados)". O `test:app` trava a 1ª consulta do detalhe e exige o placar em até 9 s (antes levaria ~14 s). Testes unitários por subagente Haiku. | Validar ao vivo; se o 365Scores começar a responder 429, rever o ritmo das novas tentativas. |
| 2026-10-24 | Monitor de lances mostra a fonte de cada linha | Concluído (typecheck, `npm test`, `test:app`; selo não conferido visualmente) | `electron/scanner-log.ts`, `electron/monitor-html.ts`, `electron/monitor-preload.ts`, `electron/scoreboard-scanner.ts`, `electron/livescore-365.ts`, `electron/main.ts`, README | Pedido do usuário: cada mensagem do Monitor indica o provedor. `logScanner(text, source?)` com `source` `'wh'` / `'365'`; a linha leva `source` ao Monitor (selo azul "William Hill" / laranja "365Scores API") e o arquivo de log recebe o prefixo `[William Hill]` / `[365Scores API]`. Linhas sem fonte (player que não iniciou) ficam sem selo. O antigo sufixo `[365]` / `[365 narração]` dos lances virou só "· narração" quando o lance vem da narração. | — |
| 2026-10-24 | 365Scores: jogos não encontrados e precisão dos lances | Concluído (typecheck, `npm test` 275/275, `test:app`, `test:close`; replay com detalhes reais; os 11 títulos que falharam no log do usuário agora ligam; sem validação ao vivo no app) | `src/livescore-365.ts`, `electron/livescore-365.ts`, `tests/livescore-365.test.ts`, `src/release-notes.ts`, README | Relato do usuário: o Monitor dizia "nenhum jogo" para jogos que existem no 365Scores. Causa: a agenda do dia (`allscores`) tinha 838 jogos e `parseGameList` cortava em 400 (`MAX_GAMES`); Krasnodar, Willem II, Las Palmas, Mirassol e Internacional estavam nas posições 558–688. `MAX_GAMES` → 4000; até 4 h (Brasil) a agenda inclui ontem; log quando a agenda falha. Apelidos de cidade (Praga/Prague → Praha, Moscou → Moscow, Bucareste → București). Precisão, conferida em 77 jogos reais: (1) jogo de liga coberta ainda sem lances vem sem `events` e era tratado como "só placar", e o gol alertava pelo placar e de novo pelo evento; (2) eventos às vezes atrasam ou faltam (placar 1x2, eventos 1x1) e o gol nunca alertava; (3) o detalhe não traz `redCards` (só as listas), então vermelho em liga sem lances nunca alertava. Agora `diffDetail(state, detail, now)` conta gols/vermelhos já alertados por time (`alertedGoals`/`alertedReds`): o placar é a verdade, um gol sem evento em 9 s (`GOAL_EVENT_GRACE_MS`; na hora se não há lista de eventos) alerta pelo placar, e o evento que chega depois para um gol já alertado fica quieto (contagem por time na ordem cronológica; `parseGameDetail` ordena por `order`). Vermelhos sem eventos vêm de `/web/games/?games=<id>` (`parseRedCards`). Gol contra conferido: `competitorId` é o time que ganhou o gol. Testes unitários por subagente Haiku. | Validar ao vivo (gol com placar antes do evento, vermelho em liga sem lances); ver se 9 s de carência está bom. |
| 2026-10-24 | Fallback 365Scores para jogos BLL sem feed William Hill | Concluído (typecheck, `npm test` 266/266, `test:app` com fixture BLL sem `williamHillId` + API 365Scores falsa, `test:renderer`, `test:close`; sem validação ao vivo) | `electron/main.ts`, `electron/livescore-365.ts`, `src/livescore-365.ts`, `src/main.ts`, `src/release-notes.ts`, `tests/livescore-365.test.ts`, `tests/app-integration.cjs`, `tests/sports-player-fixture.cjs`, README | Pedido do usuário: jogo BLL sem feed WH busca o jogo no 365Scores como o YouTube. `startMatchDetection`: se o `ViewEvento` vem com `williamHillId` nulo, chama `liveScores.consider` na hora com `evento.nome`; se o player não informa nada em 60 s, usa o título da página. A detecção continua; se o id WH aparecer depois, o 365Scores é desfeito e o scanner WH assume. A chave do vínculo virou `sourceKeyOf` (id do vídeo YouTube ou origem+caminho do player, sem query). Navegação in-page de player BLL não desfaz mais o vínculo. Painéis BLL ligados ao 365Scores seguem as regras do YouTube (pergunta "Qual jogo é este?", botão ⏱, alertas com o atraso do painel); BLL com WH continua imediata. `test:app` agora aponta `QUADRA_365SCORES_URL` para o servidor local (sem rede real). Testes unitários por subagente Haiku. | Validar ao vivo com um jogo BLL sem WH; ver se os nomes da BLL (às vezes em espanhol/inglês) casam bem com o 365Scores. |
| 2026-10-23 | CI: `test:packaged` esperava 15 telas após remover 1 de 18 | Concluído localmente (`build` + `dist:drm-poc` + `test:packaged`; CI pendente) | `tests/packaged-smoke.cjs` | Teste velho desde as opções de 17/18 telas (20/10): a grade passou de 16 para 18, mas o esperado após remover uma tela ficou 15. O app está certo (17). Só o teste mudou. | Confirmar no CI. |
| 2026-10-23 | CI: `test:toolbar` falhava nos rótulos (16x9 nunca virava `overlay-bottom`) | Concluído localmente (`test:toolbar` completo; CI pendente) | `tests/toolbar-smoke.cjs` | A tela do runner `windows-latest` é 1024×768: maximizada, a grade 4×4 dá painéis ~4:3, o vídeo 16:9 ganha barras e o rótulo vai para `bar-bottom`. O modo esperado só valia em telas 16:9. O cenário de rótulos agora usa janela fixa 1024×576 (Windows arredonda alguns px; tolerância de 8) e 4 telas (2×2), único tamanho que cabe no runner e ainda dá barra lateral ≥ 48 px no 4:3. Em timeout, o erro lista os modos encontrados. Sem mudança no app. | Confirmar no CI. |
| 2026-10-23 | Release v1.1.0 publicado no GitHub Releases | Concluído (workflow `windows-release.yml` com sucesso; `latest.yml` conferido; sem teste de atualização real 1.0.16 → 1.1.0) | `AGENTS.md` | Pedido explícito do usuário para publicar, com os comandos num terminal visível. PR #9 com merge (`0fb1dfe`), checks verdes. Tag anotada `v1.1.0` no merge → draft com `Quadra-Setup-1.1.0.exe` (112.184.970 bytes), `.blockmap`, `latest.yml` (version 1.1.0, mesmo tamanho) e `release-verification.json`. Publicado como Latest com `gh release edit v1.1.0 --draft=false --latest`; v1.0.16 deixou de ser Latest. Descrição do release é a gerada pelo GitHub (link do PR #9); as novidades para o usuário ficam no pop-up do app. | Testar a atualização num PC com 1.0.16 (download, instalação, pop-up de novidades); conferir Disney+ se relevante. |
| 2026-10-23 | Notas de atualização ("Novidades da versão 1.1") + versão 1.1.0 | Concluído (typecheck, `npm test` 261/261, `test:renderer`, `test:app`, `test:close`; sem validação no instalador real) | `src/release-notes.ts`, `src/main.ts`, `src/style.css`, `electron/main.ts`, `tests/release-notes.test.ts`, `tests/renderer-smoke.cjs`, `package.json`, `package-lock.json`, README | Pedido do usuário: ao abrir pela primeira vez depois de atualizar, um pop-up lista e descreve as novidades. Notas em `RELEASES` (`src/release-notes.ts`), uma entrada por versão; mostra a da versão instalada se ela não for a última vista (`quadra:last-seen-version` no `localStorage`, como as preferências de alerta). Sem chave salva (primeira instalação ou vindo da 1.0.16) também mostra. Botão **Novidades** na tela inicial reabre. Sem mudança no preload: o main abre o overlay com `?release-notes=off` quando `QUADRA_TEST_USER_DATA` está setado, para os smokes não ficarem atrás do pop-up; `?release-notes=on` força o pop-up sem bridge (usado no `test:renderer`). Versão 1.0.16 → 1.1.0 (semver de 3 partes exigido pelo electron-updater; o pop-up mostra "1.1"). Testes unitários por subagente Haiku. | A cada release, adicionar a entrada da nova versão em `RELEASES` (o teste quebra sem ela). Validar no instalador 1.0.16 → 1.1.0. |
| 2026-10-23 | Alertas BLL/William Hill paravam no 2º tempo | Concluído (typecheck, `npm test` 252/252; hook novo conferido contra o feed WH real do Hobro x Vendsyssel; sem validação no app depois de reiniciar) | `electron/scoreboard-scanner.ts`, `src/match-events.ts` | Relato do usuário: 18 jogos BLL abertos e nenhum alerta. O log mostrava os scanners conectados e nenhum lance depois das 14:26. Causa: a cada atualização o feed WH reenvia a lista inteira do jogo em ordem cronológica (≈ 490 itens no 2º tempo, com ataques, laterais etc.), e o hook só guardava os primeiros 400 por chamada. Quando o jogo passa de ~400 itens, os mais novos (gols e cartões incluídos) eram sempre cortados. Agora o hook só enfileira os tipos que alertam (`ALERT_INCIDENT_TYPES`), uma vez por id (`__quadraSeen`). Como a fila agora só tem lances que alertam, o vigia "sem lances há 10 min" passou a contar qualquer atualização do feed (`__quadraUpdates`) como sinal de vida, para não recarregar à toa. | Reiniciar o `npm run dev` e validar ao vivo; avaliar um teste do hook com um feed falso de 500+ itens. |
| 2026-10-23 | 365Scores: pênalti marcado e decisões do VAR pela narração + gol duplicado | Concluído (typecheck, `npm test` 252/252, `test:app`, `test:renderer`; replay com dados reais do jogo; sem validação ao vivo após a correção) | `src/livescore-365.ts`, `electron/livescore-365.ts`, `src/main.ts`, `src/alert-ui.ts`, `tests/livescore-365.test.ts`, README | Relato do usuário no teste ao vivo de 23/10 (Al-Ittihad x Diriyah): pênalti e VAR não alertaram, só o gol, e o gol alertou duas vezes (primeiro "(pênalti)", depois sem). Causa 1: a API de detalhe do 365Scores não tem evento de "pênalti marcado" nem de revisão do VAR, só resultados (gol, "gol anulado"). Correção: ler também a narração ao vivo do jogo (`game.playByPlay.feedURL`, host `pbpgenerator.365scores.com`, https forçado), a cada 5 s (`PBP_POLL_MS`; cache da fonte 15 s), só em jogos que a têm. Alertas dela: Type 28 "pênalti marcado" → Pênalti; Type 8 "Decisão do VAR: …" → VAR com a decisão (gol anulado / gol confirmado / pênalti / pênalti cancelado / cartão vermelho / revisão); Type 48 → VAR gol anulado. Gols e cartões seguem vindo dos eventos (mais rápidos). No replay o pênalti veio cerca de 1 min antes do gol. Causa 2: o 365Scores reclassificou o gol dos 77' de gol de pênalti para gol normal após um minuto e a chave do evento incluía o subtipo; agora a chave é só ordem + tipo. Uma revisão do VAR aparece em até 3 relatos; só o primeiro para o mesmo time em 3 minutos alerta (`dropRepeatedVar`). O auto-destaque de gol só é solto por VAR "gol anulado", não por VAR que confirma o gol. O rótulo do tipo em "Alertar em" agora é só "VAR". Nesse jogo o 365Scores não registrou checagem do VAR perto do pênalti dos 75', então ali o VAR não tinha como alertar. | Validar ao vivo; ver se ligas sem narração precisam de outra fonte para pênalti. |
| 2026-10-23 | Auto-destaque de gol com painel companheiro quando 2 destaques ficam maiores que 1 | Concluído (typecheck, `npm test` 235/235, `test:renderer`; sem validação ao vivo) | `src/auto-highlight.ts`, `src/main.ts`, `tests/auto-highlight.test.ts`, README | Pedido do usuário: com 12 telas, 1 destaque mal cresce (vídeo ≈ 8% da tela) e 2 destaques ficam com ≈ 28% cada. `companionHelps(n)` compara a área do vídeo 16:9 do destaque com 1 e 2 destaques (cache por contagem); ganho ≥ 1,25 (`COMPANION_MIN_GAIN`) → vale para 6–12 e 14–18; não para 3–5 nem 13. Em `composeHighlighted`, um gol sozinho (sem outro gol nem destaque do usuário) leva o primeiro outro painel da grade como companheiro; ele é calculado na hora, não é `AutoEntry` (não mostra contagem/Fixar/Voltar) e sai junto com o gol. Testes unitários por subagente Haiku. | Validar ao vivo com 12 telas; avaliar se o companheiro deveria ser outro painel (ex.: um com alerta recente). |
| 2026-10-23 | Lote BLL: players que ficavam pretos ao abrir muitos jogos de uma vez | Parcial (typecheck, `npm test` 225/225, `test:app`, `test:close`, `test:renderer`; causa não confirmada ao vivo) | `electron/player-start.ts`, `electron/main.ts`, `tests/player-start.test.ts`, `package.json` | Relato do usuário: com 16 jogos cerca de metade ficava preta, e reabrir um por um resolvia. Hipótese: todos os players BLL (OpenVidu) negociando o stream no mesmo instante. Agora os carregamentos de player de catálogo esportivo são espaçados em 0,2 s (`createLoadPacer`; começou em 1,2 s, reduzido a pedido do usuário), e um vigia checa a cada 3 s se algum `<video>` está tocando; sem vídeo 25 s após o load, recarrega (no máximo 2 vezes por URL, contador zera ao reabrir), com log no Monitor de lances. O log "sem feed de lances" agora traz título/URL do painel (ids `panel-N` são um contador, não a posição). Teste unitário por subagente Haiku. | Validar ao vivo com 16 jogos; ajustar espaçamento/timeout se ainda houver painéis pretos ou se jogos sem stream recarregarem à toa. |
| 2026-10-23 | Auto-destaque de gol a partir de 3 telas (antes 5) | Concluído (typecheck, `npm test` 218/218; sem validação visual) | `src/auto-highlight.ts`, `src/alert-settings.ts`, `src/alert-ui.ts`, `tests/auto-highlight.test.ts`, README | Pedido do usuário: alertas normais com 3+ telas; só 1–2 telas ficam restritas. `AUTO_MIN_PANELS` 5→3 (capacidade de destaque com 3 e 4 telas é 1, com 5+ é 2). | Validar ao vivo com 3 e 4 telas. |
| 2026-10-23 | Rótulo do jogo como legenda com degradê na base do vídeo (substitui o selo no canto) | Concluído (typecheck, `npm test` 217/217, `test:renderer`; `test:toolbar` não rodado; sem validação visual ao vivo) | `src/match-label.ts`, `src/style.css`, `tests/match-label.test.ts`, `tests/toolbar-smoke.cjs`, README | Pedido do usuário: com 13 telas o vídeo ocupa 100% e o selo no canto superior direito ficava pequeno e quase invisível. Modo `corner` virou `overlay-bottom`: legenda na largura toda do vídeo, colada embaixo, fundo em degradê (0,78 → 0 de opacidade), fonte até 26 px (6% da altura do painel; duas linhas se não couber). Barras pretas (bottom/top/side) seguem com prioridade. Sem esmaecer. O × continua. Pode cobrir a barra de controles do player embaixo do vídeo. | Validar ao vivo com 13+ telas; ajustar opacidade/tamanho se necessário. |
| 2026-10-23 | Atraso da 365Scores movido para os botões do canto superior esquerdo | Concluído (typecheck, `npm test` 217/217, `test:renderer`; sem validação visual ao vivo) | `src/main.ts`, `src/style.css`, README | Pedido do usuário: o chip no canto inferior esquerdo cobria os controles do player do YouTube. Agora é o botão "⏱ N s" entre os botões do canto superior esquerdo (Mutar, ★, ✎, antes da lixeira), visível no hover; um select nativo invisível sobre o botão abre a lista (Padrão / na hora / 10…120 s). A dica mostra o jogo vinculado e "só placar" quando a liga não tem lances; o prompt "Qual jogo é este?" segue no topo central. Descartado o meio da barra do YouTube (some em painéis pequenos, varia com "AO VIVO"/capítulo, encosta na barra de progresso, e o usuário está mexendo no player para tela cheia). | Validar visualmente com um jogo vinculado. |
| 2026-10-23 | Fonte 365Scores para lives do YouTube (matching + lances + atraso de alertas) | Parcial (typecheck, `npm test` 217/217, `test:renderer`, `test:app`; matching conferido contra a API real; sem validação ao vivo no app). Nomes só com palavras genéricas (Atlético, Real, Inter…) nunca ligam sozinhos: viram pergunta | `src/livescore-365.ts`, `electron/livescore-365.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/main.ts`, `src/style.css`, `src/match-events.ts`, `src/alert-settings.ts`, `src/alert-ui.ts`, `tests/livescore-365.test.ts`, `package.json`, README | Painéis YouTube (watch/live) com "A x B" no título são ligados a um jogo do 365Scores (API web não documentada `webws.365scores.com`, sem login/cookies, só `net.fetch` no main). Matching por nomes (acentos, FC/EC, apelidos Galo/Verdão, sufixos MG/PR, marcadores sub/feminino/reservas) sobre jogos ao vivo + agenda do dia (cache 30 s). Claro → vinculado; ambíguo → o painel pergunta "Qual jogo é este?" (até 3 + "Nenhum"); nenhum → retenta a cada 2 min, até 5 vezes. Detalhe a cada 3 s (CDN da API cacheia 3 s), backoff até 60 s em erro, para quando o jogo acaba. Ligas com lances: gols (pênalti/contra), cartões (2º amarelo), pênalti perdido, VAR "gol anulado" (tipo 11 sub 25). Ligas "só placar": gols pela mudança de placar, vermelhos pela contagem, placar que diminui vira VAR. Novo tipo de alerta VAR (padrão ligado) em "Alertar em"; um VAR solta o destaque automático de gol do painel. Proteção contra spoiler: em painéis YouTube vinculados o atraso do placar vale também para alertas e auto-destaque; seletor "Atraso" por painel (padrão / na hora / 10…120 s), só em memória; BLL/William Hill seguem imediatos. Novos canais IPC `quadra:live-match` (main → UI) e `quadra:choose-live-match` (UI → main, `isUiSender`); nova env `QUADRA_365SCORES_URL`. Reconhecimento da API por subagente Sonnet; testes unitários por subagente Haiku (preferência do usuário: Sonnet para trabalho de baixo raciocínio, Haiku para trabalho mecânico). Limites: API não oficial pode mudar/bloquear sem aviso; VAR só como "gol anulado"; tabela de tipos de lance de 40 jogos encerrados em 22/10/2026. | Validar ao vivo com um jogo brasileiro e um europeu; ajustar falsos positivos do matching; avaliar smoke no `test:app` com fixture 365Scores via `QUADRA_365SCORES_URL` + `QUADRA_YOUTUBE_WATCH_ORIGIN`. |
| 2026-10-23 | YouTube só com o vídeo: pseudo-tela cheia, sem chat, anúncios pulados/bloqueados | Concluído (typecheck, `npm test`, `test:app`, `test:renderer`, `test:close`; sem validação ao vivo no YouTube real) | `electron/youtube-player.ts`, `electron/main.ts`, `tests/youtube-player.test.ts`, `tests/fixtures/youtube-watch.html`, `tests/app-integration.cjs`, `package.json`, README | Em `configureRemoteContents`, `did-finish-load` e `did-navigate-in-page` (SPA) aplicam CSS do player (remove ao sair de `/watch`) e script de anúncios em mundo isolado `YOUTUBE_WORLD` 1003 (idempotente), depois `measureSlotVideoRect`. `onBeforeRequest` na sessão `persist:quadra` cancela domínios de anúncio (não havia outro handler). Override `QUADRA_YOUTUBE_WATCH_ORIGIN` só para o fixture. Sem mudança em preload/routing. Testes unitários por subagente Haiku. Correção após teste ao vivo (player preto): o CSS não pode dimensionar o `<video>` — `.html5-video-container` tem altura 0 e `height: 100%` zerava o vídeo; o próprio player ajusta o tamanho inline após o `resize`. Fixture imita essa estrutura e o `test:app` checa `videoVisible`. | Validar ao vivo (watch, youtu.be, /live/, pré-roll, troca de vídeo na SPA); ajustar seletores se o YouTube mudar. |
| 2026-10-23 | Lote de lives de futebol do YouTube (branch `feat/youtube-lives-batch`) | Concluído (typecheck, `npm test`, `test:app`, `test:renderer`, `test:close`; sem validação ao vivo, falta a chave do usuário) | `src/youtube-lives.ts`, `electron/youtube-search.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/bll-batch.ts`, `src/main.ts`, `src/style.css`, `tests/youtube-lives.test.ts`, `tests/app-integration.cjs`, `.gitignore`, `.env.example`, README | Pedido do usuário: YouTube Data API v3 com chave própria em `.env` (não digitada no app). `search.list` com `eventType=live`, `videoCategoryId=17`, `regionCode=BR`, `q="futebol ao vivo|NFL ao vivo|NBA ao vivo"` (uma chamada) via `net.fetch` só no main; chave nunca vai ao renderer nem a logs; cache 60 s (100 unidades/busca). Filtro (`isLiveGameTitle`): título com confronto, sem palavras de não-jogo (react, narração, pré/pós-jogo, resenha, assistir juntos, 24h, videogame, high school/college) e sem temporada antiga (`2006/07` < ano−1); outros esportes cortados, exceto NFL/NBA (pedido do usuário). Busca real em 23/10: 47 lives → 4 aceitas (antes 41, quase todas futebol americano escolar). Botão travado em "Buscando…" era main do `npm run dev` anterior à mudança; agora a UI mostra erro se o IPC falhar. Grupo = campeonato detectado ou canal. Diálogo do lote BLL generalizado (`openBatch('bll' | 'youtube')`); o lote YouTube não mexe no alvo do catálogo BLL. Erros de chave/cota/API desativada explicados na UI. Testes unitários por subagente Haiku. | Validar ao vivo com a chave; avaliar falsos positivos/negativos do filtro e se vale uma segunda busca (ex.: lista de canais) dado o custo de cota. |
| 2026-10-22 | Botão Voltar movido para o canto superior esquerdo | Concluído (typecheck, `npm test`, `test:renderer`, `test:app`; sem validação ao vivo nem `test:toolbar`) | `src/main.ts`, `src/style.css` | Saiu da toolbar; `#btn-layout` agora é `.back-corner`, fixo em cima à esquerda. Só aparece com o mouse se mexendo na zona 170×90 px e some 2 s após o último movimento ali (`BACK_IDLE_MS`, independente dos 5 s da toolbar); fica enquanto hover/foco ou diálogo aberto. O painel do canto superior esquerdo desloca seus controles (`.has-back-button`) enquanto o botão aparece, para nada ficar coberto. | Validar ao vivo. |
| 2026-10-22 | Lote BLL sem abrir o site: menu do app direto + atualização automática | Concluído (typecheck, `npm test`, `test:app`, `test:close`, `test:renderer`; sem validação ao vivo porque o usuário estava com `npm run dev` próprio aberto) | `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `src/bll-batch.ts`, `src/main.ts`, `tests/app-integration.cjs`, README | Pedido do usuário: login BLL não expira, então o botão abre só o menu do Quadra. Lista lida numa `BrowserWindow` oculta (`show: false`, sessão `persist:quadra`, sandbox, áudio mudo, popups negados, só HTTP(S)) que recarrega a home a cada pedido e espera até 15 s por linhas (o componente monta antes dos jogos chegarem); fecha após 90 s ocioso e no fechamento do app; pedidos simultâneos compartilham a mesma leitura. `quadra:list-bllsport-events` sem argumentos; `BllEventsResult` = `ok` / `unavailable`. Revertida a mudança de `openSportsCatalog` com `id` null (não é mais usada). | Validar ao vivo após reiniciar o `npm run dev`. |
| 2026-10-22 | Lote BLL também na tela inicial (N jogos → N telas) | Concluído (typecheck, `npm test`, `test:app` com catálogo fechado e reaberto, `test:renderer`, `test:close`; sem validação ao vivo porque o usuário já estava com `npm run dev` próprio aberto) | `src/main.ts`, `src/style.css`, `electron/main.ts`, `tests/app-integration.cjs`, README | Botão **Abrir vários jogos da BLL** no `.chooser__start`. Na tela inicial o lote substitui a grade: uma tela por jogo marcado (máx. 18), modo auto, sem destaques, sem `pushHistory` (como `selectCount`). `openSportsCatalog` aceita `id` null para abrir o catálogo sem painel-alvo; `quadra:list-bllsport-events` com `null` usa isso. Item do menu ⋯ continua para completar uma grade já aberta. | Reiniciar o `npm run dev` para carregar a mudança do main e validar ao vivo. |
| 2026-10-22 | Abrir vários jogos da BLL de uma vez (por competição) | Concluído (typecheck, `npm test`, `test:app`, `test:renderer`, `test:close`; validado ao vivo com BLL logado abrindo os 2 jogos de "Copa Libertadores Femenina, Group D") | `src/bll-batch.ts`, `src/main.ts`, `src/style.css`, `src/match-label.ts`, `src/electron.d.ts`, `electron/main.ts`, `electron/preload.ts`, `tests/bll-batch.test.ts`, `tests/app-integration.cjs`, `package.json`, README | Lista lida do Vue `ListEventosHome2` da home BLL via `executeJavaScript` (só leitura; exporta só id/nome/competição/hora/situação). Novo canal `quadra:list-bllsport-events` (invoke, só `isUiSender`); URL montada no main com `normalizeSportsPlayerUrl` (`/view/<id>?view=clean`). Só `situacao === 3` (ao vivo) entra, como no `abrirEvento` da BLL para contas comuns. Lote preenche vazios e cria telas até 18, pula URLs já abertas, um `pushHistory` (Desfazer funciona), não recria views existentes. Item no menu ⋯. `stripSoundMarkers` exportado de `match-label`. Não toca nem testa UEFA Conference/Europa League (pedido do usuário: outras pessoas usando). Testes unitários por subagente Haiku. | Se a BLL mudar o nome do componente, a lista some (status "lista ainda não apareceu"). Avaliar limite de streams simultâneos por conta com 10+ jogos. |
| 2026-10-22 | Rótulo dos jogos em níveis com nome inteiro + placar William Hill com atraso | Concluído (typecheck, `npm test`, `test:renderer`, `test:app`, `test:toolbar`; sem validação ao vivo com feed real) | `src/match-label.ts`, `src/score-delay.ts`, `src/alert-settings.ts`, `src/alert-ui.ts`, `src/main.ts`, `src/style.css`, `electron/scoreboard-scanner.ts`, `electron/main.ts`, `electron/preload.ts`, `src/electron.d.ts`, `tests/match-label.test.ts`, `tests/score-delay.test.ts`, `tests/alert-settings.test.ts`, `tests/toolbar-smoke.cjs`, README | Pedido do usuário: **sempre nome inteiro, nunca sigla**. Ordem: barra de baixo/cima (fonte cabe na barra até 10 px; senão duas linhas, uma por time) → barra lateral (empilhado, quebra por palavra) → selo `corner` no canto superior direito do vídeo (substitui `overlay-bottom`; esmaece após 8 s). Scanner emite `quadra:match-score` quando placar/nomes mudam e ao vincular painel; `orientScore` inverte se o título lista os times ao contrário do feed. Atraso do placar (`scoreDelaySec`: Não mostrar / 0 / 10 / 20 / 30 / 45 / 60 s, padrão 0) em `localStorage`; primeiro placar do painel aparece na hora; alertas não são atrasados. Testes unitários escritos por subagente Haiku (preferência do usuário). | Validar ao vivo (BLL logado) leitura do placar, orientação e atraso; minuto do jogo não exibido (feed só traz minuto nos lances — inspecionar DOM do scoreboard ao vivo). |
| 2026-10-22 | Alertas de lances (gol/pênalti/vermelho/amarelo) + Monitor (passo 1) e auto-destaque de gol 45 s com 5+ telas (passo 2) | Concluído (passo 1 validado ao vivo pelo usuário; passo 2 só com testes unitários e typecheck, sem validação visual) | `src/auto-highlight.ts`, `src/match-events.ts`, `src/alert-sounds.ts`, `src/alert-settings.ts`, `src/alert-ui.ts`, `electron/scoreboard-scanner.ts`, `electron/scanner-log.ts`, `electron/monitor-html.ts`, `electron/monitor-preload.ts`, `electron/main.ts`, `electron/preload.ts`, `src/main.ts`, `src/style.css`, `tests/match-events.test.ts` | Engine lê o feed William Hill (`score.kwddw.com/scoreboards`, topic `OB_EV<id>/incidents`) numa `BrowserWindow` oculta por jogo, partição em memória sem cookies BLL; o painel segue `view=clean`. `williamHillId` vem do Vue `ViewEvento` do player. Histórico reenviado na conexão é ignorado; watchdog recarrega com backoff. Feed **não tem VAR** (fora do escopo). 30 sons Web Audio; clicar no som já seleciona e toca. Preferências (som/tipos) em `localStorage` — exceção deliberada à regra de persistência; URLs/layout seguem só em memória. Logs na janela "Monitor de lances" + `userData/logs`. Passo 2: gol vira destaque 45 s (≥5 telas), novo gol acima da capacidade expulsa o auto mais antigo, ação manual cancela o modo (`pushHistory`), botões Fixar/Voltar por painel. | Smoke Electron com fixture do scoreboard; validar auto-destaque ao vivo. |
| 2026-10-20 | Bump Quadra para 1.0.16 + tag de release | Concluído | `package.json`, `package-lock.json`, `AGENTS.md` | Versão alinhada a tag `v1.0.16` para disparar `windows-release.yml` (draft no GitHub). | Validar draft release, hashes e smoke Disney+ se relevante; publicar `latest` só após validação manual. |
| 2026-10-20 | Rótulo: sem emoji de som + dismiss por painel | Concluído | `src/match-label.ts`, `src/main.ts`, `src/style.css`, `tests/match-label.test.ts`, `tests/app-integration.cjs`, README | Strip 🔊/🔈/🔉/🔇/📢/📣; × no rótulo (`dismissedMatchLabels`); restaura ao Abrir/reload da URL (não só troca de URL). `syncLayout()` antes de abrir BLL/WeddBets evita race com `visiblePanelIds`. | — |
| 2026-10-20 | Nomes dos jogos nos painéis (rótulo A x B) | Concluído | `src/match-label.ts`, `electron/main.ts`, `electron/preload.ts`, `src/main.ts`, `src/style.css`, `src/electron.d.ts`, fixtures/smokes, README | Título do player via `page-title-updated` (BLL já põe `evento.nome`); posicionamento `bar-*` nas barras pretas ou `overlay-bottom` se o vídeo preenche; toggle no menu ⋯; sem reload de views. | Validar manualmente com BLL logado em `npm run dev`. |
| 2026-10-20 | Barra URL/botões dos painéis sempre cabendo | Concluído | `src/style.css`, `tests/renderer-smoke.cjs` | Escala fluida via `cqw` + `flex-wrap`; em painéis ≤420px o input ocupa a linha e os botões quebram; smoke valida `barsFit` em 1–18. | — |
| 2026-10-20 | Opções de 17 e 18 telas + estudo de layout | Concluído | `src/layout.ts`, `src/organizer.ts`, `src/main.ts`, `electron/main.ts`, `src/style.css`, `scripts/layout-study.ts`, `tests/fixtures/video-layout-reference.json`, testes unitários/smokes, README/ONBOARDING | Estudo reproduziu as 124 refs 1–16 e escolheu `SIDE_WEIGHTS` 17/18=6, defaults 17=0 / 18=2, catálogo `[0,1,2]`, cantos para 18 com 2 destaques (como 10). Fixture passou a 142 casos (63 ganhos). Chooser em 6 colunas. | Rodar `test:toolbar` completo em CI/local longo; validar capturas `organizer-18-two` / `playing-18`. |
| 2026-10-20 | Criação do `AGENTS.md` como SSoT para agentes | Concluído | `AGENTS.md` | Inventário baseado em `package.json` v1.0.15, README/ONBOARDING, workflows Windows, árvore `electron/` + `src/` + `tests/`. Sem ESLint/Prettier; qualidade via `tsc` + testes Node/Electron. Runtime pinado em Castlabs ECS `v44.1.0+wvcus`. Documentados IPC, env vars, guardrails DRM/EVS e limitações já conhecidas. | Manter esta tabela atualizada a cada tarefa; em mudanças de stack/scripts, sincronizar seções 2–3 com `package.json` e workflows. |

---

## Referência rápida de entrada (para humanos e agentes)

1. `AGENTS.md` (este arquivo) → protocolo e estado.
2. `README.md` → comportamento do produto e release.
3. `electron/main.ts` + `src/main.ts` → integração e UI.
4. `src/layout.ts` + `src/video-layout.ts` → contrato geométrico.
5. `tests/app-integration.cjs` / `tests/toolbar-smoke.cjs` → regressão de produto.
