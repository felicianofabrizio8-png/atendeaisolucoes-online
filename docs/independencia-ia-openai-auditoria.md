# Etapa 2 — auditoria e plano de migração de IA para OpenAI

## Escopo e estado

Auditoria somente de leitura realizada na branch `codex/independencia-build-lovable`.
Nenhum código, banco, credencial, serviço, deploy ou configuração remota foi alterado.

O projeto tem dois padrões atuais:

1. Consumidores OpenAI-compatible configuráveis por endpoint/modelo/chave.
2. Consumidores diretos do `ai.gateway.lovable.dev`, com `LOVABLE_API_KEY` e modelos Gemini.

O `LLMGateway` já oferece cache curto, retry, fallback, billing e métricas por empresa, mas não
é usado por todos os consumidores. A migração deve primeiro tornar o contrato central completo;
depois cada funcionalidade migra sem mudar seus contratos de negócio.

## Inventário de chamadas

### Núcleo comercial

| Funcionalidade | Entrada atual | Contrato/recursos | Estado |
|---|---|---|---|
| Bruna / agente interno | `SALES_AGENT_LLM_ENDPOINT`, `_MODEL`, `_API_KEY` em `ai-agent.server.ts` | prompt longo em `sales-agent-core.ts`; tool calls `respond_to_customer`, `compare_catalog_prices`, `request_human_handoff`; `sales_plan`, qualificação, `fact_claims`, produtos e imagens | Já independente do Lovable; OpenAI-compatible |
| Vendedora externa | `EXTERNAL_SALES_AGENT_ENDPOINT` e `_API_KEY` | contrato próprio com resposta, `selected_products`, `next_action`, handoff e estado do vendedor; opt-in por empresa/modo | Serviço externo; não substituir automaticamente |
| Sugestão assistida | rota `api.ai.suggest-reply` → mesmo `runAgentTurn` da Bruna | mesmas travas de catálogo, desconto, takeover e escopo | Compartilha Bruna |
| Follow-ups | `LovableChatProvider` em `followup/next-contact-ai.ts` e `followup/resume.ts` | texto curto para próximo contato/retomada; fallback operacional | Ainda Lovable |

### Coach, memória e equipe

| Funcionalidade | Arquivos principais | Estado/contrato |
|---|---|---|
| Coach suggest | `routes/api.coach.suggest.tsx` | Já usa `SALES_AGENT_LLM_*`; tool `coach_output`, com fallback estruturado para texto |
| Coach Interpreter | `coach-interpreter.service.ts`, `types.ts` | `LovableChatProvider`, modelo `google/gemini-2.5-flash`; resposta estruturada de interpretação |
| Teach Mode / treinamento | `coach-learnings/teach-mode.service.ts` | `LovableChatProvider`; gera `rule_structured` e aprendizagem para aprovação |
| Extração histórica | `coach-learnings/historical-learning-extractor.server.ts` | Usa configuração da Bruna, mas testes/documentação ainda referenciam Lovable |
| Memória comercial | `ai-agent.server.ts`, `sales-agent-grounding.server.ts`, memória consultiva | Dados permanecem no Supabase; o LLM só sugere `sales_plan` e fatos, validados no servidor |
| Lume | `lume/config.server.ts`, `lume/agent.server.ts` | Endpoint próprio `LUME_AI_*` ou fallback para `SALES_AGENT_LLM_*`; tools por domínio e loop de execução |
| Metas/dashboard/copilot | `goals/ai.server.ts`, `dashboard-analysis.server.ts`, `atendimento/copilot-chat.server.ts` | Já OpenAI-compatible via configuração Lume ou Sales Agent; JSON mode em alguns caminhos |

### Marketing, recuperação e executivo

| Funcionalidade | Arquivos/endpoint | Modelo ou contrato atual |
|---|---|---|
| Sugestão geral | `routes/api.ai.suggest.tsx` | Lovable + `google/gemini-2.5-flash`; tool `atende_ai_suggestion` |
| Sugestão de produto | `api.ai.suggest-product.tsx` | Lovable + Gemini; tool `suggest_product` |
| Proposta de conhecimento | `api.ai.propose-knowledge.tsx` | Lovable + Gemini; tool `propose_knowledge` |
| Campaign advisor | `api.ai.campaign-advisor.tsx` | Lovable + Gemini; tool `campaign_advisory` |
| Campaign creative | `api.ai.campaign-creative.tsx` | Lovable + Gemini; tool `generate_ad` |
| Creative Generator | `api.ai.creative-generator.tsx` | Lovable chat/vision; tools `analyze_image`, `generate_variants`, `score_creative`; também image generation com `openai/gpt-image-2` pelo gateway |
| Marketing bundle | `lib/marketing/marketing-ai.functions.ts` | Lovable + Gemini; tool `generate_marketing_bundle`; produz estratégia, overlay, Story, Feed, Reel e WhatsApp |
| Recovery Assistant | `api.recovery.assist.tsx`, `recovery-ai/prompt.ts` | Lovable + Gemini; function `recovery_plan`; não envia mensagens |
| Executive narrative | `ExecutiveNarrativeService.server.ts` | Lovable + Gemini; `response_format: json_object`; narrativa, prioridades, oportunidades e riscos |

### Mídia e áudio

- `wa-media-ai.server.ts`: visão de imagens/PDFs via gateway Lovable/Gemini e transcrição via
  `https://api.openai.com/v1/audio/transcriptions`, modelo `whisper-1`.
- `supabase/functions/meta-webhook/index.ts`: transcrição best-effort de áudio recebido, com
  `OPENAI_API_KEY` e `whisper-1`; falha não interrompe o webhook.
- Copilot de atendimento aceita imagens e PDFs, mas o processamento textual usa o endpoint
  OpenAI-compatible configurado para a aplicação.
- Envio de fotos, áudio, templates, orçamentos e mensagens continua sendo responsabilidade das
  rotas/Meta/Supabase; a migração de IA não deve mover esses efeitos para o modelo.

### Chamadas que não são IA

As chamadas Graph API da Meta, Supabase, ViaCEP, storage, render worker e APIs de mídia não são
provedores de IA e não devem ser substituídas pelo gateway OpenAI. Devem apenas continuar recebendo
resultados validados da camada de IA quando aplicável.

## Dependências e riscos atuais

- Existem chamadas diretas ao Lovable fora do `LLMGateway`; por isso o billing e rate limit atual
  não cobrem necessariamente todos os usos.
- O contrato interno usa Chat Completions (`choices[].message.tool_calls`), enquanto a Responses
  API usa `output` com itens `message`, `function_call` e `function_call_output`. A migração deve
  ter um adaptador de compatibilidade, não alterar todos os consumidores de uma vez. A documentação
  oficial confirma essa diferença de formato e recomenda `store: false` quando não se deseja
  persistência remota. [Migration to Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- JSON mode atual não garante aderência ao schema. Para contratos críticos, usar Structured Outputs
  ou function calling com schema estrito; a documentação oficial diferencia function calling para
  ferramentas de `text.format`/schema para respostas estruturadas. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- A chave deve permanecer exclusivamente no servidor. O modelo não deve receber `service_role`,
  tokens Meta, IDs não autorizados ou contexto de outra empresa.
- O uso de estado remoto da Responses API não é necessário: manter memória, histórico, catálogo e
  auditoria no Supabase permite isolamento, rollback e controle de retenção do Atende Aí.

## Camada central proposta

Criar uma camada server-only, sem alterar consumidores nesta auditoria:

1. `AiProvider`: adaptador OpenAI com Responses API e tradução para o contrato interno legado.
2. `AiCapability`: `sales_agent`, `external_seller_bridge`, `coach`, `followup`, `recovery`,
   `marketing_text`, `marketing_vision`, `executive`, `lume`, `copilot`, `transcription` e `image_generation`.
3. `AiModelPolicy`: modelo, limite de tokens, timeout, prioridade, formato de saída e orçamento
   por capacidade; nunca aceitar modelo/chave vindos do cliente.
4. `AiRequestContext`: `companyId`, funcionalidade, conversa opcional, usuário/escopo, canal,
   correlation ID, action ID e classificação de dados.
5. `AiUsageLedger`: tokens de entrada/saída, cache, latência, retries, status, custo estimado,
   modelo, empresa e funcionalidade; sem armazenar prompt completo por padrão.
6. `AiBudgetGuard`: limite por empresa/dia/mês, limite global, rate limit, circuit breaker e
   fallback seguro para humano/sem ação.
7. `AiSchemaRegistry`: schemas versionados para tool calls e outputs; validação antes de qualquer
   mutação ou envio.

Configuração sugerida, somente no servidor:

```text
OPENAI_API_KEY
AI_MODEL_SALES_AGENT
AI_MODEL_COACH
AI_MODEL_FOLLOWUP
AI_MODEL_MARKETING
AI_MODEL_EXECUTIVE
AI_MODEL_TRANSCRIPTION
AI_MODEL_IMAGE_GENERATION
AI_MAX_COST_COMPANY_MONTHLY
AI_MAX_CALLS_COMPANY_DAILY
```

O custo por empresa deve ser controlado por ledger e políticas, não por chaves OpenAI individuais.

## Modelo inicial por capacidade

A seleção abaixo é hipótese de partida, sujeita a evals e disponibilidade da conta:

- Bruna, Coach Interpreter e casos de maior risco: `gpt-6.1-sol` como equilíbrio inicial.
- Follow-ups, classificação, recuperação simples, memória auxiliar e alto volume: `gpt-6-luna`.
- Marketing estratégico e casos complexos: Sol; usar Astra somente onde o eval demonstrar ganho.
- Visão: Sol para leitura crítica; Luna para triagem barata.
- Transcrição: `gpt-4o-mini-transcribe` ou `gpt-transcribe`, comparando qualidade com `whisper-1`.
- Imagens: modelo GPT Image atual após validar preservação das dimensões, formato e fluxo de
  storage; não reutilizar o nome de modelo do gateway Lovable sem um teste de saída.

Os modelos atuais e preços oficiais variam. A documentação da OpenAI lista GPT-6.1 Sol a US$ 2/M
tokens de entrada e US$ 10/M de saída, Luna a US$ 0,10/M e US$ 0,50/M, e Astra a US$ 10/M e
US$ 50/M. Transcrição publicada varia de US$ 0,003 a US$ 0,006 por minuto, conforme o modelo.
[Models](https://developers.openai.com/api/docs/models) e [Pricing](https://developers.openai.com/api/docs/pricing?latest-pricing-expanded=true)

## Migração por prioridade

### Fase 2A — contrato e observabilidade

- Congelar fixtures de prompts, schemas, ferramentas e respostas atuais.
- Implementar o adaptador OpenAI em ambiente de teste, sem substituir tráfego.
- Normalizar tokens, erros, retries, timeout, request ID e custo.
- Adicionar `companyId`, capability e correlation ID às métricas.

### Fase 2B — baixo risco

Migrar primeiro: executive narrative, goals, dashboard, copilot, recovery e follow-up. São fluxos
com efeito controlado ou revisão humana. Manter fallback sem envio automático.

### Fase 2C — Coach e conhecimento

Migrar Coach suggest, Interpreter, Teach Mode, histórico e propostas de conhecimento. Validar que
nenhuma saída vira regra ativa sem aprovação humana.

### Fase 2D — marketing e multimodal

Migrar marketing bundle, advisor, creative generator, visão, áudio e geração de imagem. Comparar
schemas, URLs/bytes, formatos, dimensões, overlays e persistência no storage.

### Fase 2E — Bruna e atendimento

Embora a Bruna já aceite endpoint OpenAI-compatible, padronizar sua chamada no adaptador central
somente depois das fases anteriores. Preservar o pipeline determinístico: catálogo, preços,
descontos, memória, imagens, orçamento, handoff, leases, claims, dedupe e envio Meta continuam
fora do controle livre do modelo.

### Fase 2F — remoção controlada do Lovable

- Rodar período de shadow/dual evaluation sem duplicar efeitos.
- Migrar uma capability por vez com flag e rollback.
- Remover `LovableChatProvider`, `LOVABLE_API_KEY` e URLs Lovable apenas quando não houver chamadas
  de runtime nem testes dependentes.

## Crescimento até 500/1.000 empresas

O número de empresas não determina capacidade. Medir chamadas, tokens, picos, mídia e filas.

| Faixa | Operação planejada | Gatilhos de escala |
|---|---|---|
| 10–30 | um gateway stateless, ledger Supabase, limites por empresa, fila simples | p95, erro, fila e custo por empresa |
| 100 | workers assíncronos separados para follow-up/marketing/transcrição | backlog, concorrência e rate limits |
| 250 | filas por capability e prioridade; cache compartilhado se necessário | CPU, conexões, latência e contenção |
| 500 | quotas por tenant, circuit breaker por provedor e orçamento rígido | custo/tokens, saturação e SLO |
| 1.000+ | separação de workloads, particionamento operacional e redundância | somente após teste de carga realista |

Não usar o armazenamento de estado remoto da OpenAI como banco da conversa. Isso evita dependência
de retenção externa e facilita isolamento/eliminação por empresa.

## Hipóteses de custo da IA

Estimativa apenas de tokens de texto; não é previsão de faturamento. Hipótese: 200 chamadas por
empresa/mês, 5.000 tokens de entrada e 700 de saída por chamada, sem considerar cache, visão,
áudio, imagens, ferramentas pagas, impostos ou descontos de volume.

| Empresas | Chamadas/mês | Tokens entrada/saída | Luna | Sol |
|---:|---:|---:|---:|---:|
| 30 | 6.000 | 30M / 4,2M | US$ 5,10 | US$ 102 |
| 100 | 20.000 | 100M / 14M | US$ 17 | US$ 340 |
| 250 | 50.000 | 250M / 35M | US$ 42,50 | US$ 850 |
| 500 | 100.000 | 500M / 70M | US$ 85 | US$ 1.700 |
| 1.000 | 200.000 | 1B / 140M | US$ 170 | US$ 3.400 |

Áudio deve ser calculado por minuto; por exemplo, 1.000 minutos/mês custariam aproximadamente
US$ 3–6 nos modelos de transcrição publicados. Imagem, visão e ferramentas devem ser adicionadas
à conta apenas com volume medido. A infraestrutura Supabase/compute permanece separada desses
valores.

## Testes comparativos e critérios de aprovação

- Golden set anonimizado com conversas reais representativas: catálogo, preço, promo, desconto,
  medida, fotos, orçamento, áudio, template, follow-up, takeover, pedido de humano e vendedora externa.
- Repetir cada caso contra o comportamento atual e o adaptador OpenAI; comparar intenção, fatos,
  IDs de produtos, preço, política de desconto, ação, handoff, texto e latência.
- Testes negativos multiempresa: empresa A nunca vê catálogo, memória, regras, mídias ou tokens de B.
- Testes de schema: tool call inválida, JSON parcial, modelo sem tool call, tool duplicada e timeout.
- Testes de segurança: prompt injection em histórico, catálogo, FAQ, imagens/PDFs e aprendizados.
- Testes de efeitos: nenhuma resposta de avaliação pode enviar Meta, criar orçamento, alterar memória
  ou ativar IA; somente o pipeline determinístico pode efetivar ações.
- Aprovação por capability: 0 vazamentos cross-tenant, 0 preço inventado, 0 duplicidade de envio,
  handoff preservado, schema válido e custo dentro do orçamento definido.

## Pendências antes de implementar

1. Definir se a primeira versão central usará Responses API com tradutor para o contrato atual ou
   Chat Completions como ponte temporária.
2. Escolher modelos iniciais após evals, especialmente para Bruna, visão e transcrição.
3. Definir SLOs, quotas e orçamento por empresa.
4. Confirmar política de retenção: preferir `store:false`, sem prompts completos em logs.
5. Inventariar e versionar schemas de todas as sete tools do núcleo e das tools de marketing/coach.
6. Obter amostra anonimizada para golden set; sem exportar dados de clientes nesta etapa.

## Critério para iniciar implementação

O planejamento estará aprovado para execução quando houver decisão sobre (a) Responses API versus
ponte Chat Completions, (b) modelos/limites iniciais, (c) retenção de dados e (d) golden set. Até
lá, todos os gateways Lovable e controles atuais permanecem intactos.
