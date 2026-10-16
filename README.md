# Quadra — Multi-view

App desktop (Electron) para assistir de 1 a 16 páginas ao mesmo tempo em uma única janela. Cada painel é uma `WebContentsView` completa do Chromium, então até sites que bloqueiam incorporação (`X-Frame-Options`) abrem normalmente.

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

1. Na tela inicial, escolha quantas telas quer (1 a 16) ou clique em **Começar com uma tela**.
2. Cole uma URL em cada painel e clique em **Abrir** (ou **Abrir todos**).
   - **BLL:** clique no botão **BLL** do painel, faça login uma vez e escolha o jogo. Os próximos jogos vão para a próxima tela vazia.
3. **+ Adicionar tela** cria um painel novo; a lixeira remove um painel. O layout se reorganiza sozinho.
4. **Organizar** permite escolher a composição, marcar telas principais (destaques) e a posição delas. **Aplicar** confirma; **Cancelar** ou Esc descarta.
5. Outros controles: **Sem destaques**, **Organizar automaticamente**, **Desfazer**, seletor **Telas**, **Voltar**, **Tela Cheia** e editar URL do painel.

### Como o layout funciona

- O tamanho dos painéis é calculado automaticamente para maximizar a área visível de vídeo (referência 16:9), sem cortar a imagem — por isso painéis da mesma composição podem ter tamanhos diferentes.
- Players esportivos são ajustados ao painel mantendo a proporção, com barras pretas quando necessário.
- Destacar um jogo (estrela) coloca ele no espaço grande; um segundo destaque troca para uma composição que comporte dois.
- Não há divisórias manuais. Ao redimensionar a janela, tudo é recalculado preservando destaques e posições.
- A barra de controles fica sempre visível, inclusive em tela cheia.

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

Cobrem todas as quantidades de 1 a 16, composições e destaques, adição/remoção de telas, edição, abertura de várias páginas e páginas com `X-Frame-Options`. O `test:toolbar` valida o encaixe dos players esportivos (16:9, 4:3, 3:4, 16:4) em vários tipos de player, além de tela cheia, redimensionamento, barra de controles e as 124 combinações de composição/posição. As capturas ficam em `artifacts/toolbar-checks/`.

### Limitações conhecidas

Validação de URL, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em alguns links do YouTube ainda não foram tratados.
