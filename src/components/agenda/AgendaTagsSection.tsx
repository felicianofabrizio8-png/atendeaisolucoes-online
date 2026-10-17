import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgendaTag } from "./agenda-model";

const HUES = [280, 250, 210, 170, 135, 60, 25, 340];

/**
 * Tags em Personalizar: as da empresa (só gestão cria, edita e exclui) e as minhas
 * (cada pessoa organiza a própria agenda). Nada vem pronto.
 */
export function AgendaTagsSection({
  tags,
  me,
  manager,
  onCreate,
  onUpdate,
  onRemove,
}: {
  tags: AgendaTag[];
  me: string;
  manager: boolean;
  onCreate: (input: { name: string; hue: number; personal: boolean }) => Promise<unknown>;
  onUpdate: (id: string, changes: { name?: string; hue?: number }) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <TagGroup
        title="Tags da empresa"
        hint={
          manager ? "Valem para toda a equipe." : "Criadas pela gestão da agenda. Você pode usar."
        }
        tags={tags.filter((tag) => tag.owner_id === null)}
        editable={manager}
        personal={false}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
      <TagGroup
        title="Minhas tags"
        hint="Só você vê. Para organizar a sua agenda."
        tags={tags.filter((tag) => tag.owner_id === me)}
        editable
        personal
        onCreate={onCreate}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    </div>
  );
}

function TagGroup({
  title,
  hint,
  tags,
  editable,
  personal,
  onCreate,
  onUpdate,
  onRemove,
}: {
  title: string;
  hint: string;
  tags: AgendaTag[];
  editable: boolean;
  personal: boolean;
  onCreate: (input: { name: string; hue: number; personal: boolean }) => Promise<unknown>;
  onUpdate: (id: string, changes: { name?: string; hue?: number }) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [hue, setHue] = useState(HUES[tags.length % HUES.length]);
  async function create() {
    if (!name.trim()) return;
    await onCreate({ name: name.trim(), hue, personal });
    setName("");
    setHue(HUES[(tags.length + 1) % HUES.length]);
  }
  return (
    <section aria-label={title}>
      <h3 className="ag-mono">{title}</h3>
      <p className="mt-1 text-xs text-[var(--ag-muted)]">{hint}</p>
      <ul className="mt-3 space-y-2">
        {tags.map((tag) => (
          <li
            key={tag.id}
            className="flex items-center gap-3 rounded-2xl border border-[var(--ag-edge)] px-4 py-2.5"
          >
            {editable ? (
              <button
                type="button"
                aria-label={`Trocar cor de ${tag.name}`}
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ background: `oklch(0.7 0.08 ${tag.hue})` }}
                onClick={() =>
                  onUpdate(tag.id, { hue: HUES[(HUES.indexOf(tag.hue) + 1) % HUES.length] })
                }
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ background: `oklch(0.7 0.08 ${tag.hue})` }}
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
            {editable && (
              <button
                type="button"
                className="ag-icon-btn !h-8 !w-8"
                aria-label={`Excluir ${tag.name}`}
                onClick={() => onRemove(tag.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {!tags.length && (
          <li className="rounded-2xl border border-dashed border-[var(--ag-edge-strong)] px-4 py-3 text-xs text-[var(--ag-muted)]">
            Nenhuma tag aqui ainda.
          </li>
        )}
      </ul>
      {editable && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            aria-label="Escolher cor"
            className="h-9 w-9 shrink-0 rounded-full border border-[var(--ag-edge)]"
            style={{ background: `oklch(0.7 0.08 ${hue})` }}
            onClick={() => setHue(HUES[(HUES.indexOf(hue) + 1) % HUES.length])}
          />
          <input
            className="ag-field !h-9"
            value={name}
            maxLength={40}
            aria-label={personal ? "Nova tag pessoal" : "Nova tag da empresa"}
            placeholder={personal ? "Nova tag pessoal" : "Nova tag da empresa"}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
          />
          <button
            type="button"
            className="ag-btn !py-1.5"
            disabled={!name.trim()}
            onClick={() => void create()}
          >
            Criar
          </button>
        </div>
      )}
    </section>
  );
}
