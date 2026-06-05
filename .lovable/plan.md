
# Persistir mídia enviada pelo atendente

## Objetivo
Quando o atendente envia imagem/vídeo via `/api/whatsapp/send-media`, gravar metadata completa de mídia no `messages.source_metadata` para que:
- a mídia volte a renderizar após reload da página
- a miniatura apareça no reply context quando o cliente responder à imagem enviada pelo agente
- o histórico fique completo

Hoje o endpoint já grava `media_url` (path) e `type` em `source_metadata`, mas faltam os campos que o renderer e o reply preview esperam (`media_path`, `media_kind`, `media_mime`, `media_filename`, `media_size`) — e o renderer assina contra o bucket errado quando recebe `media_path` de mídia de agente.

## Contexto técnico relevante
- Mídia do **lead** vive no bucket `whatsapp-media` (privado). O helper `useResolvedMediaSrc` em `inbox.$conversationId.tsx` chama `getSignedWaMediaUrl(path)` que assina **sempre** contra `whatsapp-media`.
- Mídia do **agente** é puxada da biblioteca de produtos e vive no bucket `product-images`. Hoje renderiza só porque cai no fallback `url → getSignedImageUrl` (que assina contra `product-images`).
- Se gravarmos `media_path` apontando para `product-images` sem informar o bucket, o reply preview e o renderer vão tentar assinar no bucket errado → 404.

## Arquivos tocados

| Arquivo | Mudança | Risco |
|---|---|---|
| `src/routes/api.whatsapp.send-media.tsx` | **Aditiva**: incluir `media_path`, `media_kind`, `media_mime`, `media_filename`, `media_size`, `media_bucket: "product-images"` no `source_metadata` do insert. Manter `media_url` e `type` atuais para não quebrar dados antigos. | Baixo — apenas adição de chaves no JSON; insert/Meta call inalterados. |
| `src/routes/inbox.$conversationId.tsx` | **Aditiva mínima**: `useResolvedMediaSrc` passa a aceitar `bucket?: "whatsapp-media" \| "product-images"`. Default = `whatsapp-media` (preserva comportamento atual). `getMediaInfo` lê `media_bucket` e propaga. `ReplyPreview` idem. | Médio — função renderer compartilhada por vários blocos. Mitigado por default igual ao atual + cobertura no checklist. |
| `src/lib/storage.ts` | Pequeno helper opcional `getSignedMediaUrl(bucket, path)` se ainda não existir, para não duplicar lógica. | Baixo. |

**NÃO tocar:**
- `supabase/functions/meta-webhook/index.ts`
- `src/routes/api.whatsapp.send.tsx` (texto)
- `src/routes/api.public.whatsapp.webhook.tsx`
- `src/data/leadRepo.ts` (realtime)
- `src/lib/wa-templates.server.ts` (janela 24h)
- Schema do banco — nenhuma migration necessária (tudo cabe em `source_metadata jsonb`).

## Risco e mitigação

| Risco | Mitigação |
|---|---|
| Renderer atual quebrar para mensagens antigas sem `media_bucket` | Default = `whatsapp-media`, igual ao comportamento atual. Para agente, fallback continua via `url → getSignedImageUrl`. |
| Reply preview de imagem do agente já existente (sem media_path/bucket) | Continua mostrando "📷 Foto" sem thumb, como hoje. Só passa a mostrar thumb para mensagens **novas** enviadas após o deploy. Aceitável. |
| HEAD da mídia falhar para fluxos legados | Sem mudança nesse trecho. |
| Realtime duplicar | Sem mudança em insert path nem em realtime channel. |
| Janela 24h | Lógica `isWithin24hWindow` intocada. |

## Estratégia

1. **Etapa 1 — backend (isolado):** apenas adicionar campos no `source_metadata` do insert em `send-media.tsx`. Deploy. Validar via SQL que as novas chaves aparecem; renderer antigo continua usando `media_url` (fallback). Zero impacto visual.
2. **Etapa 2 — renderer (aditivo):** estender `useResolvedMediaSrc` para aceitar `bucket` opcional com default atual; estender `getMediaInfo` e `ReplyPreview` para repassar `media_bucket`. Deploy. Validar render de mensagens novas + antigas.
3. Sem feature flag formal: o "flag" é a presença dos novos campos no JSON. Mensagens antigas seguem caminho atual; mensagens novas usam o caminho novo.

## Checklist de validação pós-deploy (obrigatório)

Backend (SQL):
- [ ] Última mensagem agent com `source_subtype=image` tem `source_metadata.media_path`, `media_kind`, `media_mime`, `media_filename`, `media_size`, `media_bucket='product-images'`.
- [ ] `error_log` últimas 2h: zero erros relacionados a `send-media`.
- [ ] Sem duplicidade: `GROUP BY external_id HAVING count > 1` = 0.
- [ ] Bucket `whatsapp-media`: contagem inalterada (não escrevemos nele).
- [ ] Bucket `product-images`: nenhum objeto novo criado pelo envio (só leitura).

Regressão WhatsApp (UI + SQL):
- [ ] Texto simples (lead) ✅
- [ ] Imagem recebida (thumb + Baixar + bucket) ✅
- [ ] Áudio recebido (player + Baixar + bucket) ✅
- [ ] **Imagem enviada pelo atendente: aparece no WhatsApp, aparece no inbox, persiste após reload** ⬅ alvo da feature
- [ ] Legenda enviada junto da imagem
- [ ] Reply context para imagem do lead (thumb existente)
- [ ] **Reply context para imagem do agente: thumb aparece** ⬅ alvo da feature
- [ ] Reload da página mantém render
- [ ] Troca de conversa e volta mantém render
- [ ] Realtime: nova mensagem agent aparece sem duplicar
- [ ] Janela 24h: sem `template_blocked` indevido; toast antigo não persiste

Se qualquer item falhar → parar, reverter `send-media.tsx` para o estado pré-feature (ou reverter pela aba History), investigar antes de prosseguir.

## Não inclui
- Não copia mídia do agente para `whatsapp-media` (mantemos cada bucket no seu papel).
- Não altera UX de envio (composer, drag-drop, etc.).
- Não migra mensagens históricas (só novas têm os campos).
