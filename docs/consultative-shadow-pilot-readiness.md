# Consultative Shadow — prontidão para piloto sintético

Data da validação: 2026-10-20

## Escopo e segurança

- Piloto executado somente com dados sintéticos.
- Empresas fictícias usadas: `synthetic-company-a` e `synthetic-company-b`.
- Nenhum cliente, conversa, produto, preço, mensagem ou canal real foi utilizado.
- Nenhuma empresa foi ativada em produção.
- Não houve migration, deploy, envio ou alteração de configuração externa.

## Resultado comprovado

O teste [consultative-sales-shadow-pilot.test.ts](../src/lib/__tests__/consultative-sales-shadow-pilot.test.ts) executou:

- 100 turnos sintéticos;
- 50 por empresa fictícia;
- isolamento de `companyId` e `conversationId` em todas as métricas;
- rollback com `consultative_shadow_enabled=false` sem execução e sem auditoria;
- zero ações de envio, pois o runtime shadow não possui integração de envio;
- p95 local do motor puro: 0,05 ms;
- p99 local do motor puro: 0,09 ms.

Esses percentis medem somente snapshot + decisão + auditoria em memória. Não representam p95/p99 de persistência Supabase.

## Persistência real

Não foi executada persistência real deliberadamente. O repositório não possui Supabase local instalado, e o `.env` disponível não contém `SUPABASE_SERVICE_ROLE_KEY` nem identifica um banco de teste separado. As URLs/chaves públicas foram tratadas como potencialmente externas e não foram usadas para inserir dados.

Para completar a validação real, é necessário um projeto Supabase de teste dedicado, com:

1. uma empresa fictícia e identificadores não reutilizados;
2. migrations já aplicadas;
3. credencial de service role exclusiva do ambiente de teste;
4. limpeza ou retenção controlada de `ai_flow_events`;
5. bloqueio explícito de Meta/WhatsApp e de qualquer outbound.

## Prontidão

Status atual: **GO para ensaio sintético/local; NO-GO para ativação de produção até validar persistência real em ambiente de teste dedicado.**

Antes de ativar uma empresa piloto real:

- confirmar a flag desligada para todos os tenants;
- criar allowlist de exatamente uma empresa;
- inserir somente configuração shadow dessa empresa no ambiente de teste;
- executar pelo menos 100 turnos sintéticos e medir p50/p95/p99 da persistência;
- verificar 100% dos eventos com `company_id` correto;
- verificar ausência de `text`, `message`, telefone, preço e conteúdo sensível no payload;
- observar zero chamadas de LLM adicionais e zero chamadas Meta/outbound;
- testar handoff e rollback com a flag desligada;
- definir limite de latência e taxa de falha para abortar o piloto;
- manter kill switch operacional para retornar a flag a `false`.

## Ativação futura controlada

1. Aprovar o tenant e registrar o identificador em allowlist operacional.
2. Confirmar backup/consulta do valor atual de `company_settings`.
3. Habilitar apenas `consultative_shadow_enabled=true` para o tenant aprovado.
4. Não habilitar modo automático, ações, follow-up ou envio.
5. Monitorar eventos `ai_flow_step` com `consultative_shadow` por janela definida.
6. Comparar latência, falhas, isolamento e volume de eventos.
7. Em qualquer anomalia, restaurar `false` e confirmar que novos eventos shadow cessaram.
8. Só ampliar o piloto após revisão dos resultados e autorização explícita.

