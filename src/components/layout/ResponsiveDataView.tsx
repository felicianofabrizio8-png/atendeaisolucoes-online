import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  buildCardSlots,
  type ResponsiveColumnMeta,
} from "@/lib/responsive/table-model";

export interface ResponsiveColumn<T> extends ResponsiveColumnMeta {
  cell: (row: T) => ReactNode;
}

interface ResponsiveDataViewProps<T> {
  columns: ReadonlyArray<ResponsiveColumn<T>>;
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string;
  /** Conteúdo exibido quando não há linhas. */
  emptyState?: ReactNode;
  className?: string;
  /** Rótulo acessível da tabela. */
  label?: string;
}

/**
 * Tabela no desktop, cards empilhados no mobile.
 *
 * Substitui o padrão `overflow-x-auto + <table>`, que no celular obriga o
 * usuário a rolar horizontalmente. Aqui nenhuma informação é perdida: as
 * colunas viram título, subtítulo, chips e pares rótulo/valor no card.
 */
export function ResponsiveDataView<T>({
  columns,
  rows,
  getRowKey,
  emptyState,
  className,
  label,
}: ResponsiveDataViewProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const slots = buildCardSlots(columns);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const col = (id: string | null) => (id ? byId.get(id) : undefined);

  return (
    <div className={className}>
      {/* Mobile: cards */}
      <ul
        className="flex flex-col gap-2 md:hidden"
        aria-label={label}
        data-testid="responsive-data-cards"
      >
        {rows.map((row, i) => {
          const primary = col(slots.primary);
          const secondary = col(slots.secondary);
          return (
            <li
              key={getRowKey(row, i)}
              className="rounded-xl border border-border bg-background/40 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {primary ? (
                    <div className="text-sm font-medium text-foreground break-words">
                      {primary.cell(row)}
                    </div>
                  ) : null}
                  {secondary ? (
                    <div className="mt-0.5 text-xs text-muted-foreground break-words">
                      {secondary.cell(row)}
                    </div>
                  ) : null}
                </div>
                {slots.badges.length > 0 ? (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {slots.badges.map((id) => (
                      <span key={id}>{col(id)?.cell(row)}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              {slots.fields.length > 0 ? (
                <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
                  {slots.fields.map((id) => {
                    const c = col(id);
                    if (!c) return null;
                    return (
                      <div key={id} className="contents">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {c.header}
                        </dt>
                        <dd className="min-w-0 break-words text-xs text-foreground">
                          {c.cell(row)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Desktop: tabela */}
      <div className="hidden md:block">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    "py-2 px-2 font-medium",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={getRowKey(row, i)} className="border-b border-border/50 hover:bg-muted/30">
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn("py-2 px-2", c.align === "right" ? "text-right" : "text-left")}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
