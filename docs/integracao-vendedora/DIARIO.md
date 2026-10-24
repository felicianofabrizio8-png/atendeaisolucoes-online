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
## Independência do Lovable — planejamento de crescimento (2026-10-23)

- A estratégia progressiva foi registrada em `docs/independencia-lovable-crescimento.md`.
- O objetivo é começar com aproximadamente 10–30 empresas e avançar por gatilhos observáveis
  para 100, 250, 500 e 1.000+, sem afirmar capacidade antes de teste de carga.
- Permanecem invariantes o isolamento por empresa, autorização server-side/RLS, filas, leases,
  fencing, idempotência, limites por tenant e Bruna desligada por padrão.
- A Etapa 1 foi mantida sem ampliação: build independente, homologação separada, baseline e
  carga mínima. Nenhum código, banco, credencial, serviço, deploy ou push foi alterado.
## Etapa 1 — build independente do Lovable (2026-10-23)

- Branch local isolada: `codex/independencia-build-lovable`, criada a partir do commit
  documental da integração da Bruna.
- Substituído o wrapper `@lovable.dev/vite-tanstack-config` por configuração explícita com
  `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-tsconfig-paths`, `@tanstack/react-start`
  e `nitro` no preset `cloudflare-module`, preservando alias, dedupe, proteção de imports,
  `nodeCompat`, saída server/client e portas de desenvolvimento.
- Removida a dependência do `package.json` e do lockfile. Nenhum gateway de IA ou infraestrutura
  foi modificado.
- TypeScript: passou sem erros. Testes direcionados da integração: 6 arquivos, 137 passaram.
- Build independente: passou; client, SSR e Nitro Cloudflare gerados. Baseline com a configuração
  anterior: também passou. Ambos transformaram 3.953 módulos client e 1.030 SSR e produziram
  551 arquivos. A única diferença observada foi o layout de saída (`dist` explícito na nova
  configuração e `.output` no wrapper anterior).
- Avisos mantidos: chunks grandes, imports dinâmicos/estáticos sobrepostos, diretivas `use client`
  ignoradas pelo bundler e opção Rollup `platform` desconhecida; presentes no build e sem falha.
- Pendência: os usos restantes de gateway/serviços Lovable em IA auxiliar, preview auth, CORS e
  documentação não foram tratados nesta etapa. Nenhum deploy, push, migration ou produção foi tocado.
## Etapa 2 — auditoria e planejamento de IA OpenAI (2026-10-23)

- Auditoria somente de leitura concluída; nenhum código, banco, credencial, serviço ou ambiente
  remoto foi alterado.
- Inventário completo registrado em `docs/independencia-ia-openai-auditoria.md`, incluindo Bruna,
  vendedora externa, Coach, follow-ups, memória, treinamento, Lume, marketing, recuperação,
  narrativa executiva, visão, áudio, transcrição e geração de imagens.
- Constatação principal: Bruna/Lume/Coach suggest já usam endpoints OpenAI-compatible em parte do
  sistema; follow-ups, Coach Interpreter/Teach Mode, marketing, recovery, narrativa, mídia e várias
  rotas `api.ai.*` ainda usam diretamente o gateway Lovable.
- Plano: adaptador server-only OpenAI, schemas versionados, isolamento por empresa, ledger de uso,
  quotas, custo por tenant, migração por capability e golden set comparativo. Nenhuma migração foi
  implementada nesta etapa.

## Etapa 2A — implementação incremental da camada OpenAI (2026-10-23)

- Criada `src/lib/ai-platform/` com cliente server-only nativo para Responses API, configuração
  de modelos por capability, timeout, retry seguro, erros tipados, parsing de `message` e
  `function_call`, estimativa de custo e adaptadores Chat Completions compatíveis.
- Criado sink opcional para `BillingCollector`/`HealthCollector`, registrando empresa, capability,
  modelo, tokens, latência e custo em micro-USD; nenhum prompt, resposta, dado pessoal ou chave é
  gravado. `store` permanece desligado por padrão.
- Nenhum consumidor foi alterado: Bruna, vendedora antiga/externa, follow-ups, Coach, marketing,
  mídia, áudio, memória, Meta e infraestrutura continuam no caminho atual. Não houve migration,
  alteração de secrets, chamada real à OpenAI, push ou deploy.
- Validação da nova camada: 4 testes simulados passaram; TypeScript passou. Teste inicial revelou
  retry sem backoff para 429 e foi corrigido antes da validação final.
- Validação final: suíte completa com 3.695 testes passando, 9 ignorados, 2 falhas de timeout/estado
  somente sob carga em `quote-wizard` e 5 erros não tratados `matchMedia` no marketing/jsdom. Os
  7 testes de marketing passaram isoladamente (os 5 erros continuam preexistentes) e o `quote-wizard`
  passou isoladamente. Build independente passou com os avisos já conhecidos do bundler.
- Rollback desta entrega é por ausência de adoção: remover a instanciação/flag do consumidor futuro
  mantém o adaptador atual. Próxima migração deve ser uma capability auxiliar, com fixtures
  comparativas, limite por empresa, observabilidade e fallback explícito.

## Etapa 2B — follow-up inteligente (2026-10-24)

- Criado `src/lib/followup/openai-adapter.server.ts`, server-only, usando a camada central de
  Responses API. A adoção exige `FOLLOWUP_OPENAI_ADAPTER=enabled`; o padrão continua desligado.
- `next-contact-ai.ts` seleciona OpenAI somente com a flag ligada, mantendo a validação local de
  JSON, evidência literal e horizonte de 60 dias. O caminho Lovable continua como fallback.
- `next-contact.ts` e `cycles.ts` reconhecem compromissos explícitos do atendente humano
  (`agent_promise`) sem inferir datas de mensagens operacionais. O prazo do cliente é prioritário.
- Geração econômica/coerente de `{{1}}` não foi migrada: o texto real de `chamar_novamente` não
  estava acessível localmente; nenhum corpo aprovado foi presumido ou alterado.
- O envio em massa permanece limitado aos fluxos existentes de simulação/dispatch; nenhum envio
  real foi executado.
- Testes direcionados: 4 arquivos, 77 testes aprovados. TypeScript sem erros. Build completo
  aprovado, com avisos já conhecidos do bundler/Nitro.
- Pendência: disponibilizar cópia local/autorizada do template real por empresa e então migrar a
  geração de `{{1}}` atrás de flag, com avaliação comparativa sem envio.

## Etapa 2B — personalização do template (2026-10-24)

- Implementado `buildResumeTemplateVariable` para preencher apenas `{{1}}`; prefixo, sufixo,
  quebras de linha e texto aprovado de `chamar_novamente` não são reescritos.
- A composição é determinística: primeiro nome + `tudo bem?` + trecho contextual da IA +
  `Estou à disposição para o que precisarem`. A IA recebe o contexto já existente e é instruída
  a devolver somente o trecho, sem nome, saudação, disponibilidade, preço ou promessa inventada.
- Validação rejeita placeholders, valores monetários, quebras de linha, pontuação duplicada,
  corpos incompatíveis e mensagens acima de 1.024 caracteres. Sem contexto, usa fallback sem IA.
- O dispatch só usa essa composição quando `FOLLOWUP_OPENAI_ADAPTER=enabled` e
  `FOLLOWUP_RESUME_META_VALIDATED=enabled`; por padrão segue o caminho anterior. A confirmação
  autorizada de compatibilidade Meta ainda é pendência, portanto a personalização está desativada.
- Testes cobrem decisão familiar, orçamento pendente, vendedor/promessa via contexto, fallback e
  rejeições de fatos inválidos. Direcionados: 75 aprovados; TypeScript e build aprovados.

## Etapa 2B — correção de naturalidade (2026-10-24)

- `normalizeResumeQuestion` passou a exigir pergunta completa, capitalização inicial e pontuação;
  respostas com `retomando`, `ver se`, `saber se`, `entender se` e equivalentes são rejeitadas.
- Fallbacks foram reescritos para perguntas naturais, preservando fatos existentes e sem inventar
  preço, prazo ou condição.
- A montagem final continua preservando o texto Meta e o sufixo `, tudo bem?`; o trecho da IA e
  a disponibilidade ficam separados por pontuação/espaço adequado.
- Rehomologação: 15 cenários simulados aprovados; 5 mensagens finais conferidas manualmente;
  testes direcionados 67/67 e TypeScript aprovados. Nenhuma chamada paga ou envio real.

## Correção do retorno vazio OpenAI (2026-10-24)

- Causa comprovada: o modelo `gpt-6-luna` retornou `reasoning` antes de `message/output_text`;
  com `max_output_tokens=80`, os 80 tokens foram consumidos pelo raciocínio e não houve texto.
- O gateway passou a extrair o texto de `output[].content[].type=output_text`, expor status,
  incompletude e tokens de raciocínio, e falhar explicitamente quando não houver texto/tool call.
- O orçamento mínimo do adaptador de follow-up passou para 256 tokens, sem alterar flags.
- Mocks: 78 testes aprovados. TypeScript aprovado. Reteste real: 3/3 gerações completas com
  contexto fictício, custo estimado US$ 0,0001671 e mensagens `chamar_novamente` válidas.

## Coordenação automático/manual/em massa — 2026-10-24

- O dispatch comum agora bloqueia contato recente do mesmo lead quando já houve follow-up
  enviado/simulado ou campanha enviada, sempre com escopo de empresa. A origem do contato é
  preservada no motivo do bloqueio.
- O dispatcher de campanhas aplica a mesma consulta antes da preparação/dispatch, mantendo
  personalização preparada uma única vez e evitando chamadas OpenAI rotineiras duplicadas.
- Kill switch de envio real, autorização Meta, opt-out, limites e flags de IA não foram ativados.
- Validação: TypeScript passou; 6 suítes relevantes passaram (69 testes). Um teste antigo de
  `relationship-campaign-preview` falhou porque ainda espera a frase artificial anterior à correção
  de naturalidade; a implementação atual devolve o fallback natural já homologado. Não é regressão
  desta coordenação.

## Homologação dos modos de follow-up — 2026-10-24

- A expectativa obsoleta da campanha foi atualizada para a pergunta contextual natural; as
  validações de nome, placeholders, pontuação e conteúdo inválido permanecem ativas.
- A primeira execução encontrou e corrigiu uma regressão: o cooldown bloqueava tentativas
  legítimas do próprio ciclo. A consulta agora exclui somente o `cycle_id` corrente e mantém o
  bloqueio entre ciclos/modos.
- Simulação: 100 clientes, 2 empresas, respostas, compras/encerramentos, opt-out, horários,
  contatos simultâneos, isolamento e limites diário/horário esgotados. Não existe ainda um
  bloqueio de saldo de créditos no motor de follow-up; isso fica como pendência de produto.
  Suíte final: 154/154 testes;
  TypeScript e build aprovados.
- Flags de produção continuam desligadas; não houve envio real, push, deploy ou alteração remota.

## Auditoria de carteiras para follow-up — 2026-10-24

- Encontrado somente `billing_usage_events`: medição append-only de tokens/chamadas/mensagens,
  sem saldo financeiro. O `credits_exhausted` existente é erro do provedor em fluxo específico,
  não carteira do Atende Aí.
- Não existem reservas, débitos idempotentes, estornos ou saldo Meta/WhatsApp por empresa; não foi
  seguro implementar bloqueio ou cobrança sem inventar uma fonte de saldo.
- Plano mínimo: `company_wallets`, `wallet_ledger` e `wallet_reservations`, com unicidade de
  idempotency key, RPCs transacionais reserve/commit/release, tabela de preços versionada,
  isolamento RLS e proteção server-only. Débito só após sucesso; falha libera/estorna reserva.
- Manual humano permanece fora do bloqueio automático por padrão; essa política precisa ser
  aprovada antes da implementação. Nenhuma alteração de código, banco ou serviço foi feita.
- Testes de regressão dos três modos: 154/154 aprovados.

## Base financeira do Atende Aí — 2026-10-24

- Implementada base SQL local para `company_wallets`, `wallet_ledger`, `wallet_reservations`,
  `wallet_plan_versions` e `wallet_price_versions`. Plano comercial: R$499/mês; créditos
  mensais independentes de R$50 IA e R$50 WhatsApp; renovação depende de RPC chamada após pagamento
  confirmado e não acumula. Recargas aumentam somente o bucket persistente.
- Reserva usa alocação mensal primeiro e recarga depois; commit debita; falha libera. Chaves de
  idempotência são escopadas por empresa/carteira. RLS limita leitura ao administrador e RPCs ao
  `service_role`.
- Integração nos três modos é opt-in: automático e campanhas usam wallet WhatsApp; IA follow-up
  usa wallet IA; manual humano não é bloqueado. Sem tarifas de Meta/OpenAI inventadas.
- Mercado Pago ficou somente no contrato `ConfirmedWalletPayment`; verificação de assinatura,
  webhook e cobrança real continuam pendentes.
- Validação: migration aplicada diretamente no `supabase_db_vendedora-unificada-validacao`, o
  banco descartável documentado, sem reiniciar/remover outros containers. SQL transacional passou
  em criação de 2 wallets por empresa, isolamento, RLS para usuário sem vínculo, reserva, débito,
  release, idempotência e renovação mensal sem acumular; duas reservas concorrentes deram uma
  reserva e uma recusa por saldo insuficiente. Registros temporários foram removidos.
- CLI Supabase permanece indisponível; isso não impediu a validação direta via PostgreSQL local.

## Homologação comercial definitiva da Bruna — 2026-10-24

- Adicionada a suíte `bruna-commercial-homologation.test.ts` com três fixtures fictícias independentes: Acme Piscinas (Pix 5% autorizado), Lar Móveis (sem desconto) e Move Bikes (condição sujeita a confirmação humana). Cada fixture inclui catálogo, preço, política, histórico de decisão familiar/orçamento/promessa e continuidade.
- A execução passou pelo `SalesAgentCore` e pela `runSafetyLayer`, sem transporte externo. Resultado: 18/18 cenários aprovados, incluindo 15 respostas válidas e 3 bloqueios esperados para produto cruzado, desconto fora da política e promessa não comprovada.
- Isolamento por empresa, memória de treinamento/continuidade e proteção contra takeover/empresa desligada/opt-in ausente foram confirmados. Opt-out foi mantido no mecanismo de supressão de campanhas já coberto pela suíte existente; nenhuma regra nova foi inventada.
- Não há motor legado configurado para comparação real. A comparação ficou limitada às regras comerciais explícitas. Não foram feitas chamadas pagas nesta suíte, nem envios, alterações remotas ou ativação de flags.
- Validação final: TypeScript e build passaram; direcionados 77 testes e campanhas+homo 62 testes passaram. A suíte completa registrou 326 arquivos, 3.737 testes aprovados, 9 ignorados, 1 timeout em `quote-wizard` e 5 erros `matchMedia` em marketing/jsdom, iguais ao baseline anterior e fora do escopo desta integração.
