// Regressão: vídeo preso para sempre em "Na fila para gerar vídeo".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROCESSING_STALL_MS,
  QUEUE_STALL_MS,
  RENDER_STALL_MESSAGE,
  detectRenderStall,
  isActiveMarketingRenderStatus,
  resolveMarketingRenderState,
} from "../render-status";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

describe("detecção de job parado", () => {
  it("job recém-enfileirado é espera normal", () => {
    expect(detectRenderStall({ status: "queued", created_at: ago(20_000), available_at: ago(20_000) }, NOW)).toBeNull();
    expect(detectRenderStall({ status: "queued", created_at: ago(QUEUE_STALL_MS - 1000), available_at: ago(QUEUE_STALL_MS - 1000) }, NOW)).toBeNull();
  });

  it("REGRESSÃO: liberado na fila há mais de 5 min sem worker = fila parada", () => {
    expect(detectRenderStall({ status: "queued", created_at: ago(QUEUE_STALL_MS + 1000), available_at: ago(QUEUE_STALL_MS + 1000) }, NOW)).toBe("queue_stalled");
    // Dias na fila, como nos jobs que nunca foram consumidos.
    expect(detectRenderStall({ status: "queued", created_at: ago(3 * 86_400_000), available_at: ago(3 * 86_400_000) }, NOW)).toBe("queue_stalled");
  });

  it("intervalo entre tentativas (available_at no futuro ou recente) não é parada", () => {
    expect(detectRenderStall({ status: "queued", created_at: ago(3_600_000), available_at: ahead(120_000) }, NOW)).toBeNull();
    expect(detectRenderStall({ status: "queued", created_at: ago(3_600_000), available_at: ago(60_000) }, NOW)).toBeNull();
  });

  it("processando com sinal de vida recente não é parada; sem sinal há 15 min é", () => {
    expect(detectRenderStall({ status: "processing", locked_at: ago(14 * 60_000), updated_at: ago(30_000) }, NOW)).toBeNull();
    expect(detectRenderStall({ status: "processing", locked_at: ago(PROCESSING_STALL_MS + 5000), updated_at: ago(PROCESSING_STALL_MS + 5000) }, NOW)).toBe("processing_stalled");
  });

  it("estados finais e datas ausentes/inválidas nunca acusam parada", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(detectRenderStall({ status, created_at: ago(86_400_000), updated_at: ago(86_400_000) }, NOW)).toBeNull();
    }
    expect(detectRenderStall({ status: "queued" }, NOW)).toBeNull();
    expect(detectRenderStall({ status: "processing", updated_at: "ontem" }, NOW)).toBeNull();
    expect(detectRenderStall(null, NOW)).toBeNull();
  });
});

describe("estado mostrado na tela", () => {
  it("job parado continua ativo no banco, mas carrega o motivo da parada", () => {
    const state = resolveMarketingRenderState({ jobId: "j1", role: { job_id: "j1", job: { status: "queued", progress: 0, stall: "queue_stalled" }, video_id: null } });
    expect(state.status).toBe("queued");
    expect(isActiveMarketingRenderStatus(state.status)).toBe(true);
    expect(state.stall).toBe("queue_stalled");
    expect(RENDER_STALL_MESSAGE.queue_stalled).toContain("não está respondendo");
  });

  it("parada incoerente com o status é ignorada; vídeo pronto nunca está parado", () => {
    expect(resolveMarketingRenderState({ jobId: "j1", role: { job_id: "j1", job: { status: "failed", stall: "queue_stalled" } } }).stall).toBeNull();
    expect(resolveMarketingRenderState({ jobId: "j1", role: { job_id: "j1", job: { status: "processing", stall: "queue_stalled" } } }).stall).toBeNull();
    expect(resolveMarketingRenderState({ jobId: "j1", videoId: "v1", role: { job_id: "j1", job: { status: "queued", stall: "queue_stalled" }, video_id: "v1" } }).stall).toBeNull();
    expect(resolveMarketingRenderState({ jobId: "j1", role: { job_id: "j1", job: { status: "queued" } } }).stall).toBeNull();
  });
});

describe("nova tentativa segura (sem duplicar job)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/marketing/marketing-campaign.functions.ts"), "utf8");
  const release = source.slice(source.indexOf("async function releaseStalledRenderJob"), source.indexOf("const ApproveInput"));

  it("só libera job comprovadamente parado e sempre com UPDATE condicional ao estado", () => {
    expect(release).toContain("detectRenderStall(job, Date.now())");
    expect(release).toContain("if (!job || !stall) return false;");
    // Fila: só cancela se AINDA estiver em queued (o worker pode ter pego).
    expect(release).toMatch(/status: "cancelled"[\s\S]*?\.eq\("company_id", companyId\)\s*\.eq\("status", "queued"\)/);
    // Processamento: só falha se AINDA estiver em processing e sem sinal de vida.
    expect(release).toMatch(/status: "failed"[\s\S]*?\.eq\("company_id", companyId\)\s*\.eq\("status", "processing"\)\s*\.lt\("updated_at", cutoff\)/);
    // Só segue para criar job novo quando exatamente 1 linha foi liberada.
    expect(release).toContain("return released === 1;");
  });

  it("aprovar e tentar novamente reaproveitam job ativo, exceto se parado", () => {
    expect(source).toContain("if (inFlight && !(await releaseStalledRenderJob(supabase, companyId, previousJobId))) {");
    expect(source).toContain("activeJob && !(await releaseStalledRenderJob(supabase, companyId, activeJob.id)) ? activeJob : null");
  });

  it("o worker não consegue concluir nem reportar progresso de job que saiu de processing", () => {
    for (const route of ["complete", "progress"]) {
      const text = readFileSync(resolve(process.cwd(), `src/routes/api.public.render.${route}.tsx`), "utf8");
      expect(text).toContain('if (job.status !== "processing") return badRequest("job_not_processing");');
    }
  });

  it("o status devolvido à tela calcula a parada no servidor, restrito à empresa", () => {
    const status = source.slice(source.indexOf("export const getCampaignRenderStatus"), source.indexOf("// ------------------------------------------------- retryCampaignRender"));
    expect(status).toContain("available_at, updated_at, locked_at");
    expect(status).toContain('.eq("company_id", companyId)');
    expect(status).toContain("stall: detectRenderStall(j, now)");
  });
});
