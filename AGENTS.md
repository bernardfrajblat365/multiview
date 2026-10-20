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

Fonte de verdade das versões de pacote: `package.json` / `package-lock.json`. Versão do produto atual: **1.0.16**.

### Variáveis de ambiente relevantes

| Variável | Uso |
| --- | --- |
| `QUADRA_BLLSPORT_URL` | Override da home do catálogo BLL (testes/fixtures) |
| `QUADRA_WEDDBETS_URL` | Override WeddBets (legado no código) |
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

Estilo observado no histórico: Conventional Commits em inglês — `feat:`, `fix:`, `chore:`, `docs:`. Bumps de versão: `chore: bump Quadra to x.y.z`. Tags de release: `v*` alinhadas a `package.json` `version`.

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
