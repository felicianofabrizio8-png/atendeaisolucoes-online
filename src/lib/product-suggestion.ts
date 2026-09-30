// Catálogo usado pela sugestão de produto do inbox (/api/ai/suggest-product).
// Sempre o catálogo ativo da empresa do usuário, carregado do banco no
// servidor — nunca o store do cliente (`@/data/products`), que no servidor
// cai no seed de demonstração e é igual para todos os tenants.

export interface SuggestProductCatalogRow {
  id?: unknown;
  company_id?: unknown;
  active?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
}

export interface SuggestProductCatalogItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
}

export function buildSuggestProductCatalog(
  rows: readonly SuggestProductCatalogRow[] | null | undefined,
  companyId: string,
): SuggestProductCatalogItem[] {
  if (!companyId.trim() || !Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || row.company_id !== companyId || row.active === false) return [];
    if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim()) {
      return [];
    }
    return [
      {
        id: row.id,
        name: row.name,
        category: typeof row.category === "string" && row.category.trim() ? row.category : null,
        description:
          typeof row.description === "string" && row.description.trim() ? row.description : null,
      },
    ];
  });
}

export function formatSuggestProductCatalog(items: readonly SuggestProductCatalogItem[]): string {
  return items
    .map(
      (p) =>
        `- ${p.id} | ${p.category ?? "—"} | ${p.name}${p.description ? ` — ${p.description}` : ""}`,
    )
    .join("\n");
}
