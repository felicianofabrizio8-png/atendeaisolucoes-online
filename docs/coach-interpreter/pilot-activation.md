# Coach Interpreter — Ativação Piloto (Fase 3.3 · Etapa 2B.1)

Mecanismo operacional server-side, **fora da UI**, para habilitar/desabilitar a
flag `coach_interpreter_enabled` **apenas no tenant piloto aprovado**
(mascarado como `3a7e989c…cbeb48fd` · "Solário Piscinas").

> A autorização usa **igualdade INTEGRAL do UUID** entre o valor enviado ao
> script e o valor carregado da variável server-side `COACH_PILOT_COMPANY_ID`.
> Prefixo, sufixo, nome ou ambiente são apenas defesa em profundidade — nunca
> autorizam sozinhos. A operação usa **rollback compensatório**; NÃO é uma
> transação SQL atômica com o `audit_log`.

> Este documento é apenas operacional. **Nenhum comando abaixo foi executado**
> nesta preparação. Nenhuma flag foi alterada. Nenhum deploy foi feito.

---

## 0. Responsável humano pela decisão

- **Aprovador:** um administrador humano do projeto Atende Aí.
- **Executor:** o mesmo aprovador ou operador delegado, com acesso ao
  `SUPABASE_SERVICE_ROLE_KEY`.
- O executor **assina a decisão** preenchendo `COACH_PILOT_REASON` de forma
  auditável (ex.: `"Piloto autorizado por Rafael em 2026-07-21 (fase 3.3)"`).

---

## 1. Dry-run de ativação (padrão — não escreve nada)

```bash
COACH_PILOT_COMPANY_ID=<uuid-completo-do-piloto> \
COACH_PILOT_ACTOR_ID=<uuid-do-admin> \
COACH_PILOT_REASON="Dry-run piloto autorizado por <fulano> (fase 3.3)" \
COACH_PILOT_ACTION=enable \
COACH_PILOT_DRY_RUN=true \
APP_ENVIRONMENT=production \
SUPABASE_URL=<url> \
SUPABASE_SERVICE_ROLE_KEY=<injetado por secret store> \
bunx tsx scripts/coach-interpreter-pilot.ts
```

Esperado no `stdout` (sanitizado):

```json
{ "ok": true, "code": "dry_run_ok", "action": "enable",
  "currentState": false, "wouldChangeTo": true,
  "auditPreview": { "before": { "coach_interpreter_enabled": false }, ... } }
```

Se `code != "dry_run_ok"` → **abortar** e investigar (ver §8).

## 2. Ativação real

Apenas após o dry-run limpo e nova aprovação humana explícita:

```bash
COACH_PILOT_DRY_RUN=false \
# demais variáveis idênticas ao dry-run
bunx tsx scripts/coach-interpreter-pilot.ts
```

Esperado: `{ "ok": true, "code": "activated" }`.

## 3. Verificação pós-ativação (read-only)

- Rode a mesma invocação com `COACH_PILOT_DRY_RUN=true` novamente:
  o resultado deve ser `already_enabled`.
- Consulta operacional (via ferramenta admin de banco):
  - `company_settings` do piloto deve ter `coach_interpreter_enabled = true`.
  - Nenhuma outra empresa deve estar `true`.
  - `audit_log` deve conter uma linha nova com
    `action = "update_company_settings"`, `entity = "company_settings"`,
    `before.coach_interpreter_enabled = false`,
    `after.coach_interpreter_enabled = true`,
    `after.feature = "coach_interpreter"`,
    `after.reason` preenchido.

## 4. Smoke test funcional

- Logar como admin do tenant piloto no Atende Aí.
- Abrir `/configuracoes_/coach-interpreter` → console deve carregar
  (não retornar `COACH_INTERPRETER_DISABLED`).
- Abrir CoachPanel V1 → atalho "Console" deve aparecer para o admin.
- Enviar 1 mensagem simples ao Coach Interpreter para validar ida/volta.
- Se qualquer passo falhar → executar rollback (§5) e reportar.

## 5. Rollback

```bash
COACH_PILOT_ACTION=disable \
COACH_PILOT_DRY_RUN=false \
COACH_PILOT_REASON="Rollback piloto por <motivo>" \
# demais variáveis idênticas
bunx tsx scripts/coach-interpreter-pilot.ts
```

Esperado: `{ "ok": true, "code": "deactivated" }`.

Rollback global de emergência (kill switch): definir
`COACH_INTERPRETER_KILLSWITCH=true` no ambiente do worker/edge e re-deploy.
Isso desliga o Interpreter em **todas** as empresas, independentemente da flag
por tenant.

## 6. Verificação pós-rollback

- Dry-run `disable` → deve retornar `already_disabled`.
- `company_settings` do piloto deve ter `coach_interpreter_enabled = false`.
- Nova entrada em `audit_log` com `before.coach_interpreter_enabled = true`,
  `after.coach_interpreter_enabled = false`.
- Conversas, mensagens e propostas do Coach Interpreter permanecem intactas
  (o rollback só altera a flag).

## 7. Leitura do audit_log

Somente admins do próprio tenant (via Data API) ou operadores com
`service_role` conseguem ler. Consulta típica:

```sql
SELECT created_at, action, entity, entity_id, before, after
FROM public.audit_log
WHERE entity = 'company_settings'
  AND company_id = '<uuid-do-piloto>'
ORDER BY created_at DESC
LIMIT 20;
```

Nunca colar o UUID completo em canais públicos; use a máscara
`3a7e989c…cbeb48fd`.

## 8. Critérios para abortar

Abortar imediatamente e não repetir a operação se o script retornar qualquer
um destes códigos:

| Código                        | Significado                                    | Ação                                          |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `reason_missing`              | Motivo vazio/curto demais                      | Preencher `COACH_PILOT_REASON` corretamente   |
| `company_id_invalid`          | UUID malformado                                | Conferir variável                             |
| `company_not_pilot`           | UUID não é o piloto aprovado                   | **Não insistir** — reportar tentativa         |
| `environment_not_production`  | `APP_ENVIRONMENT` diferente de `production`    | Confirmar ambiente antes de tentar de novo   |
| `company_not_found`           | Empresa não existe no banco                    | Verificar backup / continuidade dos dados     |
| `company_name_mismatch`       | Nome divergente de "Solário Piscinas"          | **Não insistir** — reportar imediatamente     |
| `settings_not_found`          | `company_settings` ausente                     | Investigar setup do tenant                    |
| `actor_not_found`             | Usuário informado não existe                   | Conferir `COACH_PILOT_ACTOR_ID`               |
| `actor_not_admin`             | Usuário existe mas não é admin                 | Só admins podem executar                      |
| `other_tenant_enabled`        | Outra empresa já está com a flag habilitada    | Executar `disable` no outro tenant primeiro   |
| `update_no_row`               | Concorrência — flag mudou durante a operação   | Rerodar o dry-run e reavaliar                 |
| `update_multiple_rows`        | Anomalia grave (rollback já executado)         | **Escalar** — não repetir                     |
| `update_failed`               | Erro do banco                                  | Verificar `SUPABASE_URL`/rede/permissões      |
| `audit_failed_rolled_back`    | Flag foi revertida por falha no audit_log      | Investigar audit_log antes de nova tentativa  |
| `pilot_config_invalid`        | `COACH_PILOT_COMPANY_ID` ausente/vazio/inválido | Corrigir a variável no ambiente seguro; nada é lido/gravado |
| `compensation_failed`         | UPDATE alterou o banco e o rollback também falhou | **CRÍTICO** — estado inconsistente; executar rollback manual (§10) |

## 9. Segurança operacional

- **Nunca** commitar `SUPABASE_SERVICE_ROLE_KEY`. Injetar via secret store.
- **Nunca** commitar `COACH_PILOT_COMPANY_ID`. Este valor identifica o tenant
  piloto aprovado e existe SOMENTE no ambiente do executor. O runbook mostra
  apenas o placeholder `<UUID_COMPLETO_INTERNO>`; o UUID real nunca é escrito
  neste documento, em código versionado, em log, em erro ou em UI.
- Logs mostram apenas UUIDs mascarados (`3a7e989c…cbeb48fd`). Se algum log
  imprimir um UUID completo, tratar como incidente de segurança.
- O dry-run **não prossegue** se `COACH_PILOT_COMPANY_ID` estiver ausente,
  vazio ou fora do formato UUID — retorna `pilot_config_invalid` **antes** de
  qualquer leitura ou escrita no banco.
- A autorização exige **igualdade completa** entre `companyId` recebido e
  `COACH_PILOT_COMPANY_ID`. Nome da empresa e `APP_ENVIRONMENT` são validações
  adicionais e **jamais** substituem a igualdade do UUID.
- O actor precisa ser admin **do tenant piloto** (`user_roles` com `role='admin'`
  e `company_id` igual ao piloto). Admin de outro tenant é recusado.
- **Nunca** compartilhar o UUID completo em screenshots / relatórios públicos.
- **Nunca** invocar o script contra o banco de desenvolvimento sem definir
  `APP_ENVIRONMENT=development` explicitamente (o gate barra tudo que não seja
  `production`, então dev/staging retornam `environment_not_production`).
- O script **não é exposto** por rota HTTP/edge. Rodar apenas em terminal
  operacional com service_role no ambiente.

## 10. Procedimento manual em caso de `compensation_failed`

`compensation_failed` significa que:

1. o `UPDATE` em `company_settings` foi aplicado (a flag mudou de estado); e
2. o rollback compensatório também falhou (a flag pode continuar no estado novo,
   sem entrada correspondente em `audit_log`).

O script **nunca** retorna sucesso nesse caminho. Ao receber esse código:

1. **Tratar como incidente** (severidade `critical`).
2. Consultar `company_settings` do piloto para o estado real da flag.
3. Se a flag estiver no estado indesejado, executar `UPDATE` manual via
   ferramenta admin do banco (service_role) devolvendo ao estado anterior.
4. Registrar manualmente uma linha em `audit_log` explicando o incidente e o
   rollback manual (mesma forma que o mecanismo geraria).
5. **Não** repetir o script até confirmar que o estado está consistente.
6. Só então investigar a causa raiz da falha do rollback (rede, permissões,
   RLS, indisponibilidade).
