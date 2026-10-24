# Integração da vendedora (Bruna + vendedora da main): diário

Worktree: `C:\Users\AMD\atendeai-vendedora-unificada`, branch local `integracao/vendedora-unificada`,
base `origin/main` em `ac9bc4dc` (2026-10-16, a mais recente após `git fetch` em 2026-10-23).
Nada foi enviado ao remoto, publicado ou executado em banco remoto.

## Etapa 0: preservação

- Worktree original `C:\Users\AMD\atendeai-bruna-unificada` intacto (153 itens pendentes antes e depois).
- Branch local `backup/bruna-unificada-20261023` (`c919d371`): commit A (`7dc7c712`) = índice exato
  (alterações em stage do Codex); commit B = worktree completo, incluindo arquivos não rastreados.
  Conferido: a árvore do índice e a do worktree recalculadas batem com A e B.
- Fora do repositório, em `C:\Users\AMD\atendeai-backups\20261023-integracao-vendedora\`:
  `bruna-unificada.bundle`, `origin-main.bundle` (ambos `git bundle verify` OK), três patches
  (stage do Codex, alterações sem stage e novos, Bruna completa) e `SHA256SUMS.txt`.
- Varredura de credenciais nos arquivos pendentes e nos patches: nenhuma chave encontrada.
- O checkout principal `atendeaisolucoes-online` tinha 1 item pendente; não foi tocado.

## Etapa 1: base e linha de base

- Dependências: `package-lock.json` e `bun.lockb` da main estão fora de sincronia com o
  `package.json` (`npm ci` e `bun install --frozen-lockfile` recusam). Instalado com
  `npm install --legacy-peer-deps` e o lockfile restaurado; `@testing-library/dom` instalado com
  `--no-save` (dependência par exigida por `@testing-library/react` 16). **Pendência**: sincronizar
  os lockfiles numa mudança própria.
- `worker/render-engine` tem dependências próprias; instaladas localmente.
- Linha de base da main: TypeScript 0 erros; build (Nitro) OK; 3.339 testes, 1 falha intermitente
  sob carga (`quote-wizard`, passa isolado).

## Escopo da integração

O delta real da Bruna é o commit `d1aa895a` mais as alterações não commitadas: os três commits
anteriores da branch já existem na main (`b1bcdf20`, `a1f1f4ec`, `1c106151`). Base de merge por
arquivo: `fb347bc0`.

Fora do escopo (permanece a versão da main), por ser a frente "saída do Lovable" (troca do
provedor de IA de marketing, coach, narrativa, recuperação, mídia) e ajustes de ambiente:
`LovableChatProvider`, `ai-gateway/ai-client`, `OpenAICompatibleChatProvider`, rotas
`api.ai.{suggest,suggest-product,propose-knowledge,campaign-*,creative-generator}`,
`api.recovery.assist`, `wa-media-ai`, `marketing-ai`, `executive-narrative`, `coach-interpreter`,
`teach-mode`, `recovery-ai`, `quote-send/edge-contract`, `previewAuthStorage`, `vite.config`,
`wrangler.jsonc`, `drizzle.config`, `package*.json`, README e scripts de storage do Lovable.
Testes alterados só por portabilidade Windows também ficam como na main (passam na main).

Arquivos criados nos dois lados: `product-library`, `shared-contacts.test` idênticos;
`shared-contacts`, `send-credentials` e o adaptador da vendedora externa: fica a versão da main
(mais completa ou mais rigorosa).

## Camada 1: fundações

Portados (merge de 3 vias): módulos puros da Bruna (escopos de resposta, escopo de execução,
política de permissão, lease, adaptador de envio, memória e shadow consultivos, controle de
takeover, autorização de envio), `RuntimeStateStore` (reservas de mensagem), `MetaOutbound`,
`whatsapp/status.server`, estado comercial, auditoria, modo do agente, tipos, as 10 migrations e
testes. Conflitos resolvidos: `sales-agent-mode` (as duas funções novas mantidas),
`types.ts` (colunas dos dois lados), `send-credentials` (main). Fixture de testes atualizada com
`timeZone`/`businessDays` dos follow-ups da main.

Testes da camada: 161/163. As 2 falhas (`bruna-status-contract`) leem o código da função
`meta-webhook`, que entra na camada 2. `consultative-sales-response.test` e
`consultative-shadow-settings.test` dependem de campos do motor (camada 3).

## Camada 2: caminhos de envio

Portados: rotas `api.whatsapp.*` (envio, resposta, mídia, localização, áudio, modelos) com o
comprovante de envio emitido no servidor, `wa-templates`, conciliação de status no `meta-webhook`
(RPC `record_whatsapp_send_status`, filtro por empresa, `failed` não rebaixa `delivered`/`read`),
escolha explícita de integração no `meta-send` quando a empresa tem mais de um número.

Decisões:
- Follow-ups: a main reescreveu tudo (V2 por ciclos, envio único em `dispatch.ts`); ficou a main.
  A revalidação da main já filtra por empresa e takeover. A autorização da Bruna foi levada ao
  `dispatch.ts`: disparo manual = origem "humano"; automático/reativação = "follow-up" (bloqueia
  em takeover). Sem comprovante, o envio é bloqueado e registrado (teste novo).
- Reativação: mantidas as checagens extras da Bruna (empresa/lead da conversa, takeover, IA em
  processamento, aguardando humano), com o `select` corrigido para trazer esses campos.
  Mudança de comportamento: não reativa conversa "aguardando humano".
- Campanhas de relacionamento (só existem na main): nova origem `campaign` no comprovante; valida
  o tenant sem depender da ativação da IA. Sem comprovante, o destinatário vai para `failed` com
  nova tentativa (mesmo caminho de falha de envio).
- Lead sem `integration_id` (leads antigos/manuais): a Bruna recusava. Para preservar a função da
  main sem enfraquecer a proteção, o comprovante usa a integração da empresa só quando ela é a
  única ativa; com duas ou mais, continua recusando por ambiguidade (testes atualizados). O envio
  de modelo passou a usar a integração resolvida pelo comprovante.
- `meta-send`: mantida a regra da main (token do ambiente só para o mesmo número) e autorização de
  equipe; da Bruna, a escolha explícita de integração. CORS: origens do Lovable mantidas (a Bruna
  as removia; produção ainda roda no Lovable) e a lista configurável `CORS_ALLOWED_ORIGINS` somada.

Testes: camada 2 136/136; follow-ups e campanhas 183/183. Testes da main ajustados para o
comprovante (simulado onde o foco é o fluxo, real no teste de envio de modelo).

## Camada 3: controles unificados e migrations

Modelo único de ativação da IA (`isAutomaticReplyAllowed`, usado pelo tick, pelo comprovante de
envio e pela tela). Precedência:
1. chave-mestra `company_settings.sales_agent_master_enabled = false` bloqueia tudo;
2. takeover humano (`assumido_humano`, `aguardando_humano`, `human_takeover_at`) bloqueia;
3. empresa: com a Vendedora V2, o modo decide (silent nunca; automatic sempre; assisted só com
   opt-in da conversa); sem V2, o escopo `ai_auto_reply_scope` (desligado nunca; geral sempre;
   teste só com opt-in);
4. conversa: opt-in único `conversations.sales_agent_auto_reply` (coluna da main).

A coluna `conversations.ai_reply_enabled` da Bruna (migration nunca aplicada) foi removida da
migration `20261022090000`; todo o código passou a usar `sales_agent_auto_reply`. A tela de
controle passou a mostrar exatamente a decisão da política: a Bruna mostrava "IA desativada" para
conversa sem opt-in no escopo geral, mas a política dela respondia mesmo assim.
**Decisão pendente**: se o desligamento por conversa deve valer também nos modos geral/automático
(hoje, nas duas versões, quem para a IA numa conversa nesses modos é o takeover).

Banco local descartável (pilha Supabase própria `vendedora-unificada-validacao`, portas 4732x,
sem tocar em outros contêineres): as 189 migrations (179 da main + 10 da Bruna) aplicadas em
ordem sem erro. Aplicação feita como superusuário dentro do contêiner porque uma migration
antiga da main altera `realtime.messages`, de outro dono no Supabase local (limitação do ambiente,
não da integração). Testes SQL: `whatsapp-attempts-phase1` (inclui disputa concorrente: duas
sessões, mesma tentativa, 1 registro), `whatsapp-status-reconciliation` e
`whatsapp-attempts-phase1-homolog` (RLS positiva/negativa, privilégios, corrida) passam.

Defeitos corrigidos nos roteiros SQL da Bruna (nunca tinham rodado até o fim): `$$` aninhado em
bloco `DO $$`; `dblink_exec` com `SELECT`; `dblink_is_busy` usado como booleano; conexão não
drenada; fixture de tentativa `accepted` sem `accepted_at`; fixture de perfil incompatível com o
gatilho real de cadastro e sem vínculo/papel exigidos desde as permissões de equipe da main;
guarda que passava vazia com nulo (`<>` → `IS DISTINCT FROM`). Ajustes só do ambiente local
(não versionados): conexões `dblink` por TCP/superusuário, porque o contêiner usa `trust`/`peer`.

Padrões conferidos no banco: consultivo, shadow e V2 desligados; escopo `desligado` para empresas
novas; empresas existentes convertidas do campo legado (`geral` se respondiam, senão `desligado`).

## Camada 4 — motor da vendedora (2026-10-23)

Base: o motor da `main` (fact_claims, presented_product_ids, institutionalOnly, plano de venda,
customerContext, vendedora externa). Sobre ela, as melhorias da Bruna:

- **Envio**: `sendWhatsappText` exige comprovante de autorização e reautoriza no envio; a
  integração usada é a do comprovante; falhas informam se o pedido chegou a sair
  (`externalRequestSent`). Aviso de handoff ganhou origem própria (`handoff_notice`), bloqueada
  com takeover humano.
- **Tick**: comprovante "automatic" antes do envio; reserva persistente por mensagem
  (`claimMessageDetailed`/`finishMessageClaim`) — sem `message_id` no gatilho, a reserva vale para
  a última mensagem do cliente; mensagem anterior à ativação do escopo geral não é reservada nem
  respondida; lead precisa ser da mesma empresa da conversa antes de qualquer mutação
  (`agent_context_mismatch`); trava com `human_takeover_at` nulo.
- **Controle**: devolver a conversa para a IA não zera mais `ai_handling` (o turno em andamento
  é dono da trava; zerar permitia dois turnos paralelos e resposta duplicada). A rota confere a
  posse da conversa antes de consultar a configuração.
- **Consultivo**: orientação consultiva e observação em sombra no módulo novo
  `consultative-turn.server.ts` (opt-in por empresa, desligados por padrão; nada ali envia
  mensagem ou cria ação).
- **Validação de fatos**: caminho `fact_claims` da main intacto. No caminho legado (resposta sem
  fact_claims) e **com produto nomeado**, a checagem qualitativa passou a ser a genérica da Bruna
  (sem vocabulário de segmento): palavra de atributo afirmado precisa constar no cadastro do
  produto, nas políticas ou nos dados autorizados da empresa. Isso corrigiu nos dois sentidos:
  bloqueava fatos cadastrados (garantia do perfil, itens inclusos, "Mesa Oval formato oval" →
  handoff desnecessário) e deixava passar características inventadas fora do vocabulário de
  piscina ("aquecida", "hidromassagem", "fibra de vidro reforçada", "couro", "impermeabilizado").
  Sem produto nomeado, segue a rede de segurança da main (responde com o catálogo validado).
  Números tipados (preço, medidas, capacidade) continuam validados pelos campos da main.
- **Validação comercial** da Bruna (garantia, frete, desconto, juros, parcelas, brinde, troca)
  antes do envio de imagens.
- **Catálogo**: "12 mês" → "12 meses" (unidades de tempo por extenso concordam com a quantidade).

Contratos que mudaram nos testes (sem enfraquecer proteção): a busca devolve `basis: "focus"`
quando os produtos vêm da memória; "produto apresentado" é `presented_product_ids` (o que a
memória grava), `suggested_products` segue a semântica da main; callback repetido do gatilho
chega ao tick com o mesmo `message_id` (dedupe pela reserva, não por janela de tempo, que
descartava mensagens seguidas legítimas). Testes do adaptador externo antigo da Bruna removidos
(fica o adaptador da main).

Resultado: tsc 0 erros; suíte 3665 passam, 9 ignorados; 3 falhas só sob carga, que passam
isoladas (quote-wizard e dois testes de FFmpeg real do render-engine — já intermitentes na linha
de base).

Pendências registradas: (1) a rede de segurança legada sem produto nomeado ainda tem vocabulário
de piscina (TODO fase 2 da main); (2) qualificação automática no tick em modo assistido segue a
main (decisão de produto).

## Etapa 5 — política de desconto por empresa (2026-10-23)

- **Configuração estruturada, só do lojista**: `company_settings.ai_discount_mode`
  (`none` | `authorized` | `approval_required`) e `ai_discount_rules` (até 10
  `{percent, condition}`). Padrão `none` para todas as empresas. Migration
  `20261023090000_company_discount_policy.sql` com restrições no banco (modo válido; percentual
  em (0, 100]; condição não vazia, até 160 caracteres). Alteração só por administrador (RLS
  `admin update settings` já existente). Tela: cartão "Política de desconto" na aba Automação.
- **Uma regra, quatro caminhos** (`src/lib/discount-policy.ts`): motor (`decide`), trava pós-IA
  `runCompanySafetyLayer` usada por WhatsApp, sugestão assistida, treino e "Testar IA agora", e a
  trava da Vendedora externa. Os quatro caminhos agora usam também o mesmo conjunto de políticas
  para percentuais (antes sugestão usava só `commercial_terms`, teste e treino nenhum).
- **Comportamento**: `none` — não oferece desconto; recusar ("o valor é o cadastrado, sem
  desconto") é permitido e o pedido de desconto não vai mais direto para humano. `authorized` —
  só o percentual e a condição cadastrados (acima → bloqueio; condição diferente → bloqueio).
  `approval_required` — pedido de desconto vai para humano já na pré-checagem. O prompt recebe a
  seção "POLÍTICA DE DESCONTO" da empresa.
- **Texto livre não autoriza desconto**: "Pix com 5% de desconto" escrito em política, FAQ ou
  perfil não libera a IA a oferecer (antes a trava interna já bloqueava "desconto" sempre; a da
  Vendedora externa aceitava se estivesse no texto — agora exige a política estruturada).
  Nenhuma configuração existente foi alterada ou convertida.

Validação: 16 testes do módulo; testes da trava, pré-checagem, motor e prompt por empresa;
migration aplicada (e reaplicada, idempotente) no banco descartável `vendedora-unificada-validacao`
com padrão conferido e 5 violações recusadas. tsc 0 erros; suíte 3690 passam, 9 ignorados; 2
falhas só sob carga que passam isoladas (quote-wizard, video-studio-editor); build OK.

Limitações/pendências: (1) empresas que descreveram desconto só em texto precisam cadastrá-lo no
novo cartão para a IA oferecê-lo; (2) a Vendedora externa recebe a política só pela trava
(o serviço externo não conhece a política ao gerar a resposta); (3) "negociar", "condição
especial", "parcelo" na resposta continuam indo para humano (inalterado).

## Etapa 6 — integração do adaptador WhatsApp da Bruna (2026-10-23)

- O `sendBrunaWhatsappText` existente passou a ser usado pelo sink `sendWhatsappText` apenas
  quando a autorização é `automatic`, existe `actionId` estável do `messageClaim` e a flag
  `BRUNA_WHATSAPP_TEXT_ADAPTER` vale exatamente `enabled`. O padrão permanece desligado.
- O caminho legado continua atendendo chamadas sem claim e todas as origens não automáticas.
  Não foram alterados os caminhos de textos humanos, follow-ups, mídia, áudio, templates,
  orçamentos, handoff ou vendedora externa.
- Metadados de esclarecimento/áudio e identidade Bruna são preservados na mensagem. A
  autorização tenant-scoped é conferida antes e imediatamente antes do Graph; leases,
  fencing, tentativas duráveis e dedupe permanecem no adaptador já validado.
- Arquivos alterados: `src/lib/ai-agent.server.ts`,
  `src/lib/bruna-whatsapp-text-adapter.server.ts`, novo
  `src/lib/bruna-whatsapp-feature-flag.ts` e teste da flag.

## Etapa 7 — validação complementar (2026-10-23)

- Direcionados: 8 arquivos, 139 testes passaram.
- TypeScript (`tsc --noEmit`): passou sem erros.
- Build (`npm run build`): passou; apenas avisos já existentes do bundle/Wrangler.
- Suíte completa anterior: 3.692 passaram, 9 ignorados; o timeout do `quote-wizard` passou
  isoladamente. O teste de marketing passou isoladamente, mas emitiu 5 erros não tratados
  `matchMedia is not a function`.
- Reavaliação: os 5 erros são preexistentes, pois `MarketingMotion.tsx` e seu teste não foram
  alterados pela integração e já existem no `HEAD`; nenhuma regressão foi corrigida.
- Docker: CLI encontrada, daemon indisponível por permissão no pipe
  `dockerDesktopLinuxEngine`. As migrations não foram executadas e nenhum container foi tocado.
- Commit local: `6352bd61` (`feat(vendedora): integrar adaptador WhatsApp atrás de flag`). Não
  houve push, deploy, migration remota ou envio real.

## Fechamento da Etapa 7 — validação no banco descartável (2026-10-23)

- `supabase_db_vendedora-unificada-validacao` foi confirmado `Up (healthy)` na porta local
  `47322`; somente esse container foi inspecionado/usado. Nenhum container de outro projeto
  foi alterado, reiniciado, removido ou recriado.
- `supabase/tests/whatsapp-attempts-phase1.sql`: passou com rollback, incluindo RLS/privilégios,
  isolamento multiempresa, idempotência e corrida concorrente.
- `supabase/tests/whatsapp-status-reconciliation.sql`: passou com rollback, incluindo eventos
  fora de ordem, dedupe, monotonicidade e não associação entre empresas.
- Teste transacional adicional: migration de descontos idempotente; padrão `none`/`[]`, modos
  válidos, percentuais/condições, limite de 10 regras, constraints e compatibilidade com
  `approval_required` passaram. Leases passaram em acquire busy/valid, renew, release e fencing.
- A migration `20261023090000_company_discount_policy.sql` foi executada em transação e
  revertida, confirmando reaplicação sem erro. Os RPCs de lease permanecem indisponíveis para
  `authenticated` e disponíveis para `service_role`.
- A etapa 7 está concluída para homologação local. Não houve acesso remoto, produção, push,
  deploy ou envio real.
