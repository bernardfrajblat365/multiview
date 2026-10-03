# Barra de tarefas sobre os controles em tela cheia

Diagnóstico de 18/09/2026, Windows, build local do Quadra com Electron 44.4.0. Nenhuma correção foi aplicada ao código de produção; os experimentos estão em `tests/fullscreen-diagnostic.cjs`.

## Resultado confirmado

Com cinco vídeos locais, a sequência **fullscreen → foco no vídeo → foco nos controles → Organizar** fez a barra de tarefas cobrir a toolbar nas três repetições observadas na execução de referência. Mutar todos também deixou a barra sobre os controles. A janela principal continuou com `isFullScreen() === true`.

Evidências da execução de referência, em `artifacts/toolbar-checks/fullscreen-automatic/`:

- `005-round-1-video-focus.png`: cinco vídeos, toolbar acessível, barra de tarefas ausente.
- `008-round-1-organizer.png`: organizador aberto, barra de tarefas sobre a toolbar.
- `011-round-1-mute.png`: mesmo defeito após mutar.
- `021-round-2-organizer.png` e `034-round-3-organizer.png`: reprodução nas outras duas rodadas.
- Os arquivos JSON correspondentes e `events.jsonl` registram foco, fullscreen e dimensões.

No estado problemático, a janela principal estava sem foco e em fullscreen; o overlay estava com foco e fora de fullscreen. A altura registrada passou de 1080 para 1079 nessa troca. A variação de um pixel é evidência associada, não uma causa isoladamente demonstrada.

## Por que parece intermitente

O app usa duas janelas nativas. Os vídeos pertencem à principal; toolbar, organizador e inputs pertencem ao overlay transparente. A ativação dos controles muda a janela ativa. Voltar o foco à principal pode ocultar novamente a barra; interagir outra vez com o overlay pode trazê-la de volta. A sequência anterior de foco e a ordem das janelas importam.

Os primeiros cliques nativos não mostraram o defeito nas capturas limitadas à janela. As capturas do monitor inteiro na execução de referência demonstraram a sobreposição. Captura da janela e `isFullScreen()` não bastam para validar esse problema.

Houve atividade de outro aplicativo durante alguns testes; capturas que mostram esse aplicativo não foram contadas como aprovação ou reprovação visual do Quadra. O teste de Alt+Tab foi exercitado, mas não caracteriza sozinho todas as condições de intermitência do Windows.

## Testes executados

| Situação | Resultado |
| --- | --- |
| Build atual | Passou |
| Abrir/cancelar Organizar com cinco vídeos em fullscreen | Funciona, mas a barra de tarefas cobriu os controles em 3/3 rodadas da referência |
| Mutar todos em fullscreen | Ação funciona; sobreposição observada |
| Sair/entrar em fullscreen três vezes | Estado da principal alternou corretamente |
| Adicionar sexta tela e inserir URL | Quantidade e texto confirmados por assertions; isso não garante ausência de sobreposição |
| Ocultar/revelar toolbar | Passou na referência; execuções iniciais do protótipo falharam na espera de inatividade, exigindo controle explícito do ponteiro no teste |
| Alt+Tab e retorno por ativação | Exercitado com automação nativa; resultado visual limitado pela captura/atividade concorrente |
| Protótipo: ocultar/revelar após posicionar o ponteiro fora dos controles | Passou |
| Protótipo: focar outra janela normal e retornar | Assertions confirmaram retirada e recuperação da prioridade nas duas janelas |
| Protótipo: minimizar/restaurar | Falhou: após restaurar, principal sem prioridade e overlay com prioridade; requer tratamento de restauração |

## Experimentos de correção

**Somente chamar `overlay.setFullScreen(on)`: não adotar.** O overlay continuou reportando `fullscreen: false`. O código do Electron 44.4.0 usa um caminho especial para janelas transparentes/sem `thickFrame`, ajustando bounds em vez de usar o fullscreen do widget. Portanto, o comando adicional não oferece a garantia necessária nesta arquitetura.

Fonte: [Electron 44.4.0, NativeWindowViews::SetFullScreen/IsFullscreen](https://github.com/electron/electron/blob/v44.4.0/shell/browser/native_window_views.cc#L762).

**Prioridade de janela limitada ao uso em fullscreen: candidato recomendado.** O protótipo chama `setAlwaysOnTop(true, 'screen-saver')` nas duas janelas somente quando a principal está em fullscreen e uma delas tem foco. Retira a prioridade quando essas condições deixam de valer. As primeiras três rodadas mantiveram a toolbar visível sem a barra de tarefas; sair de fullscreen retirou a prioridade de ambas.

O nível precisa ficar acima da barra de tarefas no Windows; o nível padrão não deve ser assumido equivalente. Referência: [Electron, setAlwaysOnTop](https://www.electronjs.org/docs/latest/api/base-window#winsetalwaysontopflag-level-relativelevel).

**O protótipo não está aprovado para produção.** Na execução final, a troca para outra janela retirou corretamente a prioridade (`051-external-window-priority-released.json`), e o retorno a recuperou (`053-return-priority-restored.json`). Após minimizar/restaurar, `055-main-focus.json` registrou prioridade desligada na principal e ligada no overlay, com fullscreen ainda ativo. A assertion de restauração falhou. Esses arquivos estão em `artifacts/toolbar-checks/fullscreen-topmost/`; o log completo está em `artifacts/toolbar-checks/fullscreen-topmost-run.log`. A implementação precisa observar também `restore` e reconciliar o estado após o Windows concluir a restauração; só eventos de foco/fullscreen foram insuficientes no experimento.

## Plano de implementação

1. **Centralizar a política em `electron/main.ts`.** Criar uma única função pequena para calcular `process.platform === 'win32' && mainWindow.isFullScreen() && !mainWindow.isMinimized() && (mainWindow.isFocused() || overlayWindow.isFocused())`. Atualizar a prioridade das duas janelas somente quando mudar. Não chamar `focus()` para corrigir sobreposição: os inputs precisam manter o teclado.

2. **Reconciliar o ciclo de vida.** Acionar a função nos eventos `focus`, `blur`, entrada/saída de fullscreen, minimizar/restaurar e criação/fechamento do overlay. Agendar uma única reconciliação no próximo ciclo do event loop para não tratar a passagem de foco principal → overlay como saída do aplicativo e para consultar fullscreen após a transição nativa. Conferir referências destruídas. Deixar catálogo WeddBets e pop-ups receberem foco normalmente; isso deve retirar a prioridade do par principal/overlay.

3. **Integrar a regressão.** Aproveitar o diagnóstico para verificar prioridade ativa nos controles e nos vídeos, desativada fora do fullscreen e em outra janela, texto nos inputs e reaproveitamento dos players. Manter captura do monitor inteiro para verificar a barra de tarefas. `element.click()` sozinho não testa ativação nativa; a execução automática precisa alternar explicitamente o foco, além de um teste com mouse real.

4. **Validar antes de distribuir.** Executar typecheck, build e smokes de toolbar/app. Repetir com 1, 5 e 16 painéis; Organizar, Adicionar, Mutar, Mais opções e editar URL; ocultar/revelar toolbar; Alt+Tab; minimizar/restaurar; WeddBets; abrir/fechar pop-ups; monitor secundário e escala de tela diferente quando disponíveis. Conferir vídeo, áudio e clique direto nos players. Testar o executável empacotado, não apenas o build local.

Critérios de aceite: controles acessíveis durante fullscreen; teclado permanece no campo selecionado; outro aplicativo pode vir à frente; nenhuma prioridade residual ao sair do fullscreen/minimizar; players não são recriados. Se a política de prioridade não passar esses critérios, estudar a UI na mesma janela nativa, incluindo a passagem de cliques aos players, antes de propor essa mudança maior.

## Reexecutar

No diretório `multiview/`, após `npm run build`:

```powershell
node tests/fullscreen-diagnostic.cjs --auto
node tests/fullscreen-diagnostic.cjs --auto --overlay-fullscreen
node tests/fullscreen-diagnostic.cjs --auto --scoped-topmost
```

Sem `--auto`, o diagnóstico abre cinco vídeos locais para interação manual. Usa perfil temporário e servidor em loopback, preservando a sessão normal. As capturas ficam em `artifacts/toolbar-checks/`. A saída `PASS` se refere às assertions funcionais; a barra de tarefas exige revisão das capturas. Evitar interagir com o computador durante a execução automática, principalmente nos 11,5 segundos do teste de inatividade.
