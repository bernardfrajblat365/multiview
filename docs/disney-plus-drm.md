# Disney+ no Quadra: investigação de DRM

Data: 25/09/2026. Branch: `research/disney-plus-drm`.

## Estado da integração v1.0.11

Esta integração foi transportada para uma branch isolada sobre a base remota atual. A instalação limpa, com caches npm/Electron novos e SSH Git bloqueado, baixou o runtime ECS `44.1.0+wvcus`; `test:ecs` confirmou executável e `.sig`. O instalador local 1.0.11 passou a verificação EVS de produção streaming, conferência de versão e metadata, hash, blockmap e verificação VMP do payload extraído. O smoke do executável extraído passou para grade de 16 painéis, retorno ao chooser e abertura de `WebContentsView`.

**Disney+ ainda não foi validado funcionalmente na build 1.0.11.** As confirmações manuais históricas registradas abaixo pertencem à build instalada 1.0.9 e não comprovam reprodução, recarga ou tela cheia no instalador novo. Essa confirmação depende do instalador exato produzido pelo CI e permanecerá pendente até o teste manual.

O smoke completo da toolbar teve falhas intermitentes locais; a repetição passou por counts 1–7 e o recorte de 8 painéis passou todas as combinações, mas a matriz completa local não está marcada como aprovada. O check de PR executará a matriz integral.

## Estado atual e limite da evidência

O Quadra agora usa o Electron for Content Security (ECS) da Castlabs, fixado em `v44.1.0+wvcus` (`44.1.0+wvcus`). A inicialização do componente e o diagnóstico local passaram nesta máquina:

| Verificação | Evidência |
|---|---|
| CDM Widevine | versão `4.10.3050.0`, estado `updated` |
| Contexto seguro / EME | `true` / `function` |
| Clear Key | `supported` |
| Widevine (`com.widevine.alpha`) | `supported` |
| H.264 / AAC | `probably` para ambos; não é decodificação completa |
| Runtime | Chrome `152.0.7977.65`, Electron `44.1.0` |

Isso comprova que o runtime ECS consegue inicializar o CDM e expor Widevine. Não comprova que o Disney+ aceite o cliente, obtenha uma licença ou reproduza um título.

O usuário fez duas tentativas manuais no título [Disney+](https://www.disneyplus.com/pt-br/play/3bf84a78-7a84-4c89-b99a-7491896637e4) dentro de um painel do Quadra; ambas falharam com erro 83 e o vídeo não reproduziu. O screenshot enviado pelo usuário é da primeira tentativa; a segunda, após o VMP Lab, foi confirmada pelo usuário. Não foram coletados senha, cookies, tokens ou corpo de licença. A aba Disney+ do navegador de pesquisa permanece separada e não é um teste do perfil do Quadra.

O suporte Disney+ consultado recomenda a versão mais recente do navegador e lista Chrome, Firefox, Edge e Opera no Windows 10 ou posterior. Seu artigo geral de streaming menciona compatibilidade de dispositivo, conexão, IPv6, cache e componentes HDCP, mas não documenta uma causa específica para o código 83. Portanto, a mensagem não permite concluir isoladamente que a causa seja VMP, rede ou seleção de navegador. É plausível que o cliente ECS não listado ou a assinatura de desenvolvimento sejam recusados pelo serviço; isso é uma hipótese a testar, não um diagnóstico confirmado. [Requisitos de navegador](https://help.disneyplus.com/pt-BR/article/disneyplus-computer-browser-requirements), [solução de problemas de streaming](https://help.disneyplus.com/pt-BR/article/disneyplus-streaming-issues).

## Como os painéis funcionam

O fluxo é `normalizeUrl` → `applyPanelUrl`/`openAllPanels` → `syncLayout` → IPC `quadra:set-layout` → `applyLayout` → `createSlotView` → `webContents.loadURL`.

- Cada painel é uma `WebContentsView` completa, navegando diretamente na URL. Não há iframe nem uso de um Chrome instalado.
- Os painéis, o catálogo e as janelas auxiliares usam a sessão persistente `persist:quadra`; cookies e login podem ser reutilizados entre eles.
- Todos usam o mesmo runtime ECS, o mesmo CDM e as mesmas capacidades de DRM.
- O user-agent é construído a partir de `process.versions.chrome`; isso evita anunciar uma versão inventada, mas não concede licença nem substitui VMP.
- URLs Disney+ não recebem transformação específica em `src/routing.ts`.
- Se `components.whenReady()` falhar, o Quadra mostra um aviso e continua abrindo; a reprodução protegida pode ficar indisponível até reiniciar e tentar novamente.

## Diagnóstico reproduzível

```sh
node tests/drm-diagnostic.cjs
```

O diagnóstico abre uma `WebContentsView` em localhost, com perfil temporário e as mesmas preferências de segurança dos painéis. Ele não acessa uma conta Disney+ nem solicita uma licença do serviço.

Resultado observado em 25/09/2026:

```json
{
  "components": {
    "version": "4.10.3050.0",
    "status": "updated"
  },
  "secureContext": true,
  "eme": "function",
  "keySystems": {
    "org.w3.clearkey": "supported",
    "com.widevine.alpha": "supported"
  }
}
```

O código 0 significa que o diagnóstico e seus asserts passaram; não significa que Disney+ reproduziu.

`npm run test:startup` (também incluído em `npm test`) verifica que uma falha simulada do `components.whenReady()` gera o caminho degradado sem impedir a continuação da inicialização.

## Empacotamento ECS e VMP

O `electron-builder` baixa Electron stock por padrão. A configuração base agora aponta para `node_modules/electron/dist`, para distribuir o runtime ECS. As concessões para preservar a assinatura VMP de desenvolvimento ficam somente no comando de POC `npm run dist:drm-poc`:

- definir `disableAsarIntegrity: true`, pois a alteração do recurso do executável muda os bytes cobertos pela assinatura VMP;
- desativar `win.signAndEditExecutable` e `win.signExecutable`, para não editar nem assinar novamente o executável ECS;
- executar `electron/after-pack.cjs`, que renomeia `electron.exe.sig` para `Quadra.exe.sig` depois que o builder renomeia o binário;
- escrever o build unpacked em `release-drm-poc/`, sem sobrescrever os artefatos normais em `release/`.

Os comandos `npm run dist` e `npm run dist:release` executam `electron/after-sign.cjs` após editar recursos e aplicar Authenticode, quando configurado, antes de gerar NSIS. O hook assina via EVS e exige verificação streaming de produção; erro, assinatura dev ou `.sig` ausente interrompem o build. VMP não substitui Authenticode.

Validação executada:

```sh
npm run dist:drm-poc
```

O build experimental anterior, sem `disableAsarIntegrity`, produziu um executável alterado e foi descartado. O build isolado foi concluído em `release-drm-poc/win-unpacked/`; o hash SHA-256 do `Quadra.exe` corresponde ao `electron.exe` ECS original (`6EB9AA00543F87DF9B595D4125622CE575655FC2B724ECAD73D765342A87115C`) e o `.sig` foi renomeado sem alteração de bytes. `npm run test:drm-poc` passou, incluindo os casos de renomeação e ausência da assinatura.

Essa assinatura de desenvolvimento não é uma autorização de produção. O VMP Lab oficial da Castlabs reporta o status que o servidor de licença vê para o pacote ECS; os estados `PLATFORM_SOFTWARE_VERIFIED`, `PLATFORM_TAMPERED` e `PLATFORM_UNVERIFIED` distinguem assinatura dev reconhecida, alterada ou não reconhecida. No executável POC aberto, o usuário executou **Load Content** dentro de um painel do Quadra e informou `PLATFORM_SOFTWARE_VERIFIED`. Isso confirma a assinatura de desenvolvimento para o laboratório, não uma licença/aceitação do Disney+ nem VMP de produção.

O cliente `castlabs-evs` 1.3.2 está em um venv Python temporário isolado. Antes do cadastro, `python node_modules/electron/vmp-resign.py -v -W Quadra.exe -Y release-drm-poc/win-unpacked` verificou a integridade do pacote dev e `verify-pkg --streaming` reportou `Certificate is valid for development only`.

Após o usuário concluir o cadastro EVS, foi gerado um pacote atualizado separado em `release-drm-evs-poc/win-unpacked/`, preservando a cópia dev. `castlabs_evs.vmp -n sign-pkg --streaming --force` concluiu e `verify-pkg --streaming` confirmou `Signature is valid: streaming, 1391 days left`. Uma revisão independente confirmou o hash do EXE igual ao ECS original, a assinatura atual com 1418 bytes e nenhuma falha de preservação; também verificou que o guard bloqueia `dist`/`dist:release` antes do build e que o workflow usa `dist:release`. O usuário confirmou reprodução do título no painel Quadra desta build EVS. A integração posterior está descrita acima. Authenticode, se usado, continua sujeito à ordem exigida pelo EVS.

O lockfile integrado fixa o pacote ECS no commit `bbb3862120430db6fa3ffa1ce22c3b66fe99e0b8` por Git HTTPS. A instalação limpa local passou sem chave SSH, com caches npm/Electron novos; o postinstall executou o instalador oficial do pacote ECS e `test:ecs` encontrou versão, binário e `.sig` esperados. O workflow de PR repete essa verificação em Windows.

## Histórico de tentativas e confirmações anteriores

Após confirmar `PLATFORM_SOFTWARE_VERIFIED`, o usuário repetiu o título dentro da POC ECS e recebeu erro 83 novamente. O VMP Lab atesta somente a assinatura de desenvolvimento reconhecida pelo laboratório; sua execução não altera a assinatura nem corrige DRM do Disney+. Repetir essa combinação não é um teste adicional útil.

As duas tentativas anteriores ao EVS falharam com erro 83. Naquele teste, o Quadra antigo foi fechado e `release-drm-evs-poc/win-unpacked/Quadra.exe` estava aberto. Em 25/09, o painel recebeu o URL exato `https://www.disneyplus.com/pt-br/play/3bf84a78-7a84-4c89-b99a-7491896637e4`; depois, o usuário confirmou que o vídeo reproduziu no painel Quadra. Esta é uma confirmação manual do usuário; não foi capturada evidência visual independente nesta sessão. Nenhum instalador foi publicado; `dist` e `dist:release` agora exigem assinatura e verificação EVS durante o build. [Instruções oficiais do EVS](https://github.com/castlabs/electron-releases/wiki/EVS).

“Widevine suportado”, VMP dev verificado e pacote EVS válido são evidências técnicas intermediárias. Estado: **o usuário confirmou reprodução do título no painel Quadra com a build EVS; as duas tentativas pré-EVS falharam com erro 83**.

A revisão independente considera a confirmação manual suficiente para o critério funcional desta POC. Isso não prova que a assinatura dev foi a única causa do erro 83 nem compatibilidade geral entre títulos e máquinas. O pacote testado é unpacked, não instalador. Para cada release, o pipeline deve aplicar todas as alterações de recursos e Authenticode cabíveis antes do VMP; assinar e verificar o binário final exigindo streaming/produção (falhando para assinatura inválida ou dev), incluir o `.sig` correspondente no instalador e validar o app instalado. O smoke de release deve recarregar o título e testar fullscreen; validar segundo painel se reprodução simultânea fizer parte do escopo. Segredos EVS ficam fora do repositório e logs.

## Alternativas e falsas soluções

| Opção | Consequência |
|---|---|
| Abrir o link no Chrome/Edge instalado | Pode confirmar a conta fora do Quadra, mas não comprova reprodução interna. |
| ECS + CDM + VMP de produção + validação real | Caminho compatível com a arquitetura atual; depende de EVS e aceitação do Disney+. |
| Mudar user-agent, separar sessões ou criar mais `WebContentsView` | Não instala Widevine nem autoriza a licença. |
| Remover CSP/X-Frame-Options, desativar sandbox/webSecurity ou copiar DLL do Chrome | Não constitui integração suportada de DRM e não substitui VMP, sessão ou licença. |

## Executar o build integrado

Instale `castlabs-evs==1.3.2` no Python usado pelo build e autentique localmente com `python -m castlabs_evs.account refresh`. Execute `npm run dist:release`. Para venv, defina `EVS_PYTHON` com o caminho do `python.exe`. `EVS_CONFIG_FILE` permite indicar um arquivo de autenticação fora do repositório. O build usa modo não interativo e não imprime a saída bruta do cliente EVS.

No GitHub Actions, configure `EVS_AUTH_JSON` com o JSON de autenticação gerado pelo cliente EVS. O workflow grava esse secret somente no diretório temporário do runner e o remove com `if: always()`. Em 25/09/2026, o secret foi configurado em `bernard-014/multiview-desktop` a partir do arquivo de autenticação local; a presença e a data foram verificadas, sem ler o valor remoto de volta. Não cole o conteúdo em chat, issues ou arquivos versionados. Renove o secret se a autenticação expirar.

Validação da integração: `npm run dist:release` gerou o instalador local, `test:evs`, typecheck, testes existentes e validação de metadata passaram. O EXE e `.sig` extraídos do instalador também passaram em `verify-pkg --streaming`, com assinatura de produção válida. O instalador foi executado sem interface; o Quadra instalado está em `%LOCALAPPDATA%/Programs/Quadra`. Seu EXE tem o mesmo SHA-256 do payload verificado, o arquivo de assinatura tem 1418 bytes, e a verificação instalada reportou `Signature is valid: streaming, 1391 days left`. Nenhum release foi publicado. A POC unpacked encerrou antes da instalação; nenhum processo Quadra estava ativo, então não houve encerramento de uma sessão em execução. Depois da instalação, o usuário confirmou manualmente que o título Disney+ reproduziu no painel Quadra e que recarga e fullscreen funcionaram. Não houve captura visual independente nesta sessão. Essa confirmação no app instalado é distinta da reprodução previamente confirmada na POC unpacked.

## Escopo desta branch

Foram preservadas as alterações anteriores do usuário. Esta investigação atualiza o diagnóstico, mantém o Quadra utilizável se o CDM não inicializar, isola os switches VMP no build de teste, interrompe builds quando assinatura/verificação EVS falham e registra as tentativas Disney+. O usuário concluiu o cadastro EVS, o pacote de teste recebeu/validou assinatura VMP de produção e o usuário confirmou reprodução do título Disney+ no painel Quadra. Nenhum release foi publicado.


## Confirmação final no aplicativo instalado

Após instalar o build e conferir seu hash e assinatura, o usuário confirmou pela pergunta estruturada: reproduziu, recarregou e tela cheia funcionou. O resultado corresponde ao título solicitado no Quadra instalado pelo menu Iniciar. Esta confirmação manual conclui a pendência de teste instalado descrita anteriormente; não houve captura visual independente pelo agente. O secret EVS_AUTH_JSON está configurado no GitHub. Nenhum release foi publicado.
