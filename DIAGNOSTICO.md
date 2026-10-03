# Diagnóstico da simplificação

Em 16/09/2026, a integração de janelas externas, perfil dedicado, auxiliar PowerShell e caminhos específicos para conteúdo protegido foi removida do código atual.

O fluxo restante usa somente `WebContentsView` dentro da janela principal. O processo principal não localiza, inicia ou controla outro navegador. A interface não exibe seletor, badge ou mensagem de erro específica de navegador externo.

Verificações executadas nesta versão:

- typecheck e testes de normalização de URL;
- layouts de 1 a 16 painéis, adição progressiva, preservação de rascunhos, destaques múltiplos, o caso de 13 painéis, edição, limpeza, menus, divisórias e tela cheia;
- dois conteúdos Electron simultâneos e uma página local que envia `X-Frame-Options: DENY`;
- encerramento com conteúdos carregados;
- inicialização do executável empacotado e criação de `WebContentsView`.

Typecheck, os quatro testes de URL, o smoke de renderer, a integração, o fechamento e o smoke do executável empacotado passaram. O instalador foi gerado em `release/`.

YouTube e transmissões públicas devem ser conferidos manualmente no executável novo. Reprodução, áudio e desempenho de serviços externos não são afirmados pelos testes locais.

As falhas de navegação já conhecidas — validação de URL, nova tentativa da mesma URL, mensagens genéricas e preservação de parâmetros em alguns links — continuam fora do escopo desta limpeza.
