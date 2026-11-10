# Plano: telas-esqueleto enquanto o Modo Auto procura jogos (opção 3)

## Contexto

Hoje, ao clicar em **Ligar modo Auto**, nada visível acontece: o pop-up de configuração continua aberto e só uma linha de status muda ("Ligado · lendo a lista da BLL…"). A leitura da BLL leva alguns segundos e a do YouTube mais ainda, então o usuário fica sem saber se o Quadra está fazendo alguma coisa.

O usuário escolheu a opção 3 do mockup. Enquanto o Auto faz a **primeira busca**, as telas vazias da grade viram **telas-esqueleto**: um brilho passa por elas e aparece o texto "Procurando jogos ao vivo…". Cada jogo encontrado ocupa uma delas. Se nada estiver ao vivo, as telas dizem isso e voltam ao normal. O pop-up fecha ao ligar, para a grade ficar visível.

## Comportamento

1. **Ao ligar (no grid):** o pop-up fecha. Cada painel vazio vira esqueleto (`panel--searching`) até terminar a primeira leitura de todas as fontes escolhidas (BLL e/ou YouTube).
2. **Ao ligar pela tela inicial:** o pop-up fecha. O Quadra entra na grade com **4 telas-esqueleto temporárias**, as mesmas 4 telas do início do app. Depois da primeira leitura:
   - os jogos ocupam as telas;
   - as telas temporárias que sobrarem são removidas;
   - se não achou nada, a grade volta para a tela inicial, como hoje, com o status explicando.
3. **Grade cheia ao ligar** (nenhum painel vazio e menos de 18 telas): entra **uma** tela-esqueleto temporária, preenchida ou removida depois da primeira leitura. Com 18 telas não há esqueleto; o feedback fica no status e no aviso final.
4. **Resultado da primeira busca:**
   - **Jogo encontrado:** ocupa a tela-esqueleto (o fluxo atual de `applyAutoOpen`/`planAutoOpen` já preenche os vazios primeiro).
   - **Nada ao vivo:** os esqueletos param de brilhar e mostram "Nenhum jogo ao vivo agora · o Auto segue procurando" por ~4 s. Depois voltam a ser painéis vazios normais, e as telas temporárias somem.
   - **Erro de leitura** (BLL sem login, YouTube sem chave ou sem cota): a mesma troca, com a mensagem curta do erro, por ~6 s.
5. **Leituras seguintes** (a cada 25 s BLL / 5 min YouTube): **sem** esqueleto, para não piscar a grade a cada leitura.
6. **Desligar o Auto, "Voltar" ou mexer no layout** (Organizar, arrastar, desfazer) durante a busca: os esqueletos somem na hora, e as telas temporárias também.
7. **Acessibilidade e tela limpa:** o esqueleto é conteúdo do painel, não controle, então respeita a tela limpa ociosa. Ele tem `aria-busy="true"` e texto `role="status"`. Com `prefers-reduced-motion`, o brilho vira um fundo fixo.

## Implementação

### 1. Estado puro e testável: `src/auto-open.ts`

Uma função nova decide o que cada painel mostra, sem DOM:

```ts
export type AutoSearchPhase = 'searching' | 'none-found' | 'error' | null
export function autoSearchPlaceholders(opts: {
  emptyPanelIds: string[]; panelCount: number; maxPanels: number; fromChooser: boolean
}): { mark: string[]; addTemporary: number }
```

- `fromChooser`: `addTemporary: 4`.
- Grade com vazios: `mark` = os vazios.
- Grade cheia abaixo do máximo: `addTemporary: 1`.
- Grade no máximo: nada.

### 2. Estado da busca: `src/main.ts`

- Variáveis novas junto do estado do Auto (perto de `autoOpenYoutube…`):
  - `autoSearch: { phase: AutoSearchPhase; message: string; pending: Set<'bll' | 'youtube'>; temporary: Set<PanelId>; timer: number | null } | null`
- **`startAutoSearch(fromChooser)`**, chamada por `setAutoOpen(true)`:
  - preenche `pending` com as fontes ligadas;
  - na tela inicial, cria a grade de 4 painéis vazios, como `selectCount(4)`, guardando os ids em `temporary`;
  - na grade cheia, adiciona 1 painel (`createPanel`, no fim de `panels`, em `temporary`);
  - chama `renderGrid()`.
- **`finishAutoSearchSource(source, error?)`**, chamada no fim de `pollAutoOpen` e `pollAutoOpenYoutube`, tanto no sucesso quanto no erro:
  - remove a fonte de `pending`;
  - quando `pending` esvazia, roda `applyAutoOpen()` (que já preenche os vazios) e depois `settleAutoSearch()`.
- **`settleAutoSearch()`:**
  - remove de `temporary` os painéis que receberam jogo;
  - se ainda sobram painéis esqueleto, põe `phase` em `'none-found'` ou `'error'` com a mensagem e agenda `clearAutoSearch()` em 4–6 s;
  - se acabou de vir da tela inicial e nenhum jogo abriu, volta para `view = 'choose'`.
- **`clearAutoSearch()`:**
  - remove os painéis temporários que seguem vazios (com cuidado para não ficar abaixo de `MIN_PANELS`);
  - zera `autoSearch`;
  - chama `buildCurrentLayout()` + `renderGrid()`.
- **Cancelamento:** chamar `clearAutoSearch()` em `setAutoOpen(false)`, `renderChoose()`, `pushHistory()` (toda mudança manual de layout passa por ele, como já faz com `cancelAutoMode()`) e `removePanel`/`applyPanelUrl` do próprio painel esqueleto.
- **Tela inicial:** hoje o ramo `view === 'choose'` de `applyAutoOpen` usa `startWithGames` (que **substitui** os painéis). Com a grade-esqueleto já criada, a primeira leitura passa pelo ramo da grade (fill/extra), e `startWithGames(..., true)` só continua para o caso sem esqueleto. Isso mantém a regra de som de `autoOpenSound`.
- **`autoOpenBusy()`:** não pode tratar a própria busca como "ocupado"; a busca não abre `.confirm`.

### 3. Render: `src/main.ts`, `panelInnerHtml`

No ramo `!panel.url`, se `autoSearch` marca o painel, o formulário de URL é trocado por:

```html
<div class="panel__searching" aria-busy="true">
  <p class="panel__slot" role="status">Procurando jogos ao vivo…</p>   <!-- ou a mensagem de none-found/erro -->
</div>
```

O painel ganha a classe `panel--searching` no template de `renderGrid` (junto de `panel--empty`), e `.is-searching-done` quando `phase !== 'searching'`, para parar o brilho. Os controles do painel (`panelActionsHtml`, lixeira) continuam, para dar para remover uma tela.

### 4. Pop-up fecha ao ligar: `openAutoOpenDialog`

No listener de `[data-auto-open-toggle]` (`src/main.ts`, por volta da linha 2425): ao **ligar**, chama `setAutoOpen(true)` e depois o `finish()` do diálogo. Ao desligar, o pop-up continua como hoje.

### 5. CSS: `src/style.css`

Perto de `.panel--empty` / `.panel__empty`:

- `.panel--searching`: fundo `var(--panel-empty)` e um `::after` com faixa diagonal clara (`rgba(200,245,96,.12)`) animada em `translateX(-100%) → 100%`, 1,6 s, infinita. `pointer-events: none` no `::after`.
- `.panel--searching.is-searching-done::after { animation: none; opacity: 0 }`.
- `.panel__searching`: texto centralizado no estilo de `.panel__slot`.
- Somar ao bloco `@media (prefers-reduced-motion: reduce)` já existente (linha ~335): `.panel--searching::after { animation: none; }`.
- Conferir o hit-test de `updateChromeHitTarget`: `.panel--empty` já é interativo; o esqueleto herda.

### 6. Notas e registro

- `src/release-notes.ts`, entrada `1.3.2`: "Ao ligar o Modo Auto, as telas mostram que o Quadra está procurando jogos e cada jogo encontrado ocupa uma delas."
- `AGENTS.md`, seção 6: linha com as decisões (só a primeira busca, telas temporárias, cancelamento por `pushHistory`).
- Este plano fica em `docs/plano-auto-esqueleto.md`.

## Arquivos

- `src/auto-open.ts`: `autoSearchPlaceholders`
- `src/main.ts`: estado `autoSearch`, start/finish/settle/clear, `panelInnerHtml`, template de `renderGrid`, diálogo, cancelamentos
- `src/style.css`: `.panel--searching`, brilho e reduced motion
- `tests/auto-open.test.ts`, `tests/app-integration.cjs`
- `src/release-notes.ts`, `AGENTS.md`

## Verificação

Pela regra do usuário (memória `heavy-tests-in-ci.md`), localmente só `typecheck`, `npm test` e `build`; os smokes Electron rodam no CI do PR.

- **Local:**
  - `npm run typecheck`, `npm test` e `npm run build`.
  - Testes novos de `autoSearchPlaceholders`: tela inicial dá 4 temporárias; grade com vazios marca os vazios; grade cheia dá 1 temporária; grade no máximo não dá nada.
- **CI (`test:app`):** o fixture do servidor ganha uma flag para **atrasar** a resposta da lista da BLL (e de `/youtube/playlistItems`) em ~2 s, para dar tempo de ver o esqueleto. Casos:
  1. Tela inicial → Ligar: o pop-up some, aparece `.grid--4` com 4 `.panel--searching`; depois os 2 jogos da "Liga Teste" ocupam as telas e as 2 temporárias somem (`.grid--2`, sem `.panel--searching`).
  2. Grade com 1 vazio → Ligar com nada ao vivo: o painel mostra "Nenhum jogo ao vivo agora…" e volta a vazio normal (com o formulário de URL) depois de ~4 s.
  3. Desligar durante a busca: os esqueletos somem na hora.
- **No app, pelo usuário:** ligar o Auto pela tela inicial e com a grade aberta, com a BLL logada, para ver o brilho e os jogos entrando.

## Implementado (2026-11-10)

- Diferença do plano: uma mudança manual de layout (`pushHistory`) só encerra a busca e deixa as telas temporárias como telas vazias normais. Desligar o Auto e "Voltar" tiram as temporárias, como previsto.
