# Diagnóstico administrativo de integrações WhatsApp

Este diagnóstico é read-only. Ele identifica, por empresa, leads WhatsApp sem
`integration_id`, conversas afetadas, mensagens sem integração, eventos da Meta
sem integração correspondente e violações de isolamento entre tenants.

Arquivo de consultas: [`whatsapp-integration-diagnostic.sql`](./whatsapp-integration-diagnostic.sql).

## Regra de identidade

Para WhatsApp, `integrations.external_account_id` representa o
`phone_number_id` da Meta. Uma evidência aceitável precisa manter, na mesma
linha lógica, os dois vínculos:

```text
company_id do registro = company_id da integração
e
phone_number_id da Meta = integrations.external_account_id
```

`leads.phone`, `messages` sem `integration_id`, `from_wa_id` e número exibido
não são chaves de associação. O telefone do cliente pode aparecer no relatório
apenas como contexto fora deste SQL, nunca como base para recomendar um
backfill.

## Como ler os candidatos

- `deterministic_candidate_from_existing_message_integration`: o lead está sem
  `integration_id`, mas mensagens já persistidas na mesma empresa carregam um
  `integration_id` válido; o relatório mostra o(s) `phone_number_id` decorrente(s).
  É um candidato para revisão administrativa, não uma alteração automática.
- `ambiguous_multiple_meta_phone_number_ids`: há evidência de mais de um número
  Meta na mesma conversa/histórico. Não escolher um número.
- `not_determinable_without_meta_phone_number_id`: não existe evidência
  determinística suficiente no schema atual. Não tentar resolver por telefone.

Mensagens sem `integration_id` são reportadas como afetadas, mas ficam sem
candidato por definição: o registro não tem `phone_number_id` próprio. Eventos
em `whatsapp_unmapped_events` só podem ser relacionados à empresa por igualdade
exata de `phone_number_id` com uma integração WhatsApp; se o mesmo ID estiver em
mais de um tenant, o resultado é colisão e deve ser tratado como incidente de
isolamento.

## Formato do relatório de candidatos

O resultado da consulta 2 já é o relatório operacional. Para cada linha,
preserve pelo menos:

| Campo | Uso |
| --- | --- |
| `company_id`, `lead_id` | escopo do tenant e registro afetado |
| `affected_conversations`, `affected_messages` | impacto mensurável |
| `evidence_phone_number_ids` | IDs Meta observados via `messages.integration_id` |
| `candidate_status` | decisão permitida pelo diagnóstico |

Somente o status `deterministic_candidate_from_existing_message_integration`
pode seguir para conferência manual do administrador. Mesmo nesse caso, o
diagnóstico não autoriza backfill: é necessário confirmar o
`phone_number_id` na Meta e revisar o histórico antes de qualquer mudança
posterior, fora do escopo deste documento.

## Execução segura

1. Trabalhe em uma réplica, snapshot ou cópia de homologação mascarada. Não
   use URL, credencial ou sessão de produção.
2. Use uma conexão administrativa somente-leitura. Prefira um papel que não
   tenha `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP` ou
   acesso a funções de escrita.
3. Antes de colar o arquivo, habilite proteção de sessão:

   ```sql
   SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
   BEGIN READ ONLY;
   SET LOCAL statement_timeout = '60s';
   -- cole/executa apenas os SELECTs do arquivo
   ROLLBACK;
   ```

   Se a ferramenta não aceitar `BEGIN READ ONLY`, execute cada consulta em uma
   sessão configurada como read-only e confirme que não há comandos extras.
4. Para um único tenant, troque somente `NULL::uuid` nos blocos que têm
   `params` por um UUID previamente confirmado. Não remova os predicados de
   `company_id` nem transforme joins compostos em joins apenas por telefone.
5. Salve os resultados com acesso restrito, sem `text`, tokens, payloads ou
   prévias de mensagem. O SQL retorna IDs operacionais, contagens e IDs Meta;
   isso é suficiente para triagem.
6. Se a execução retornar violação de isolamento, pare a análise cruzada entre
   tenants. Não faça backfill, merge, update, alteração de schema, mudança em
   Railway ou deploy como parte deste diagnóstico.

## Checklist de revisão administrativa

- Confirmar que cada linha tem `channel = 'whatsapp'` quando aplicável.
- Confirmar que todo `integration_id` usado como evidência pertence à mesma
  `company_id` do lead, conversa ou mensagem.
- Confirmar o `phone_number_id` no painel/registro oficial da Meta antes de
  qualquer ação posterior.
- Não escolher entre múltiplas integrações usando `phone`, `external_id` do
  cliente, nome, horário ou proximidade temporal.
- Tratar “sem evidência” como resultado válido e encaminhar para investigação
  manual da origem do webhook, sem criar backfill.

## Escopo e limites

As consultas não chamam a Meta, não consultam produção por conta própria, não
escrevem em banco e não criam views, tabelas, índices ou funções. Elas também
não prescrevem uma correção. A ausência de `phone_number_id` em
`conversations`/`messages` é reportada como limitação do modelo, não preenchida
por inferência.
