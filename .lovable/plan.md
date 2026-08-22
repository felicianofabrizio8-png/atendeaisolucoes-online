# Redeploy da Edge Function `meta-webhook`

## Escopo

Republicar **apenas** a Edge Function `meta-webhook` com o código já existente no projeto:

- `supabase/functions/meta-webhook/index.ts` (1226 linhas)
- `supabase/functions/meta-webhook/signature.ts` (351 linhas)

Nada mais é tocado.

## Diff de código: nenhum

A árvore de trabalho está limpa para `supabase/` — não há alterações pendentes nesses arquivos. O último commit que tocou `index.ts` é `66a0ff35` (30/07/2026). Portanto o deploy publica exatamente o código atual, byte a byte, sem nenhuma modificação de fonte.

Se você espera uma mudança de comportamento (por exemplo, normalização E.164 do `wa_id` dentro da Edge Function — hoje as linhas 631–674 gravam `phone`/`external_id` com o `wa_id` bruto), isso seria uma alteração de código adicional e **não** está incluída neste plano.

## Confirmação de isolamento

- Funções existentes no projeto: `meta-webhook`, `meta-connect`, `meta-send`.
- O deploy será feito com alvo explícito em `meta-webhook`; `meta-connect` e `meta-send` não são reenviados.
- `supabase/config.toml` permanece intacto (`[functions.meta-webhook] verify_jwt = false` já está correto).

## Não será feito

- Nenhum deploy/publicação de frontend.
- Nenhuma migration nem alteração de dados.
- Nenhuma criação, edição ou rotação de secrets (`META_APP_SECRET`, `META_APP_SECRETS`, etc. seguem como estão).
- Nenhuma alteração em RLS, tabelas ou rotas TanStack.

## Passos de execução

1. Deploy da função `meta-webhook` (somente ela), enviando `index.ts` + `signature.ts`.
2. Verificar o resultado do deploy e checar os logs da função para confirmar que subiu sem erro de boot.
3. Reportar: função publicada, arquivos enviados, e confirmação de que nenhuma outra função/recurso foi alterada.

## Detalhe técnico

O deploy usa a API de funções do backend com o slug `meta-webhook` e o par de arquivos acima. `verify_jwt=false` já está declarado no `config.toml`, então o endpoint público da Meta continua acessível sem JWT, com a validação de assinatura `X-Hub-Signature-256` feita em `signature.ts`.
