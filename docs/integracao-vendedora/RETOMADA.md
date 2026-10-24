# Retomada — integração da vendedora unificada

Worktree: `C:\Users\AMD\atendeai-vendedora-unificada` — branch local `integracao/vendedora-unificada`
(base `origin/main` `ac9bc4dc`). Nada foi enviado (sem push, sem deploy, sem banco remoto).

## Estado (2026-10-23)

| Etapa | Situação | Commit |
|---|---|---|
| 0 Backups verificáveis | concluída | branch `backup/bruna-unificada-20261023`; `C:\Users\AMD\atendeai-backups\20261023-integracao-vendedora\` |
| 1 Worktree novo + linha de base | concluída | — |
| 2 Fundações, envio, follow-ups | concluída | `07a01d26`, `9db909be` |
| 3 Controles unificados da IA | concluída | `3da01459`, `12dda31d` |
| 4 Motor | concluída | `62edb9e8` |
| 5 Política de desconto | concluída | ver `git log -1` |
| 6 Adaptador de envio da Bruna/lease atrás de chave desligada | concluída | `6352bd61` |
| 7 Testes completos, build, migrations, relatório final | concluída | `6352bd61`, `78309538` + validação SQL |

Detalhes, decisões e pendências de cada etapa: `docs/integracao-vendedora/DIARIO.md`.

## Para retomar

1. `git -C C:\Users\AMD\atendeai-vendedora-unificada status` deve estar limpo.
2. Dependências: `npm install --legacy-peer-deps` (lockfile da main dessincronizado; restaurar o
   lockfile após instalar) e `npm install --no-save @testing-library/dom@10`.
3. Banco local descartável: pilha Supabase `vendedora-unificada-validacao` (portas 4732x); só o
   contêiner `supabase_db_vendedora-unificada-validacao` fica ligado. Não mexer nos contêineres
   `evolution_*` nem em outros projetos.
4. Próximo passo: etapa 6.

## Decisões pendentes do negócio

- Desligar a IA numa conversa deve valer também nos modos geral/automático?
- Qualificação automática no tick em modo assistido (hoje segue a main).
- Empresas com desconto descrito só em texto: cadastrar no cartão "Política de desconto".

## Retomada 2026-10-23 — etapas 6–7

- O adaptador Bruna foi integrado somente ao sink de texto de envios `automatic`, com a
  flag `BRUNA_WHATSAPP_TEXT_ADAPTER=enabled`; ausente ou diferente de `enabled` mantém o
  caminho legado. Follow-ups, humano, mídia, áudio, templates, orçamentos, handoff e
  vendedora externa não foram redirecionados.
- `actionId` usa o `messageClaim` estável do tick; o adaptador preserva metadados e mantém
  autorização tenant-scoped, reautorização, lease/fence, tentativa durável e dedupe já
  existentes.
- Testes direcionados: 139/139; TypeScript: 0 erros; build: OK.
- Os 5 erros `matchMedia` do teste de marketing/jsdom são preexistentes: os arquivos
  `MarketingMotion.tsx` e `marketing-ia-reorganization.test.tsx` não diferem do `HEAD`, e
  o teste passa isoladamente com os mesmos erros não tratados do ambiente.
- Banco descartável `supabase_db_vendedora-unificada-validacao` confirmado saudável; validação
  executada exclusivamente nele, sem tocar nos demais containers.
- Migrations/SQL: attempts Phase 1, reconciliação de status, política de descontos e leases
  passaram. A migration de descontos também foi reaplicada em transação e revertida com sucesso.
## Independência do Lovable — crescimento progressivo

- Planejamento registrado em `docs/independencia-lovable-crescimento.md`.
- Meta comercial: 500 empresas, com evolução controlada por faixas de 10–30, 100, 250, 500 e
  1.000+, sem declarar capacidade antes de testes de carga.
- A Etapa 1 permanece limitada a build independente, homologação separada, baseline de métricas
  e teste inicial de carga; não inclui superdimensionamento, sharding ou deploy de produção.
- Etapa 1 — build independente (branch `codex/independencia-build-lovable`): removido
  `@lovable.dev/vite-tanstack-config`; `vite.config.ts` agora declara diretamente React,
  Tailwind, aliases, TanStack Start e Nitro Cloudflare. `package.json`/lockfile sincronizados.
- Validação: TypeScript sem erros; 137 testes direcionados passaram; build independente e
  baseline Lovable passaram. Ambos transformaram os mesmos 3.953 módulos client e 1.030 SSR,
  com 551 arquivos de saída. A diferença de diretório (`dist` independente versus `.output`
  no baseline) é de layout explícito do Nitro, não incompatibilidade de rota.
- Não foram alterados gateways de IA, infraestrutura, autenticação, APIs, banco ou produção.
- Próximo bloqueio para hospedagem independente: substituir os usos restantes de gateway/serviços
  Lovable fora do escopo desta Etapa 1 e validar o runtime escolhido em homologação.
- Etapa 2 — auditoria e plano OpenAI registrados em `docs/independencia-ia-openai-auditoria.md`.
  Não houve implementação. O inventário separa Bruna já OpenAI-compatible dos consumidores ainda
  dependentes de `ai.gateway.lovable.dev`, com migração por capability e critérios de eval.

## Etapa 2A — camada central OpenAI (2026-10-23)

- Implementada camada server-only em `src/lib/ai-platform/`, baseada na Responses API e com
  adaptador Chat Completions compatível. Nenhum consumidor existente foi migrado.
- Prontos para adoção controlada: configuração por capability, `store=false` por padrão, timeout,
  retries com backoff somente para rede/timeout/429/5xx, validação de resposta, tradução de tools,
  erro tipado, estimativa de custo e sink opcional Supabase com métricas sem prompts/PII.
- O `companyId` é obrigatório no gateway e não é aceito da configuração do cliente; a chave fica
  exclusivamente no processo server. A Bruna, a vendedora antiga, a vendedora externa e os
  serviços Lovable continuam inalterados.
- Testes simulados cobrem texto, function calls, compatibilidade, isolamento de tenant, HTTPS,
  store desligado e retry. Não houve chamada real à OpenAI, alteração de secrets, banco ou deploy.
- Validação final desta entrega: testes direcionados 4/4; TypeScript sem erros; build independente
  concluído. A suíte completa teve 3.695 testes aprovados, 9 ignorados, 2 falhas sob carga em
  `quote-wizard` e 5 erros `matchMedia` não tratados em marketing/jsdom; isoladamente os 7 testes
  passaram, mantendo os erros preexistentes já documentados. O `quote-wizard` também passou isolado.
- Rollback: não há migration nem mudança de runtime nesta entrega; basta não instanciar o gateway
  nos consumidores. Cada migração futura deve usar flag por capability, comparar golden fixtures e
  reverter para o adaptador anterior sem alterar estados de atendimento.
- Próximo passo seguro: migrar uma capability auxiliar de baixo risco (follow-up/recovery) atrás
  de flag, com avaliação comparativa; não migrar Bruna antes de concluir essa validação.

## Etapa 2B — follow-up inteligente (2026-10-24)

- Implementada a primeira fatia independente: o agendamento pode usar a camada central Responses
  API por `FOLLOWUP_OPENAI_ADAPTER=enabled`; ausente ou diferente de `enabled` mantém Lovable.
- O `companyId` segue obrigatório no gateway central, `store=false` é explícito e a validação
  determinística de evidência/data continua aplicada antes de qualquer agendamento.
- Promessas explícitas do atendente humano agora são reconhecidas como `agent_promise`; prazos
  declarados pelo cliente continuam tendo precedência.
- A geração de `{{1}}` não foi alterada: o template Meta real não estava disponível no banco local;
  somente fixtures sintéticas existem nos testes. O contrato atual permanece intacto.
- Não houve envio real, migration, produção, push ou deploy.

## Etapa 2B — personalização do template (2026-10-24)

- Implementado montador determinístico de `{{1}}` preservando byte a byte o corpo aprovado:
  nome, saudação/pergunta contextual validada e frase fixa de disponibilidade.
- A OpenAI recebe o contexto existente e deve retornar somente o trecho contextual; fatos,
  valores, placeholders, quebras de linha, tamanho e pontuação são validados localmente.
- Fallback usa o contexto determinístico de orçamento/produto/objeção e evita chamada quando não
  há contexto.
- O caminho personalizado exige simultaneamente `FOLLOWUP_OPENAI_ADAPTER=enabled` e
  `FOLLOWUP_RESUME_META_VALIDATED=enabled`; ambas permanecem desligadas. Nenhum envio foi feito.

## Etapa 2B — naturalidade do follow-up (2026-10-24)

- Corrigida a exigência do trecho contextual: pergunta completa, capitalizada, com pontuação e
  sem construções artificiais de gerúndio.
- Fallbacks de orçamento, objeção, produto, decisão e ausência de contexto agora também são
  perguntas naturais. A disponibilidade permanece separada por espaço após a pergunta.
- Rehomologação local: 15 cenários válidos; TypeScript sem erros. Flags continuam desligadas.

## Correção do retorno vazio OpenAI (2026-10-24)

- Auditoria real da Responses API: resposta `200`, dois itens em `output` (`reasoning` e
  `message`), conteúdo `output_text` dentro de `message`; `output_text` no topo não foi
  fornecido. O teste anterior usava limite 80 e consumia os tokens em raciocínio, sem mensagem.
- Gateway agora extrai explicitamente `output_text`, registra `status`, motivo de incompletude e
  `reasoning_tokens`, e rejeita resposta sem texto nem tool call como erro explícito.
- Follow-up usa orçamento mínimo de 256 tokens; flags permanecem desligadas.
- Reteste real com três contextos fictícios: 3/3 respostas completas e mensagens finais montadas;
  custo estimado total US$ 0,0001671. Sem WhatsApp, produção ou deploy.

## Coordenação dos três modos de follow-up (2026-10-24)

- Automático, manual e campanhas em massa continuam usando o motor Meta/WhatsApp e os gates
  existentes; o envio real permanece desligado por `RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND`.
- Criada coordenação server-only em `src/lib/followup/coordination.ts`: por empresa e lead,
  contatos `sent`/`simulated` do follow-up e destinatários de campanhas recentes são consultados
  antes de novo contato. Automático/manual usam `ai_followup_min_hours_between`; campanhas usam
  janela conservadora de 24 horas.
- A trava impede duplicidade entre motores, sem chamada OpenAI para a verificação rotineira. Opt-out,
  autorização, takeover humano, limites, templates e idempotência existentes permanecem ativos.
- Nenhuma migration ou alteração remota foi necessária; flags continuam desligadas.
