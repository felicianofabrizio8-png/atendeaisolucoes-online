# Auditoria — Caixa de Atendimento (UX/Performance)

**Modo:** READ-ONLY (nenhum código alterado nesta auditoria).
**Escopo aprovado:** relatório + implementação de P1 (Realtime) e P2 (Reordenação) no mesmo turno.
**Fora de escopo deste turno:** P3 (auditoria profunda de re-render), P4 (merge assistido de contatos), P5 (animações), P6 (painel p50/p95 em `/saude`) — ficam para turnos seguintes.

---

## 1. Fluxo de dados da Caixa

- Não há TanStack Query no caminho principal da Caixa. O núcleo é um **singleton em memória**: `src/data/leadRepo.ts:28-47` mantém `remoteLeads`, `remoteConversations`, `remoteMessages` em variáveis de módulo e um `Set<() => void>` de listeners (`:47`).
- Modo `remote` (produção) carrega três queries em paralelo em `loadRemote()` (`leadRepo.ts:284-325`): `leads`, `conversations` e a RPC `latest_messages_per_conversation` (apenas a última mensagem por conversa, `:299-307`).
- Assinatura de UI: componentes usam `useState`+`useEffect(subscribeRepo)` ou `useSyncExternalStore` para reagir. Ex.: `inbox.index.tsx:145-152` (`useRepoVersion`), `OpsCockpit.tsx:49-56` (`useRepoTick`).
- **Consequência**: qualquer mutação (mensagem chegando em qualquer conversa da empresa) dispara `notify()` (`:49-51`) e re-renderiza **todos** os assinantes. Não há fatiamento por conversa no store.

## 2. Realtime — mapa atual vs. lacunas

**Canais existentes**
| Origem | Tabela | Eventos | Ref |
| --- | --- | --- | --- |
| `leadRepo` | `messages` | INSERT + UPDATE | `leadRepo.ts:347-397` |
| `leadRepo` | `leads` | **só INSERT** | `leadRepo.ts:399-413` |
| `leadRepo` | `conversations` | `*` | `leadRepo.ts:414-438` |
| `products.ts` | `products` | `*` | `data/products.ts:123,238` |
| `quotes.ts` | `quotes` | `*` | `data/quotes.ts:55,220` |
| `useCoachAlerts` | coach_alerts | — | `hooks/useCoachAlerts.ts:57-65` |
| `AITimeline` | (própria) | — | `components/AITimeline.tsx:90` |
| `inbox.$conversationId.lazy` | (canal local extra) | — | `routes/inbox.$conversationId.lazy.tsx:2796` |

**Publicação `supabase_realtime`** — já cobre `products`, `quotes`, `conversations`, `messages`, `leads`, `whatsapp_messages` com `REPLICA IDENTITY FULL` (migrações `20260426014431`, `20260426020300`, `20260428003114`, `20260601025736`).

**Lacunas confirmadas**
- `leads`: **UPDATE e DELETE não assinados** — mudança de status, tag, nextAction, closedAt, lossReason não chega ao vivo. Só um refresh manual/troca de mensagem incidental atualiza.
- `messages INSERT` **não faz bump local do `remoteConversations`** — depende do trigger de banco emitir `conversations UPDATE` depois. Gera atraso perceptível (2 round-trips) no reordenamento da fila.
- Subscrição duplicada em `inbox.$conversationId.lazy.tsx:2796` coexiste com a global do `leadRepo`. Risco de double-notify/double-render.

**Polling** — nenhum na fila/mensagens da Caixa (bom). Polls existem em `WhatsappWindowAlert/Badge` (relógio), `index.tsx`, `NeuralIntelligencePanel` (10s), `executive-snapshot` (60s), `sales-intelligence-client` (120s), `saude.tsx` (60s), `configuracoes.tsx` (30s) — todos fora do hot-path da Caixa.

## 3. Hotspots de re-render (para P3)

- `inbox.index.tsx:172-210` — `buildSortedItems()` roda no corpo do render, sem `useMemo`. Todos os `useMemo` dependentes (`windowCounts`, `statusCounts`, `sourceCounts`, `availableLossReasons`, `:265-352`) recebem `items` como dep, mas `items` é referência nova a cada render → **memos silenciosamente inúteis**.
- `OpsCockpit.tsx:93-102` — `rankConversations` está memoizado, mas depende de `alertsByConv` (Map vindo de `useCoachAlerts`) e `favorites`. Se qualquer uma trocar de referência a cada render, o memo cai. `useRepoTick` (`:52-55`) dispara em toda mensagem/quote da empresa.
- `priority-engine.ts:82-140` — sort O(n log n) sobre todas as conversas; internamente `getMessagesFor` (`leadRepo.ts:268-273`) faz **filter + sort do array inteiro de mensagens da empresa** por chamada. Custo cresce com volume total, não com o da conversa.
- Sem virtualização em `OpsCockpit` / `inbox.index` — hoje mascarado por `.slice(0,25)` / `.slice(0,8)`, que **trunca a UI em vez de virtualizar**.
- Keys estáveis (`conv.id`) — OK.

## 4. Fila e ordenação

- `rankConversations()` (`priority-engine.ts:139`) faz `Array.sort` (V8 estável desde ES2019). Empates preservam ordem de inserção, então uma inserção no meio pode causar rearranjo cosmético.
- **Ponto de bump para "cliente respondeu → topo"**: handler INSERT de `messages` no `leadRepo.ts:355-377`. Hoje só empurra mensagem e chama `notify()`; **não toca `remoteConversations`**. O patch abaixo (P2) cobre isso.

## 5. Thread de mensagens

- `loadConversationRecent(convId, 100)` (`leadRepo.ts:481-501`) — paginação preguiçosa; carga inicial de ~100 msgs.
- Virtualização com `react-virtuoso` (`inbox.$conversationId.lazy.tsx:7,3679-3724`).
- `MessageBubble` memoizado com comparador custom (`:1480`).
- Custo remanescente: `getMessagesFor` é O(total mensagens da empresa) por chamada — hotspot ao escalar. Índice por `conversationId` no repo mataria isso (P3).
- `useResolvedMediaSrc` (`:204-241`) busca signed URL por mensagem de mídia — verificar se há cache global.

## 6. Duplicação de contato (para P4)

- Único ponto com resolução de identidade: `findOrCreateLead()` em `src/routes/api.public.whatsapp.webhook.tsx:535-583`. Match por `(company_id, integration_id, external_id)` → fallback `(company_id, phone)` → insert. Faz um **backfill de campo, não merge real** (`:561-566`).
- Instagram/Facebook: nenhum equivalente em `src/routes/api.public.*` — provavelmente em Edge Function fora deste repo.
- Chaves candidatas para merge assistido: `phone` (E.164), `handle` (IG), par `(integration_id, external_id)`, `channel`.

## 7. Infra reutilizável

- Publicação `supabase_realtime` já configurada com `REPLICA IDENTITY FULL` para todas as tabelas relevantes.
- `client.ts:1-33` — cliente lazy padrão, sem tuning de Realtime (default `eventsPerSecond`). Sob carga alta, pode ser gargalo (revisar em P3).
- Padrão de módulo `subscribeRealtime` do `leadRepo` é a referência canônica — replicável para novos módulos.

## 8. Instrumentação de performance

- **Zero timing na Caixa hoje.** `performance.now()` só aparece em `AudioRecorder.tsx:227`.
- `system_health_samples` + `HealthRepository.server.ts:8-48` já existem e aceitam métricas nomeadas (`metric`, `value`, `company_id`, `tags`, `collected_at`).
- `saude.tsx:87-93` já consome via `useQuery` com `refetchInterval: 60_000`. **Base pronta para o painel p50/p95 (P6).**

---

## Classificação

**PRONTO PARA CORREÇÕES CIRÚRGICAS (P1 + P2).**

**Riscos identificados e não bloqueantes** (para próximos turnos):
- Memos falsamente estáveis no `inbox.index.tsx` — P3.
- `getMessagesFor` linear no total de mensagens da empresa — P3.
- Subscrição Realtime duplicada em `inbox.$conversationId.lazy.tsx:2796` — P3.
- Ausência de merge cross-canal — P4.
- Ausência de instrumentação p50/p95 — P6.

---

## Patches aplicados neste turno (P1 + P2)

Arquivo alterado: `src/data/leadRepo.ts` — dois blocos:

1. **P1 — `leads` UPDATE + DELETE**: adiciona dois handlers `postgres_changes` para propagar em tempo real qualquer mudança de status/tag/nextAction/lossReason/etc. Fecha a lacuna documentada em §2.
2. **P2 — bump local imediato de conversa**: dentro do handler `messages INSERT`, além de anexar a mensagem, atualiza localmente `lastMessageAt`, `unread` e `awaitingReply` da conversa correspondente. Ganho: reordenamento visível no mesmo tick da chegada da mensagem, sem esperar o trigger de banco emitir `conversations UPDATE`. Quando o UPDATE chegar em seguida, ele apenas confirma/sobrescreve o mesmo estado (idempotente).

Nenhum outro arquivo foi tocado.
