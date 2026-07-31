// Modelo puro que converte uma definição de colunas de tabela em um "card"
// mobile. Separado do JSX para permitir teste unitário sem DOM.

export type ColumnRole = "primary" | "secondary" | "badge" | "field";

export interface ResponsiveColumnMeta {
  id: string;
  header: string;
  /** Papel da coluna na versão card (mobile). Padrão: "field". */
  role?: ColumnRole;
  /** Oculta a coluna no card mobile (mantém na tabela desktop). */
  hideOnMobile?: boolean;
  align?: "left" | "right";
}

export interface CardSlots {
  primary: string | null;
  secondary: string | null;
  badges: string[];
  fields: string[];
}

/**
 * Distribui as colunas nos slots do card mobile.
 *
 * Regras (determinísticas, sem heurística oculta):
 *  · A primeira coluna com role "primary" vira o título. Se nenhuma declarar
 *    "primary", a primeira coluna visível assume esse papel.
 *  · A primeira com role "secondary" vira o subtítulo.
 *  · Colunas "badge" viram chips na linha de status.
 *  · O restante vira pares rótulo/valor.
 *  · Colunas com hideOnMobile são descartadas.
 */
export function buildCardSlots(columns: readonly ResponsiveColumnMeta[]): CardSlots {
  const visible = columns.filter((c) => !c.hideOnMobile);
  const slots: CardSlots = { primary: null, secondary: null, badges: [], fields: [] };
  if (visible.length === 0) return slots;

  const explicitPrimary = visible.find((c) => c.role === "primary");
  const primaryId = explicitPrimary?.id ?? visible[0].id;
  slots.primary = primaryId;

  for (const col of visible) {
    if (col.id === primaryId) continue;
    if (col.role === "secondary" && slots.secondary === null) {
      slots.secondary = col.id;
      continue;
    }
    if (col.role === "badge") {
      slots.badges.push(col.id);
      continue;
    }
    slots.fields.push(col.id);
  }

  return slots;
}
