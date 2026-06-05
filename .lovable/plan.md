## Objetivo

Garantir que `integrations.access_token` armazene apenas **USER long-lived token** (ou SYSTEM USER) e que `meta_pages.page_access_token` armazene apenas o **PAGE token**, sem possibilidade de cruzamento entre eles. Validar tudo via `debug_token` antes de persistir.

## Arquivos tocados

1. `supabase/functions/meta-connect/index.ts` — função `connect_page` e laço de `pages`. Ponto único onde a Meta retorna tokens; é aqui que a separação precisa ser garantida.
2. `src/routes/api.onboarding.meta-save.tsx` — endpoint server-side que persiste páginas conectadas. Reforçar a mesma regra (defense-in-depth).
3. `src/lib/meta-page-token.ts` — adicionar helper `validateUserAccessToken(token)` usando `debug_token` (hoje só temos `validatePageAccessToken` via `/me`).
4. `src/lib/campaign-publish.functions.ts` — manter o guard já existente (token_type=USER/SYSTEM_USER). Sem mudança funcional, apenas confirmar que continua barrando.

Nenhuma alteração em: WhatsApp, produtos, campanhas existentes, fluxo de publicação além do guard atual, `src/integrations/supabase/client.ts` (auto-gen).

## Onde cada token será salvo

| Token              | Origem (Graph)                                    | Coluna destino                       | Validação obrigatória antes do INSERT/UPDATE |
| ------------------ | ------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| USER long-lived    | `/oauth/access_token?grant_type=fb_exchange_token`| `integrations.access_token`          | `debug_token` → `type IN (USER, SYSTEM_USER)` + `is_valid=true` + scopes mínimos |
| PAGE               | `/{page_id}?fields=access_token` ou `/me/accounts`| `meta_pages.page_access_token`       | `debug_token` → `type=PAGE` + `sanitizePageAccessToken` + `GET /me` 200 |

`integrations.account_metadata` continua guardando metadata (ad_account_id, business_id, token_type).

## Validação `debug_token`

Novo helper em `meta-page-token.ts` (e inline na edge function, já que Deno não importa do `src/`):

```ts
async function debugToken(token, appAccessToken) {
  const r = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${appAccessToken}`);
  const j = await r.json();
  return j?.data; // { type, is_valid, scopes, app_id, user_id, expires_at }
}
```

Regras aplicadas no momento da persistência:

- **Antes de salvar em `integrations.access_token`:**
  - `data.is_valid === true`
  - `data.type === "USER" || data.type === "SYSTEM_USER"` → caso contrário, **abortar com erro `token_type_invalid`** e NÃO escrever na coluna.
  - Scopes mínimos presentes: `ads_management`, `ads_read`, `business_management`. Faltando → abortar com `token_scopes_missing`.

- **Antes de salvar em `meta_pages.page_access_token`:**
  - `sanitizePageAccessToken` (já existe — corrige concatenação `EAA...EAA...`).
  - `data.type === "PAGE"`.
  - `GET /me` retorna 200 com `id === page_id`.
  - Falha → preserva token anterior, registra `last_error`.

App access token usado no `debug_token`: `META_APP_ID|META_APP_SECRET` (já disponível na edge function via env).

## Como evitar sobrescrever USER token com PAGE token no futuro

Três camadas:

1. **Validação por tipo (runtime guard)**: nenhum `UPDATE` em `integrations.access_token` é executado sem `debug_token` confirmar `type IN (USER, SYSTEM_USER)`. Se o código tentar salvar um PAGE token ali, a função aborta antes do SQL.
2. **Coluna marcadora**: gravar `account_metadata.token_type = "USER"` (ou `"SYSTEM_USER"`) junto com cada update do `access_token`. Qualquer leitura futura pode confirmar a origem sem chamar a Graph.
3. **Fluxos separados no código**: o handler de `connect_page`/`pages` na edge function passa a ter duas seções explicitamente nomeadas — `persistUserToken(longUserToken)` e `persistPageToken(pageToken)` — cada uma só toca sua coluna. Não há mais um único caminho que decida em runtime "se não tem user token, salva page token" (era o bug original).
4. **Guard no publish** (já implementado em `campaign-publish.functions.ts`): mesmo que algo vaze, a publicação falha cedo com mensagem "Reconecte a Meta Ads" em vez de chamar Marketing API com PAGE token.

## Validação final (após implementação)

- Reconectar Meta na Solário.
- `SELECT account_metadata->>'token_type' FROM integrations WHERE id = '29649742-...'` → `USER`.
- `debug_token` no token salvo → `type=USER`, `is_valid=true`, scopes ok.
- Republicar Sol 602 → guard passa → `create_creative` aceito.

## Fora de escopo

- Não migrar tokens antigos automaticamente — usuário reconecta uma vez.
- Não mexer em WhatsApp tokens nem em `whatsapp_phone_number_id`.
- Não alterar UI de Configurações (scopes já corretos).
