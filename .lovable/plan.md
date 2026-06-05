# Notificações de novas mensagens (in-app + browser/PWA)

## Objetivo
Avisar o atendente quando chega mensagem de lead em qualquer canal (WhatsApp, Instagram, Facebook, Messenger) e qualquer tipo (texto/áudio/imagem/vídeo/documento), via:
1. UI in-app (badge, contador, destaque, som opcional)
2. Notificação do navegador / PWA (com clique → conversa)
3. Configuração por usuário (som, browser, etc.)
4. Sem duplicidade

## Princípio de segurança
Tudo é **observador** do realtime existente. Nenhuma alteração em webhooks, envio, mídia, janela 24h, storage, ou no canal Supabase Realtime já validado. Pluga-se em um único ponto: o callback INSERT de `messages` no `subscribeRealtime` do `leadRepo.ts`, expondo um novo emitter dedicado — sem mexer no `notify()` atual nem na lógica de unread/conversation já validada.

## Arquivos tocados

| Arquivo | Status | Mudança | Risco |
|---|---|---|---|
| `src/lib/notifications.ts` | **NOVO** | Service único: dedupe por `message.id`/`external_id` (Set com TTL), permissão browser, `new Notification(...)`, som via `<audio>`, abre conversa via router. Lê preferências do localStorage. | Baixo (isolado) |
| `src/lib/notification-prefs.ts` | **NOVO** | Get/set preferências em `localStorage` (`atendeai.notifs.v1`): `soundEnabled`, `browserEnabled`, `permission` cache. Pub/sub. | Baixo |
| `src/data/leadRepo.ts` | **Aditivo mínimo** | Adicionar `subscribeNewLeadMessage(cb)` / `unsubscribe...` — emitter separado. No callback INSERT existente (linhas ~293-299), após o `notify()`, se `row.role === 'lead'` e não está no Set de dedupe, emite. **Não altera** nenhuma linha do fluxo atual (unread, mensagens, conversation update). | Médio — toca arquivo congelado, mas só adiciona linhas; mitigado por testes de regressão. |
| `src/components/NotificationBridge.tsx` | **NOVO** | Componente montado em `AppShell` (sem UI). No mount: assina `subscribeNewLeadMessage`, resolve nome do lead via `remoteLeads`, dispara `notifications.notify(...)`. Sabe a rota ativa via `useLocation` para suprimir notificação da conversa **já aberta e visível** (`document.visibilityState === 'visible'`). | Baixo |
| `src/components/AppShell.tsx` | **Aditivo** | Montar `<NotificationBridge />` uma única vez. Adicionar badge total no item "Caixa de atendimento" (soma de `unread` das conversas do `leadRepo`). | Baixo — não altera nav/auth/layout. |
| `src/routes/configuracoes.tsx` | **Aditivo** | Nova seção "Notificações" com 2 switches (som / browser) + botão "Pedir permissão". | Baixo |
| `public/sounds/notify.mp3` | **NOVO** | Som curto (~0.5s). Pré-carregado. | Nenhum |

**NÃO tocar:**
- `supabase/functions/meta-webhook/index.ts`
- `src/routes/api.public.whatsapp.webhook.tsx`
- `src/routes/api.whatsapp.send.tsx`, `api.whatsapp.send-media.tsx`
- `src/lib/wa-templates.server.ts` (janela 24h)
- `src/routes/inbox.$conversationId.tsx` (render de mensagens)
- Schema do banco (zero migrations)
- `manifest.json`, service worker (a feature usa só Web Notifications API; não exige SW)
- Bucket `whatsapp-media`

## Estratégia de implementação (etapas isoladas)

1. **Etapa 1 — Infra silenciosa.** Criar `notification-prefs.ts` e `notifications.ts` com dedupe + permissão + `notify()` no-op (sem som/browser ainda). Adicionar emitter `subscribeNewLeadMessage` no `leadRepo.ts` (1 if dentro do callback INSERT já existente, depois do `notify()`). Deploy. Validar: regressão WhatsApp continua passando, nada visível mudou.
2. **Etapa 2 — Bridge + badge in-app.** Montar `NotificationBridge` no `AppShell`. Implementar badge no menu (contador agregado). Sem som, sem browser ainda. Validar: badge atualiza ao chegar msg lead; não conta msg de agent.
3. **Etapa 3 — Som + browser notification + preferências.** Ligar `Notification.requestPermission()` no botão de configurações. `notify()` passa a tocar som (se ligado) e disparar `new Notification` (se ligado + permission='granted' + aba não focada na conversa). Clique → `router.navigate({ to: '/inbox/$conversationId', params })`.
4. **Etapa 4 — QA completo do checklist abaixo.**

Cada etapa é independente e revertível (delete dos arquivos novos + remover o `<NotificationBridge />`). Sem feature flag formal — a "flag" é a permissão do browser + os switches em Configurações (default OFF para browser, ON para som).

## Regras embutidas no `notifications.ts`

- **Dedupe:** `Set<string>` com TTL de 5 min, key = `message.id || external_id`. Refetch/realtime duplicado → ignora.
- **Filtro role:** só `role === 'lead'` entra; agent/ai nunca notifica.
- **Supressão contextual:** se `document.visibilityState === 'visible'` E rota atual for `/inbox/{conversationId}` da mensagem → toca som baixinho (se ligado), **não** dispara browser notification.
- **Aba em background / minimizado / outra aba:** browser notification dispara (se permitido).
- **Prévia por tipo:** `text` → texto truncado 80ch; `image` → "📷 Enviou uma imagem"; `audio` → "🎤 Enviou um áudio"; `video` → "🎥 Enviou um vídeo"; `document` → "📎 Enviou um documento"; fallback → "Enviou uma mensagem". Lê `source_subtype` / `source_metadata.media_kind`.
- **Título:** nome do lead (`remoteLeads` lookup) com fallback ao número/handle.
- **Canal-agnóstico:** baseado em `messages` table, então cobre WhatsApp/Instagram/Facebook/Messenger automaticamente.

## Risco e mitigação

| Risco | Mitigação |
|---|---|
| Quebrar realtime já validado ao tocar `leadRepo.ts` | Mudança é **aditiva**: 1 bloco `if (row.role === 'lead') emitNewLeadMessage(row)` após `notify()`. Nenhuma linha existente removida/alterada. Coberto pelo checklist de regressão. |
| Notificação duplicada por realtime + refetch | Set de dedupe por `message.id`. `refetchConversationMessages` também passa pelo emitter? Não — emitter fica **só** no callback realtime, refetch não emite (evita dupla). |
| Notificar mensagem antiga no primeiro load | Emitter só dispara em INSERT do canal realtime (que só recebe novos eventos pós-subscribe). `loadRemote` inicial não passa pelo emitter. |
| Browser bloquear `Notification` em iframe (preview Lovable) | Tratar `requestPermission` com try/catch; fallback silencioso → só badge e som. |
| Service worker não exigido | Web Notifications API funciona sem SW enquanto a aba estiver aberta. PWA "real" em background fica como follow-up futuro (exigiria SW + push subscription + backend — fora deste escopo). |
| Som autoplay bloqueado | Primeiro `play()` pode falhar se sem interação. Pré-instanciar `Audio` e tocar no primeiro clique em qualquer botão (gesture unlock); até lá só badge/browser. |
| Performance | Set com TTL + 1 listener global; custo desprezível. |

## Limitação assumida (documentar no PR)
Notificação **browser real em background com app fechado** exige Push API + service worker + servidor de push. **Fora deste escopo.** Esta entrega cobre: app aberto em qualquer aba/janela do navegador. Para PWA instalada no celular com app fechado, ficará follow-up futuro.

## Checklist de validação pós-deploy

### Regressão WhatsApp (obrigatória — não pode quebrar)
- [ ] Texto recebido (lead) aparece, sem duplicar
- [ ] Imagem recebida: thumb + Baixar + bucket OK
- [ ] Áudio recebido: player OK
- [ ] Imagem enviada (agente): persiste após reload (feature anterior intacta)
- [ ] Reply context para imagem do agente
- [ ] Reload mantém conversa
- [ ] Troca de conversa
- [ ] Realtime sem duplicar
- [ ] Janela 24h: sem `template_blocked` indevido
- [ ] `error_log` últimas 2h: zero erros novos

### Notificações (feature nova)
- [ ] Texto WhatsApp → badge incrementa + browser notif (se permitido) + som (se ligado)
- [ ] Imagem WhatsApp → notif corpo "📷 Enviou uma imagem"
- [ ] Áudio WhatsApp → notif corpo "🎤 Enviou um áudio"
- [ ] Vídeo / documento → corpo correspondente
- [ ] Instagram DM (se houver tráfego) → mesmo comportamento
- [ ] Conversa aberta em foco → **não** dispara browser notif; badge zera
- [ ] Aba em background → dispara browser notif
- [ ] Outra aba do mesmo app → dispara browser notif
- [ ] Clique na notificação → abre `/inbox/{conversationId}` certa
- [ ] Mensagem enviada pelo agente → **não** notifica
- [ ] Mensagem IA (`role='ai'` se existir) → **não** notifica
- [ ] Realtime + refetch da mesma msg → 1 única notif
- [ ] Recarregar página não re-notifica histórico
- [ ] Switch "som off" → silêncio mantém badge
- [ ] Switch "browser off" → sem notif, mantém badge + som
- [ ] Negar permissão browser → fallback silencioso, sem erro no console

Se qualquer item de regressão falhar → reverter `leadRepo.ts` ao estado anterior e remover `<NotificationBridge />` antes de investigar.

## Não inclui
- Push notification real com app fechado (precisa SW + Push API + backend)
- Notificação por e-mail
- Mute por conversa específica
- Notificação de mudança de status do lead
- iOS PWA push (requer setup separado e Safari 16.4+)
