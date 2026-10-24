# Independência do Lovable — crescimento progressivo

## Objetivo

Evoluir o Atende Aí para aproximadamente 500 empresas, mantendo um caminho seguro para
1.000 ou mais, sem pagar por capacidade ociosa antes de haver demanda. Este documento é
planejamento da Etapa 1 de independência do Lovable; não autoriza deploy, alteração de
produção ou migração de dados.

Capacidade só será declarada depois de testes de carga representativos. A quantidade de
empresas, isoladamente, não é métrica suficiente: volume de mensagens, picos, uso de IA,
mídia e jobs agendados determinam o dimensionamento.

## Princípios permanentes

- Manter o Supabase existente como banco, autenticação, storage, realtime e Edge Functions.
- Isolar toda operação por `company_id`/tenant, com autorização no servidor e RLS quando aplicável.
- Manter `BRUNA_WHATSAPP_TEXT_ADAPTER` desligada por padrão e sem ativação automática.
- Usar filas, leases, fencing, idempotency keys e tentativas duráveis para trabalho assíncrono.
- Separar o processamento pesado de mídia do frontend/API.
- Não executar dois consumidores Meta para o mesmo webhook durante cutover.
- Monitorar saturação antes de aumentar recursos; não escalar com base apenas em número de clientes.

## Fases comerciais e operacionais

Os números abaixo são faixas de planejamento, não limites garantidos.

| Fase | Empresas-alvo | Estratégia | Critério para avançar |
|---|---:|---|---|
| A | 10–30 | Runtime econômico, Supabase existente e worker de mídia separado | Teste de carga aprovado e p95 estável no pico simulado |
| B | até 100 | Separar filas de webhook, IA e mídia; limitar concorrência por empresa | Backlog não cresce por mais de 15 min no pico |
| C | até 250 | Escalar API/worker horizontalmente e revisar consultas quentes | CPU/memória e conexões do banco abaixo de 70% no pico |
| D | até 500 | Limites por tenant, prioridades de fila e observabilidade completa | Teste de carga do cenário de 500 aprovado |
| E | 1.000+ | Particionamento operacional ou separação de workloads conforme métricas | Decisão baseada em gargalo medido |

Até a fase C, evitar banco adicional, Kubernetes ou múltiplos serviços permanentes. O worker
de renderização continua separado por usar Docker/FFmpeg e ter perfil de consumo distinto da API.

## Métricas e gatilhos

- p50/p95/p99 de webhook, inbox e envio;
- taxa de erro, timeout, retry e `externalRequestSent`;
- tamanho e idade máxima das filas;
- mensagens por minuto e duração do tick;
- contenção/expiração de leases, claims duplicados e fencing rejeitado;
- tokens, custo e latência por chamada de IA;
- CPU, memória, I/O, locks, conexões e consultas lentas do banco;
- jobs de mídia pendentes, duração e falhas de FFmpeg;
- eventos Meta duplicados, fora de ordem e rejeitados por tenant.

Alertas iniciais: p95 acima do SLO por 10 minutos, fila crescendo por 15 minutos, erro acima
de 2%, contenção de lease anormal ou banco acima de 70% de CPU/conexões. Esses valores são
gatilhos para investigação, não capacidade comprovada.

## Custos por cenário

Estimativas de planejamento em USD/mês, sem domínio, impostos, Meta, IA ou tráfego excepcional.

| Cenário | Infraestrutura base | IA | Meta | Processamento |
|---|---|---|---|---|
| 10–30 | Supabase existente + runtime pequeno + worker atual | variável; quotas por empresa | variável por conversa/template | worker atual, baixa concorrência |
| 100 | mesma base, observabilidade e filas | quotas, cache e limites | variável por uso | 1–2 workers conforme medição |
| 250 | API/filas separadas e possível aumento do Supabase | orçamento por tenant | variável | workers horizontais |
| 500 | capacidade reservada após teste | rate limit e controle de picos | variável | prioridades e múltiplos workers |
| 1.000+ | revisão orientada por métricas | possível roteamento por custo | variável | workloads separados e redundância |

O custo deve ser acompanhado por empresa ativa e por conversa resolvida. Não assumir crescimento
linear de custos apenas pelo número de empresas.

## Escopo da Etapa 1

1. Remover a dependência de build do Lovable em mudança isolada e reproduzível.
2. Definir homologação independente com secrets fora do código.
3. Validar compatibilidade das rotas no runtime escolhido.
4. Criar baseline e teste de carga mínimo para 10–30 empresas simuladas.
5. Manter Supabase, Meta, worker e Bruna sem alteração de produção.

Ficam fora: sharding, réplica de leitura, migração de banco, troca de provedor Meta, reescrita
de todos os fluxos de IA Lovable e dimensionamento para 500 sem evidência de carga.

## Riscos principais

- Duplicidade de webhook ou resposta: consumidor único, idempotência por evento e dedupe por tenant.
- Vazamento entre empresas: autorização server-side, RLS e testes negativos.
- Fila sem limite: backpressure, limite por empresa e alerta de idade.
- Pico de IA: timeout, retry com jitter, circuit breaker e orçamento.
- Runtime incompatível: matriz de rotas e teste antes do cutover.
- Banco saturado: consultas medidas, limites de conexão e aumento gradual.
- Mídia consumindo API: worker separado, fila própria e concorrência controlada.
- Rollback incompleto: ambiente anterior preservado e migrations apenas aditivas.

## Estado

Registro somente de planejamento. Nenhum deploy, push, alteração de produção, migration remota
ou ativação da Bruna foi executado como parte desta atualização.
