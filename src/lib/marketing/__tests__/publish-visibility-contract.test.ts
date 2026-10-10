import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("Marketing Publish visibility contract", () => {
  it("keeps the generic contents query unfiltered and scopes the Publish query", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const generic = source.slice(source.indexOf("export const listMarketingContents"), source.indexOf("function visibilityColumnError"));
    const publish = source.slice(source.indexOf("export const listMarketingPublishContents"), source.indexOf("const CleanupSchema"));

    expect(generic).not.toContain("hidden_from_publish");
    expect(publish).toContain('.eq("company_id", companyId)');
    expect(publish).toContain('.eq("hidden_from_publish", false)');
  });

  it("requires admin validation and preserves company scoping for preview and confirmation", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    expect(source).toContain('rpc("has_role"');
    expect(source).toContain('_company_id: companyId');
    expect(source).toContain("Apenas administradores da empresa");
    expect(source).toContain('.update({ hidden_from_publish: true })');
    expect(source).toContain('.eq("company_id", companyId)');
    expect(source).toContain('!row.hidden_from_publish && (!input.ids || input.ids.includes(row.id))');
    expect(source).toContain('protectedCount: alreadyHiddenCount ?? 0');
  });

  it("routes Início, Agenda and Publicar through the visible-only queries", () => {
    for (const file of ["MarketingDashboard", "MarketingSchedule", "MarketingPublishHub"]) {
      const component = read(`src/components/marketing/${file}.tsx`);
      expect(component).toContain("apiListPublishContents");
      expect(component).toContain("apiListPublishSchedule");
      expect(component).not.toMatch(/apiListContents|apiListSchedule\b/);
    }
  });

  it("hides schedule, history and indicators of hidden contents without touching the generic schedule query", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const genericSchedule = source.slice(source.indexOf("export const listMarketingSchedule"), source.indexOf("export const listMarketingPublishSchedule"));
    const publishSchedule = source.slice(source.indexOf("export const listMarketingPublishSchedule"), source.indexOf("export const cancelMarketingSchedule"));
    expect(genericSchedule).not.toContain("hidden_from_publish");
    expect(publishSchedule).toContain('.eq("company_id", companyId)');
    expect(publishSchedule).toContain('.eq("marketing_contents.hidden_from_publish", false)');

    const visibleJoin = '.eq("marketing_contents.hidden_from_publish", false)';
    expect(read("src/lib/marketing-publisher/publisher.functions.ts")).toContain(visibleJoin);
    expect(read("src/lib/marketing-publisher/PublisherAgent.server.ts")).toContain(visibleJoin);
    const repository = read("src/lib/marketing-publisher/PublisherRepository.server.ts");
    const stats = repository.slice(repository.indexOf("async stats("));
    expect(stats).toContain(visibleJoin);
    // O worker de publicação não pode depender da visibilidade: só os indicadores filtram.
    expect(repository.slice(0, repository.indexOf("async stats("))).not.toContain("hidden_from_publish");
    expect(read("src/lib/marketing-publisher/PublisherPlanner.server.ts")).not.toContain("hidden_from_publish");
  });

  it("only scans still-visible contents so repeated cleanups advance, and reports active schedules", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const cleanup = source.slice(source.indexOf("async function findMarketingCleanupCandidates"), source.indexOf("export const previewMarketingCleanup"));
    expect(cleanup).toContain('.in("status", input.statuses).eq("hidden_from_publish", false)');
    expect(cleanup).toContain("activeScheduleCount");
  });

  it("keeps migration additive and avoids an index lock in this step", () => {
    const migration = read("supabase/migrations/20261008120000_marketing_content_publish_visibility.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS hidden_from_publish boolean NOT NULL DEFAULT false");
    expect(migration).not.toContain("CREATE INDEX");
  });
});
