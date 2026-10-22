// Apresentação do catálogo (somente leitura): cor da categoria, iniciais,
// desconto e a ficha técnica que o card e o painel de detalhes exibem.
import type { Product } from "@/data/products";
import { attributeRowsFromSpecifications } from "@/lib/catalog-facts";

/** Tons da paleta Lume (violeta → orquídea → magenta → coral, com um azul). */
const HUES = [272, 292, 318, 336, 250, 12];

export function categoryHue(category: string): number {
  let hash = 0;
  for (const char of category.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

export function productInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "P";
}

export function hasPromo(product: Product): boolean {
  return !!product.promoPrice && product.promoPrice < product.price;
}

/** Desconto da promoção em % inteiro (0 sem promoção). */
export function discountPercent(product: Product): number {
  if (!hasPromo(product)) return 0;
  return Math.round((1 - product.promoPrice! / product.price) * 100);
}

export function displayPrice(product: Product): number {
  return hasPromo(product) ? product.promoPrice! : product.price;
}

export function categoryLabel(category: string): string {
  return category.trim() || "Sem categoria";
}

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export interface ProductFact {
  label: string;
  value: string;
}

/** Campos principais preenchidos (medidas, capacidade, formato, modelo, SKU). */
export function mainFacts(product: Product): ProductFact[] {
  const facts: ProductFact[] = [];
  const dims = [product.lengthM, product.widthM, product.depthM];
  if (dims.some((value) => value != null)) {
    facts.push({
      label: "Medidas",
      value: `${dims.map((value) => (value != null ? number(value) : "—")).join(" × ")} m`,
    });
  }
  if (product.capacityL != null)
    facts.push({ label: "Capacidade", value: `${number(product.capacityL)} L` });
  if (product.shape) facts.push({ label: "Formato", value: product.shape });
  if (product.model) facts.push({ label: "Modelo", value: product.model });
  if (product.sku) facts.push({ label: "SKU", value: product.sku });
  return facts;
}

/** Características tipadas, como a Vendedora as enxerga. */
export function attributeFacts(product: Product): ProductFact[] {
  return attributeRowsFromSpecifications(product.specifications).map((row) => ({
    label: row.label,
    value: row.unit ? `${row.value} ${row.unit}` : row.value,
  }));
}

/** Variantes como rótulos curtos ("Azul", "Grande · Branco"). */
export function variantLabels(product: Product): string[] {
  return (product.variants ?? [])
    .map((variant) =>
      Object.values(variant)
        .filter((value) => typeof value === "string" || typeof value === "number")
        .map(String)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(" · "),
    )
    .filter(Boolean);
}

export type QuickFilter = "todos" | "promo" | "semFoto";
export type ProductSort = "padrao" | "nome" | "menor" | "maior";

export const SORTS: { id: ProductSort; label: string }[] = [
  { id: "padrao", label: "Ordem do catálogo" },
  { id: "nome", label: "Nome (A–Z)" },
  { id: "menor", label: "Menor preço" },
  { id: "maior", label: "Maior preço" },
];

/** Busca, categoria ou filtro rápido ativos (fora do modo "navegar"). */
export const isFiltering = (props: {
  query: string;
  category: string | null;
  quick: QuickFilter;
}) => !!props.query.trim() || props.category !== null || props.quick !== "todos";
