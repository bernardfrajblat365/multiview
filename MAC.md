# Quadra para Mac (variante)

Esta variante fica **só** na branch `claude/loving-shannon-3fmyta`. Ela nunca entra na `main`, não cria release nem tag e não mexe nas atualizações do Windows.

## Como baixar

1. No GitHub, abra **Actions → macOS build (variante Mac)** e entre na execução mais recente (verde).
2. Em **Artifacts**, baixe:
   - `Quadra-mac-arm64`: Mac com chip Apple (M1, M2, M3, M4…). Na dúvida, veja em  → Sobre este Mac → "Chip".
   - `Quadra-mac-x64`: Mac com processador Intel.
3. Descompacte o `.zip`, abra o `.dmg` e arraste o **Quadra** para **Aplicativos**.

## Primeira abertura (o app não tem assinatura da Apple)

Sem uma conta paga de desenvolvedor Apple, o macOS bloqueia a primeira abertura:

1. Abra o Quadra uma vez. Vai aparecer um aviso de que a Apple não pôde verificar o app. Clique em **OK** ou **Concluído**.
2. Vá em **Ajustes do Sistema → Privacidade e Segurança**, role até o fim e clique em **Abrir Mesmo Assim** ao lado de "Quadra". Confirme com a senha.

Se aparecer "Quadra está danificado e não pode ser aberto", rode no Terminal e abra de novo:

```bash
xattr -dr com.apple.quarantine /Applications/Quadra.app
```

## Diferenças em relação ao Windows

- Atalhos usam **Cmd** no lugar de Ctrl (zoom: Cmd + / Cmd − / Cmd 0).
- O botão de tela cheia do Quadra ocupa a tela no mesmo espaço (sem a animação de tela cheia do macOS), para os controles continuarem por cima dos vídeos. O botão verde da janela também funciona.
- Fechar a janela fecha o Quadra (como no Windows).
- **Sem atualização automática**: para atualizar, baixe o `.dmg` novo pelo mesmo caminho.
- Widevine/DRM: o build passa pela mesma assinatura VMP (EVS) do Windows, mas ainda não foi testado num Mac real com BLL ou Disney+.

## Build local num Mac

```bash
npm ci
```

```bash
npm run dist:mac:dev
```

`dist:mac:dev` mantém a assinatura VMP de desenvolvimento (sem conta EVS). Com EVS configurado, use `npm run dist:mac`. O `.dmg` sai em `release/`.
