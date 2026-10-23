# Atende Aí — inventário da vendedora, Fase 0

Este documento registra comportamento observado no código atual. As afirmações de “esperado” são critérios de evolução multissetor, não resultados que a implementação atual já garante.

## Escopo e evidência

- Fixtures e testes usam somente IDs, nomes, preços e caminhos sintéticos.
- Nenhuma tabela, integração, flag, prompt de produção ou código funcional foi alterado.
- Evidência executável: `src/lib/__tests__/sales-agent-phase0-characterization.test.ts`.
- A suíte exercita funções puras; rotas WhatsApp, Supabase, filas e envio real ficam fora do escopo para não tocar banco/produção.

## Matriz observada versus esperada

| Área | Observado no código atual | Esperado multissetor | Lacuna caracterizada |
|---|---|---|---|
| Qualificação | Heurísticas detectam UF, timing, objeções e intenção de fechamento em português; vocabulário é fixo. | Campos, sinônimos e etapas configuráveis por empresa/setor, com fallback seguro. | Baixa portabilidade linguística e setorial; não há perfil de capacidade por tenant. |
| Catálogo | Recuperação e atributos reconhecem padrões fortes de piscinas, espaço e medidas; resposta valida fatos do catálogo. | Recuperação por atributos/categoria configurável, sem semântica de piscinas no núcleo. | Hardcodes setoriais podem excluir ou ranquear mal produtos de outros setores. |
| Fotos | IDs são deduplicados; caminhos devem estar no prefixo da empresa; URLs externas são rejeitadas; há fallback específico de fibra. | Política de mídia por tenant, tipo de produto e canal, com escopo company_id obrigatório. | Fallback de fibra é específico de setor e deve ser isolado/convertido em capacidade configurável. |
| Memória | Estado sanitiza atributos, limita strings, deduplica IDs e revalida produtos ativos. | Memória versionada por conversa/tenant, com TTL, origem, confiança e proteção contra contexto obsoleto. | Não há contrato central de TenantContext nem política uniforme de retenção/confiança. |
| Score | Pontuação fixa: sinais cadastrais, timing, estágio, fechamento e -7 por objeção; faixas 0–49/50–79/80–100. | Pesos, limiares e sinais configuráveis, auditáveis e retrocompatíveis. | Score não é parametrizado por empresa e mistura vocabulário/assunções comerciais. |
| Handoff | Regex cobre desconto, negociação, parcelamento, fechamento, instalação/entrega, garantia, reclamação, contrato e jurídico; perguntas informativas têm exceção. | Matriz de risco por capability/política, com explicação, prioridade e takeover idempotente. | Cobertura lexical limitada; não há política por setor nem contrato único com follow-up. |
| Follow-up | Templates neutros, janela comercial local do runtime, humanização determinística por seed e jitter aleatório. | Templates, horário/timezone, limites, consentimento e bloqueios por estado configuráveis por tenant. | Trilha pura não prova scheduler/WhatsApp; auditoria externa aponta necessidade de validar estado `aguardando_humano`, idempotência e timezone. |
| Políticas comerciais | Regras autorizadas entram no prompt; safety bloqueia percentuais não cadastrados, desconto, negociação e promessas. | Políticas versionadas, estruturadas, com escopo, validade e capability de execução. | Texto livre e regex não substituem decisão estruturada nem governança de alterações. |
| Isolamento | Resolução de imagens e catálogo carregam filtros/escopo de company_id em pontos relevantes. | TenantContext obrigatório em toda entrada, recuperação, memória, métricas e saída. | A garantia é distribuída; falta teste transversal entre empresas/setores e enforcement centralizado. |

## O que já existe

Há componentes reutilizáveis para grounding de catálogo, resolução de imagens, estado de conversa, score/temperatura, safety de resposta, templates e humanização. Também existem testes específicos de catálogo, imagens, handoff e follow-up.

## O que falta para a Fase 0 ser uma base de evolução

1. Consolidar `TenantContext` como contrato obrigatório, carregado uma vez e propagado sem depender de IDs soltos.
2. Introduzir `AgentCapabilityProfile` para declarar capacidades, vocabulário, políticas, autonomia, handoff e mídia por empresa.
3. Migrar hardcodes de piscinas para capacidades/estratégias opt-in, mantendo fallback compatível para tenants atuais.
4. Adicionar testes de contrato entre pelo menos uma empresa de piscinas e uma de móveis/serviços, verificando não vazamento e ausência de ativação cruzada.
5. Cobrir com testes de integração isolados o scheduler de follow-up, webhook/WhatsApp, locks, idempotência e RLS sem executar isso nesta Fase 0.

## Critério de leitura

Os testes desta fase são de caracterização: uma aprovação significa “o código atual continua fazendo isto”, não “isto já atende o requisito futuro”. Qualquer mudança intencional deve atualizar primeiro a matriz observado/esperado e depois os testes de regressão.
