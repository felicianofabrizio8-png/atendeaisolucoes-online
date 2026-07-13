import { AutonomousRuntime } from "@/lib/runtime/AutonomousRuntime.server";
import { createExecutionContext } from "@/lib/runtime/ExecutionContext.server";
import { SystemHealthAdapter } from "@/lib/runtime/SystemHealthAdapter.server";

const rt = AutonomousRuntime.instance();
const sh = rt.adapters.get("system-health") as SystemHealthAdapter;

async function runFor(tenantId: string) {
  const job = {
    id: `job-${tenantId}-${Math.random().toString(36).slice(2)}`,
    tenantId, agentId: "system-health", status: "queued",
    priority: "critical" as const, attempt: 1,
    correlationId: null, scheduledAt: new Date().toISOString(),
    payloadKind: "runtime:system-health", createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any;
  const ctx = createExecutionContext({ job, runtime: {
    registry: rt.registry, dispatcher: rt.dispatcher, scheduler: rt.scheduler,
    heartbeat: rt.heartbeat, context: rt.context,
  } });
  const r = await sh.execute(ctx);
  await sh.cleanup(ctx);
  return r;
}

// P1 - Tenant A
const r1 = await runFor("tenant-A");
console.log("R1 outcome:", r1.outcome, "stub:", r1.stub);
const latestA1 = rt.context.bus.latest("tenant-A", "system-health", "system-health");
console.log("A envelope id:", latestA1?.id, "expiresAt:", latestA1?.expiresAt, "meta.healthLevel:", latestA1?.metadata.healthLevel);
console.log("A total per topic:", rt.context.bus.cacheSnapshot().perTopic);

// P2 - Replace mesmo tenant
const r2 = await runFor("tenant-A");
const latestA2 = rt.context.bus.latest("tenant-A", "system-health", "system-health");
console.log("A after replace count:", rt.context.bus.cacheSnapshot().perTenant);
console.log("A envelope id changed:", latestA1?.id !== latestA2?.id, "publishCount:", sh.publisherSnapshot().publishCount);

// P3 - Multi-tenant
await runFor("tenant-B");
const snapPer = rt.context.bus.cacheSnapshot().perTenant;
console.log("Multi-tenant snap:", snapPer);
const lA = rt.context.bus.latest("tenant-A", "system-health", "system-health");
const lB = rt.context.bus.latest("tenant-B", "system-health", "system-health");
console.log("Isolamento: A.tenantId=", lA?.tenantId, "B.tenantId=", lB?.tenantId);

// P4 - clearTenant isolado
rt.context.bus.clearTenant("tenant-A");
console.log("After clear A: A=", rt.context.bus.latest("tenant-A","system-health","system-health"), "B present:", Boolean(rt.context.bus.latest("tenant-B","system-health","system-health")));

// P5 - failure path: força erro no execute e garante que NÃO publica
const before = sh.publisherSnapshot().publishCount;
const origExec = sh.execute.bind(sh);
(sh as any).execute = async (c:any) => { const r = await origExec(c); (sh as any).lastError = "forced"; return { ...r, outcome:"failure", error:"forced", reason:"forced" }; };
await runFor("tenant-C");
console.log("After failure publishCount unchanged:", sh.publisherSnapshot().publishCount === before);
(sh as any).execute = origExec;

// P6 - best-effort do bus: envelope inválido
const stats0 = sh.publisherSnapshot();
try {
  rt.context.publisher.publish({ topic:"system-health", agentId:"system-health", tenantId:"", metadata:{}} as any);
} catch (e:any) { console.log("bus reject empty tenant:", e.message); }
console.log("Producer connected:", sh.publisherSnapshot().connected, "errors:", sh.publisherSnapshot().publishErrors);
