# Quadra — Multi-view

Quadra é um aplicativo desktop Electron para abrir de 1 a 16 páginas independentes em uma única janela. Cada painel usa uma `WebContentsView` completa do Chromium, portanto páginas que bloqueiam incorporação continuam podendo ser abertas diretamente no painel.

## Como rodar

```bash
npm ci
npm run dev
```

Para gerar o build e o instalador Windows:

```bash
npm run build
npm run dist:release
```

O instalador é escrito em `release/`. Depois de instalado, o programa funciona sem Vite ou servidor local.

## Reprodução protegida e Disney+

O runtime Windows usa ECS `v44.1.0+wvcus` da Castlabs. O aplicativo espera `components.whenReady()` antes de criar os painéis e usa a versão Chromium real no user-agent. Se Widevine não inicializar, o Quadra mostra um aviso e continua aberto; conteúdo protegido pode ficar indisponível até nova tentativa.

`npm ci` deve baixar o runtime ECS, incluindo executável e assinatura VMP. `npm run test:ecs` confirma versão, origem Git HTTPS, binário e `.sig`. O diagnóstico `npm run test:drm-diagnostic` verifica EME/Widevine localmente; ele não comprova que um serviço reproduza um título.

O instalador NSIS de produção exige `castlabs-evs==1.3.2` e autenticação EVS válida. O hook `electron/after-sign.cjs` assina e verifica streaming de produção depois das alterações no executável; falhas e assinaturas de desenvolvimento interrompem o build. `npm run dist:drm-poc` preserva a assinatura de desenvolvimento somente para teste e não gera release.

A documentação da investigação e os limites da evidência Disney+ estão em [docs/disney-plus-drm.md](docs/disney-plus-drm.md). O usuário deve fazer login no perfil Quadra quando necessário; credenciais, cookies, tokens e licenças não são coletados.

## Atualizações automáticas no Windows

Somente o aplicativo empacotado para Windows consulta o release estável do GitHub ao abrir. Se houver uma versão nova, o Quadra pergunta antes de baixar; depois do download, pergunta novamente antes de reiniciar. **Reiniciar e instalar** interrompe os painéis abertos. **Agora não** e **Depois** não instalam nada em segundo plano; a atualização pode ser aceita na próxima abertura ou pelo botão **Verificar atualizações** na tela inicial. Esse botão também reabre a confirmação de instalação após escolher **Depois**.

O workflow `.github/workflows/windows-pr-checks.yml` executa instalação limpa, verificações ECS, testes sem secrets e smokes em cada PR. O workflow `.github/workflows/windows-release.yml` roda ao enviar uma tag `v*`; exige correspondência tag/package, EVS de produção, metadata, blockmap e verificação do payload extraído do NSIS. Ele cria um release draft e não o promove automaticamente.

Depois do merge, a tag deve apontar para o commit integrado e usar uma versão nova. Baixe o instalador do draft, confira `release-verification.json`, valide os hashes e teste Disney+ nesse instalador, incluindo recarga e tela cheia. Só então publique o draft como `latest`. Nunca reutilize ou mova uma tag pública.

Sem certificado Authenticode, o instalador não deve ser declarado como assinado pelo Windows. EVS/VMP valida o pacote para DRM e não substitui Authenticode; o updater também continua validando HTTPS e o SHA-512 de `latest.yml`.

## Uso

1. Escolha qualquer quantidade entre 1 e 16 telas ou clique em **Começar com uma tela**.
2. Cole uma URL em cada painel e clique em **Abrir** ou **Abrir todos**.
   Para o WeddBets, clique no botão **WeddBets** do painel, faça login uma vez e escolha o jogo no catálogo. O player aberto pelo site é enviado diretamente ao painel; nas escolhas seguintes, o destino avança para a próxima tela vazia.
3. Use **+ Adicionar tela** para montar a sessão gradualmente; o botão direciona o foco ao novo painel. A lixeira de cada painel remove aquela tela e recalcula automaticamente a melhor composição para a quantidade restante.
4. Abra **Organizar**, escolha a composição, marque as telas principais e selecione uma miniatura de posição. Clique em **Aplicar** para confirmar. **Cancelar**, Escape e o botão de fechar descartam a prévia.
5. Escolha **Sem destaques**, **Organizar automaticamente**, **Desfazer** ou altere a quantidade no seletor **Telas**.
6. Use **Voltar**, **Tela Cheia**, o menu de opções e o botão de edição de cada painel.

A barra de controles fica sempre visível sobre os painéis, inclusive durante a reprodução e em tela cheia. Em janelas menores, os botões se distribuem em mais de uma linha; o menu de organização acompanha a altura da barra.

Os players do WeddBets são limitados ao espaço real de cada painel. O vídeo preserva a proporção e usa o maior tamanho que cabe, mantendo toda a imagem visível com barras pretas quando necessário, inclusive nos layouts com destaque superior.

O layout recalcula as divisões dos painéis para maximizar a área visível dos vídeos; por isso, painéis de uma mesma composição podem ter tamanhos diferentes quando isso aumenta o vídeo sem cortar a imagem. A otimização usa uma referência 16:9, preserva a posição central da imagem e não tenta detectar a proporção individual de cada transmissão.

O modo automático distribui os painéis conforme a quantidade: a escolha inicial fica em “Automático”, “Sem destaques” ou “Com destaques”. As miniaturas do seletor inicial mostram a composição que será aberta, com descrições como “13 telas · 1 grande + 12 pequenas”. Ao destacar um jogo (estrela do painel), ele ocupa o espaço grande e os demais se redistribuem; um segundo destaque troca automaticamente para uma composição que comporte dois. Em 13 telas com uma principal, o editor mostra quatro miniaturas de canto. Em 10 telas com duas principais, mostra as posições equivalentes agrupadas. Em 7 telas com três principais, mostra os quatro arranjos em L, identificados pelo canto das telas menores. Não há divisórias manuais; os tamanhos são recalculados automaticamente ao redimensionar a janela, preservando destaques e posições e maximizando o vídeo dentro de cada painel.

Escolher números e miniaturas altera somente a prévia. Aplicar confirma a composição inteira em uma operação de Desfazer. As miniaturas usam a proporção atual da janela e o mesmo cálculo dos painéis. Com uma ou duas telas, não há seleção de principal. Com várias principais, a posição escolhida corresponde ao grupo.

As URLs ficam em memória durante a execução. O catálogo e os players do WeddBets compartilham a sessão persistente `quadra`, de modo que o login é feito uma única vez. Outros serviços continuam sem integração ou perfil específico.

## Validações

```bash
npm test
npm run typecheck
npm run test:renderer
npm run test:toolbar
npm run test:app
npm run test:close
npm run test:packaged
```

Os testes locais cobrem cada quantidade de 1 a 16, o catálogo de composições e posições, adição progressiva de telas, preservação de rascunhos, áreas equivalentes, destaques múltiplos, os quatro cantos do layout de 13, histerese de composição, edição, ações coletivas, abertura de múltiplas páginas, fechamento e uma página com `X-Frame-Options` carregada diretamente em um painel.

O teste `test:toolbar` executa o aplicativo real com vídeos locais em reprodução, reproduz a cadeia `#app → wrapper → ViewEvento → row → coluna → player`, verifica o encaixe geométrico real dos players WeddBets em 3 e 4 telas com proporções 16:9, 4:3, 3:4 e 16:4 e exercita OpenVidu, Ant, Flash, MS, `#frameVideo`, inserção tardia, recarga, seleção de destaque, posições, modo igual, redimensionamento, tela cheia e página sem player. A validação confirma clipping nos ancestrais, proporção, centralização, uso máximo do espaço e continuidade da reprodução, além dos limites e pontos de clique da barra e das lixeiras nas 124 combinações de composição/posição. Também verifica foco nos vídeos, inatividade por mais de dez segundos, áudio coletivo, menus e retorno ao seletor. As capturas ficam em `artifacts/toolbar-checks/`.

Problemas de validação de URL, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em certos links do YouTube permanecem fora desta limpeza.
