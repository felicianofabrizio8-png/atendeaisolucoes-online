# EnvironmentGuard — Fundação de Homologação (Fase A)

Camada central que impede tenants classificados como `staging` de alcançar
APIs reais (Meta Graph, WhatsApp Cloud, campanhas). Solário Piscinas
permanece em `production` por default — comportamento inalterado.

## Peças

- `types.ts` — tipos puros (`EnvironmentName`, `GuardDecision`, `OutboundAction`).
- `sanitize.ts` — remoção/mascaramento de PII e credenciais. Puro, sem I/O.
- `killSwitch.ts` — `isGuardEnabled()`. Lê env var + `runtime_config` com cache 15s.
- `EnvironmentRepository.server.ts` — `getEnvironment(companyId)` com cache 30s.
- `SimulationLogger.server.ts` — persiste em `environment_simulations`.
- `EnvironmentGuard.server.ts` — `assertOutbound(action)` → `GuardDecision`.

## Contrato

```ts
await assertOutbound({
  companyId, userId, agentId,
  action: "whatsapp.send.text",
  targetUrl: url, method: "POST",
  payload: { to, text },
});
// → { proceed: true, environment: "production" | "legacy" }
// → { proceed: false, environment: "staging" | "unknown", simulationId, reason }
```

## Fail-safe

| Situação | Resultado |
|---|---|
| Kill switch OFF | `proceed: true, legacy` (Solário sem alteração) |
| `environment=production` | `proceed: true, production` |
| `environment=staging` | `proceed: false` + registra em `environment_simulations` |
| Lookup falhou / company inexistente | `proceed: false, unknown` (bloqueia por segurança) |
| Logger falhou em staging | `proceed: false, logger_failed, simulationId=null` (**ainda bloqueia**) |
| `isEnabled` lançou exceção | `proceed: true, legacy` (não derruba produção) |

Nenhuma falha de log transforma uma simulação em envio real.

## Kill switch

Duas camadas:

1. **Operacional** — `runtime_config.environment_guard_enabled` (JSONB `true`/`false`).
   Alteração propaga em ≤15s (TTL do cache). Não requer deploy.
2. **Emergência** — env var `ENVIRONMENT_GUARD_FORCE_DISABLE=true`.
   Precedência absoluta; efetivo no próximo deploy (≤3min).

## Uso via MetaOutbound

Consumidores nunca chamam o guard diretamente — chamam `postGraph()` em
`src/lib/outbound/MetaOutbound.server.ts`, que executa o guard antes de
qualquer `fetch` para `graph.facebook.com`.

## Não implementado nesta fase

- Consumidores ainda não migraram para `MetaOutbound` (Fase B).
- Painel `/admin/environments` (fase futura).
- Simulator/factories em `sandbox/` (fase futura).
