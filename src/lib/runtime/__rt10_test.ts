import { AutonomousRuntime } from "@/lib/runtime/AutonomousRuntime.server";
import { createExecutionContext } from "@/lib/runtime/ExecutionContext.server";
import { SystemHealthAdapter } from "@/lib/runtime/SystemHealthAdapter.server";
import { ExecutiveKnowledgeAdapter } from "@/lib/runtime/ExecutiveKnowledgeAdapter.server";

const rt = AutonomousRuntime.instance();
const sh = rt.adapters.get("system-health") as SystemHealthAdapter;
const ek = rt.adapters.get("executive-knowledge") as ExecutiveKnowledgeAdapter;

function ctxFor(tenantId: string, agentId: string) {
  const job = {
    id: `job-${tenantId}-${agentId}-${Math.random().toString(36).slice(2)}`,
    tenantId, agentId, status: "queued",
    priority: "normal" as const, attempt: 1,
    correlationId: null, scheduledAt: new Date().toISOString(),
    payloadKind: `runtime:${agentId}`, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any;
  return createExecutionContext({ job, runtime: {
    registry: rt.registry, dispatcher: rt.dispatcher, scheduler: rt.scheduler,
    heartbeat: rt.heartbeat, context: rt.context,
  } });
}

async function publish(tenantId: string) {
  const c = ctxFor(tenantId, "system-health");
  await sh.execute(c);
  await sh.cleanup(c);
}

// -- Fake probe: evita chamada ao Supabase durante MISS/fallback --
(ek as any).probe = async () => ({ reason: "traditional_probe_ok", detail: { fake: true } });

// TESTE 1 — HIT
await publish("tenant-A");
const c1 = ctxFor("tenant-A", "executive-knowledge");
const r1 = await ek.execute(c1);
console.log("T1 outcome:", r1.outcome, "hit:", r1.knowledgeBus?.knowledgeBusHit, "fallback:", r1.knowledgeBus?.knowledgeBusFallback, "topic:", r1.knowledgeBus?.knowledgeTopic, "v:", r1.knowledgeBus?.knowledgeEnvelopeVersion, "age:", r1.knowledgeBus?.knowledgeEnvelopeAge, "reason:", r1.reason);

// TESTE 2 — Expira envelope => MISS, fallback=false
const latest = rt.context.bus.latest("tenant-A", "system-health", "system-health")!;
rt.context.publisher.expire(latest.id, "tenant-A");
const r2 = await ek.execute(ctxFor("tenant-A", "executive-knowledge"));
console.log("T2 outcome:", r2.outcome, "hit:", r2.knowledgeBus?.knowledgeBusHit, "fallback:", r2.knowledgeBus?.knowledgeBusFallback, "reason:", r2.reason);

// TESTE 3 — Falha do Subscriber
await publish("tenant-A");
const origLatest = rt.context.subscriber.latest.bind(rt.context.subscriber);
(rt.context.subscriber as any).latest = () => { throw new Error("bus_boom"); };
const r3 = await ek.execute(ctxFor("tenant-A", "executive-knowledge"));
console.log("T3 outcome:", r3.outcome, "hit:", r3.knowledgeBus?.knowledgeBusHit, "fallback:", r3.knowledgeBus?.knowledgeBusFallback, "reason:", r3.reason);
(rt.context.subscriber as any).latest = origLatest;

// TESTE 4 — Multi-tenant: A publica, B executa → sem cruzamento
await publish("tenant-A");
const r4 = await ek.execute(ctxFor("tenant-B", "executive-knowledge"));
console.log("T4 tenantB hit:", r4.knowledgeBus?.knowledgeBusHit, "fallback:", r4.knowledgeBus?.knowledgeBusFallback);

console.log("Telemetry:", ek.consumerTelemetry());
