# Integração Meta na Caixa de Atendimento

Plano incremental em 4 blocos. Aprovação destrava implementação completa em sequência (não vou parar entre blocos).

## Bloco 1 — Secrets + Banco

**Secrets necessários** (vou pedir via tool):
- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN` (string aleatória que você define, ex: `atendei_meta_2026_xyz`)

**Migração SQL:**
- Reaproveitar tabela `integrations` existente — já tem `channel` (enum), `access_token`, `external_account_id`, `account_metadata`. Adicionar canais `instagram` e `facebook` ao enum (já existem no tipo `channel_type`? vou verificar).
- Adicionar coluna `token_expires_at timestamptz` em `integrations`.
- Nova tabela `meta_pages`: `id, company_id, integration_id, page_id, page_name, ig_business_account_id, page_access_token, token_expires_at, active, created_at`. RLS por `company_id`.
- Estender `leads`: adicionar `source text` (whatsapp|instagram|facebook|messenger), `source_sender_id text` (PSID/IGSID), `source_page_id text`.
- Estender `messages`: já tem `external_id`. Adicionar `source text`, `source_subtype text` (dm|comment|messenger|post_comment), `source_metadata jsonb` (guarda comment_id, media_id, post_id para responder).
- Index único `(company_id, source, source_sender_id)` em leads para dedupe.

## Bloco 2 — OAuth Facebook Login

**Frontend** (`src/routes/configuracoes.tsx` — adicionar seção):
- Botão "Conectar Instagram/Facebook".
- Usa Facebook JS SDK carregado dinamicamente. Escopos: `pages_show_list, pages_messaging, pages_read_engagement, pages_manage_metadata, pages_manage_engagement, instagram_basic, instagram_manage_messages, instagram_manage_comments, business_management`.
- Ao logar, recebe `accessToken` de curta duração + lista de páginas → envia para edge function `meta-connect`.
- Mostra lista de páginas conectadas + status (token expira em X dias) + botão Desconectar.

**Edge Function `meta-connect`** (verify_jwt=true):
- Recebe `{ shortLivedToken, pages: [{id, name, access_token}] }`.
- Troca por long-lived token (60 dias) via `GET /oauth/access_token?grant_type=fb_exchange_token`.
- Para cada page: obtém long-lived page token via `/{page_id}?fields=access_token` + checa IG vinculado via `/{page_id}?fields=instagram_business_account`.
- Salva em `integrations` + `meta_pages`.
- Faz subscribe da página aos eventos: `POST /{page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed,comments` com page token.

## Bloco 3 — Edge Function `meta-webhook`

`supabase/functions/meta-webhook/index.ts` (verify_jwt=false, configurado em `config.toml`):
- **GET**: validar `hub.verify_token` contra `META_VERIFY_TOKEN` → retornar `hub.challenge`.
- **POST**: validar assinatura `X-Hub-Signature-256` com `META_APP_SECRET` (HMAC SHA-256 do body bruto).
- Parsear `entry[]`:
  - `object: "page"` → eventos de Messenger (`messaging[]`) e comentários no Facebook (`changes[]` com field=`feed`).
  - `object: "instagram"` → DMs (`messaging[]`) e comentários IG (`changes[]` com field=`comments`).
- Para cada evento: localizar `company_id` via `meta_pages.page_id` ou `ig_business_account_id`.
- Upsert do lead por `(company_id, source, source_sender_id)`. Buscar nome via Graph API quando necessário (`/{psid}?fields=name` com page token).
- Criar conversation se não existir + inserir em `messages` (role=`lead`, `external_id`, `source`, `source_subtype`, `source_metadata`).
- Marcar `awaiting_reply=true`, atualizar `last_message_at`.

**URL para configurar no Meta App**:
`https://atendei-ai-concierge.lovable.app/functions/v1/meta-webhook`

## Bloco 4 — Envio + UI

**Edge Function `meta-send`** (verify_jwt=true):
- Recebe `{ messageId, conversationId, text }` ou similar.
- Lê metadata da última mensagem para decidir:
  - `messenger/dm` → `POST /{page_id}/messages` com `{recipient:{id:PSID}, message:{text}}` + page token.
  - `instagram_dm` → idem com IG `me/messages`.
  - `comment` → `POST /{comment_id}/replies` com `message`.
- Insere mensagem (role=`agent`) só se Graph retornar `message_id`/`id`.

**Frontend Caixa (`src/routes/inbox.index.tsx`):**
- Badge de origem ao lado do ChannelBadge: ícone IG (rosa), FB (azul), Messenger (azul claro), "Comentário" (chip outline).
- Filtros novos: chips "Todos · WhatsApp · Instagram · Facebook · Comentários · Directs · Não respondidos" — query param `source`.
- Lógica de filtro lê `conversations.channel` + última mensagem `source_subtype`.

**Frontend Conversa (`src/routes/inbox.$conversationId.tsx`):**
- Detecta tipo (dm vs comment) e mostra placeholder do input apropriado ("Responder comentário…" vs "Enviar mensagem…").
- Chama `meta-send` em vez de `send-whatsapp-message` quando `source !== whatsapp`.
- Mantém todo fluxo WhatsApp intacto.

## Riscos / Observações

- Webhook só funciona em **published URL**. Antes de publicar a integração, vou testar com `supabase--curl_edge_functions`.
- Comentários no FB/IG só são respondíveis se o App estiver com permissões aprovadas no modo Live. Em modo dev, só funcionam para a própria conta do dev/testers.
- Long-lived tokens expiram em 60 dias. Vou logar `last_error` em `integrations` quando expirar — usuário precisa reconectar. (Renovação automática fica para fase 2.)
- IG só envia DM via webhook quando a conta é Business e vinculada a uma Page FB.

Aprova para eu seguir?