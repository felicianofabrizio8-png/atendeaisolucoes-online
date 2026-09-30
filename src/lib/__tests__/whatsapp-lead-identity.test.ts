// Webhook WhatsApp (TanStack): mensagem nova não pode apagar funil/tags do lead.
import { describe, expect, it } from "vitest";
import {
  buildExistingLeadPatch,
  findOrCreateWhatsappLead,
  type ExistingLead,
  type LeadIdentityClient,
} from "../whatsapp/lead-identity";

function fakeClient(options: {
  existing: Array<ExistingLead | null>;
  insertResult?: { data: { id: string } | null; error: unknown };
}) {
  const lookups = [...options.existing];
  const updates: Array<{ values: Record<string, unknown>; filters: Array<[string, string]> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const selectFilters: Array<{ company: string; or: string }> = [];
  const client: LeadIdentityClient = {
    from: () => ({
      select: () => ({
        eq: (_c: string, company: string) => ({
          or: (filter: string) => ({
            limit: () => ({
              maybeSingle: async () => {
                selectFilters.push({ company, or: filter });
                return { data: lookups.shift() ?? null, error: null };
              },
            }),
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (c1: string, v1: string) => ({
          eq: async (c2: string, v2: string) => {
            updates.push({
              values,
              filters: [
                [c1, v1],
                [c2, v2],
              ],
            });
            return { error: null };
          },
        }),
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            inserts.push(values);
            return options.insertResult ?? { data: { id: "new-lead" }, error: null };
          },
        }),
      }),
    }),
  };
  return { client, updates, inserts, selectFilters };
}

const input = {
  companyId: "company-a",
  integrationId: "int-2",
  waId: "5511988887777",
  normalizedPhone: "5511988887777",
  leadName: "Nome do perfil WhatsApp",
};

describe("findOrCreateWhatsappLead", () => {
  it("lead existente mantém status, tags e nome", async () => {
    const { client, updates, inserts } = fakeClient({
      existing: [
        { id: "lead-1", status: "quente", integration_id: "int-1", external_id: "5511988887777" },
      ],
    });

    const id = await findOrCreateWhatsappLead(client, input);

    expect(id).toBe("lead-1");
    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ integration_id: "int-2" });
    expect(updates[0].filters).toContainEqual(["company_id", "company-a"]);
  });

  it("sem mudança de vínculo não escreve nada", async () => {
    const { client, updates } = fakeClient({
      existing: [
        { id: "lead-1", status: "fechado", integration_id: "int-2", external_id: "5511988887777" },
      ],
    });
    await findOrCreateWhatsappLead(client, input);
    expect(updates).toEqual([]);
  });

  it("lead perdido que volta a falar é reativado, como na RPC canônica", () => {
    expect(
      buildExistingLeadPatch(
        { id: "l", status: "perdido", integration_id: "int-2", external_id: "x" },
        input,
      ),
    ).toEqual({ status: "novo" });
  });

  it("lead novo é criado no tenant da integração", async () => {
    const { client, inserts, selectFilters } = fakeClient({ existing: [null] });
    const id = await findOrCreateWhatsappLead(client, input);
    expect(id).toBe("new-lead");
    expect(inserts[0]).toMatchObject({
      company_id: "company-a",
      status: "novo",
      tags: [],
      channel: "whatsapp",
    });
    expect(selectFilters[0].company).toBe("company-a");
  });

  it("corrida na criação relê o lead existente", async () => {
    const { client } = fakeClient({
      existing: [null, { id: "raced", status: "novo", integration_id: "int-2", external_id: "x" }],
      insertResult: { data: null, error: { code: "23505" } },
    });
    await expect(findOrCreateWhatsappLead(client, input)).resolves.toBe("raced");
  });

  it("filtro de busca usa apenas dígitos", async () => {
    const { client, selectFilters } = fakeClient({ existing: [null] });
    await findOrCreateWhatsappLead(client, {
      ...input,
      waId: "55119,phone.neq.0",
      normalizedPhone: "55119",
    });
    expect(selectFilters[0].or).not.toMatch(/neq/);
  });

  it("exige company_id", async () => {
    const { client } = fakeClient({ existing: [] });
    await expect(findOrCreateWhatsappLead(client, { ...input, companyId: " " })).rejects.toThrow();
  });
});

describe("webhook TanStack não usa mais o upsert destrutivo", () => {
  it("rota delega para findOrCreateWhatsappLead", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/routes/api.public.whatsapp.webhook.tsx", "utf8");
    expect(source).toContain("findOrCreateWhatsappLead");
    expect(source).not.toMatch(/onConflict:\s*"company_id,phone"/);
  });
});
