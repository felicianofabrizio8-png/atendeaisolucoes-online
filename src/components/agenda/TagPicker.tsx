import { useState } from "react";
import { Plus } from "lucide-react";
import type { AgendaTag } from "./agenda-model";

const HUES = [280, 250, 210, 170, 135, 60, 25, 340];

/** Chips de tags (várias por compromisso) com criação na hora, no visual do Orçamentos. */
export function TagPicker({
  tags,
  selected,
  me,
  manager,
  onChange,
  onCreate,
}: {
  tags: AgendaTag[];
  selected: string[];
  me: string;
  manager: boolean;
  onChange: (ids: string[]) => void;
  onCreate: (input: { name: string; hue: number; personal: boolean }) => Promise<AgendaTag | null>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [hue, setHue] = useState(HUES[0]);
  const [personal, setPersonal] = useState(!manager);
  const companyTags = tags.filter((tag) => tag.owner_id === null);
  const myTags = tags.filter((tag) => tag.owner_id === me);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  async function create() {
    if (!name.trim()) return;
    const tag = await onCreate({ name: name.trim(), hue, personal: manager ? personal : true });
    if (!tag) return;
    onChange([...selected, tag.id]);
    setName("");
    setCreating(false);
  }

  const chip = (tag: AgendaTag) => (
    <button
      type="button"
      key={tag.id}
      aria-pressed={selected.includes(tag.id)}
      onClick={() => toggle(tag.id)}
    >
      <span
        aria-hidden="true"
        className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
        style={{ background: `oklch(0.7 0.08 ${tag.hue})` }}
      />
      {tag.name}
    </button>
  );

  return (
    <div role="group" aria-label="Tags" className="space-y-3">
      {companyTags.length > 0 && (
        <div>
          <p className="lq-hint mb-2">Da empresa</p>
          <div className="lq-chips">{companyTags.map(chip)}</div>
        </div>
      )}
      {myTags.length > 0 && (
        <div>
          <p className="lq-hint mb-2">Minhas</p>
          <div className="lq-chips">{myTags.map(chip)}</div>
        </div>
      )}
      {!tags.length && !creating && (
        <p className="lq-hint">
          Nenhuma tag ainda. Crie as tags que fazem sentido para a sua equipe.
        </p>
      )}
      {creating ? (
        <div className="space-y-3 rounded-2xl border border-white/10 p-3">
          <input
            className="quote-form-input"
            value={name}
            maxLength={40}
            autoFocus
            placeholder="Nome da tag"
            aria-label="Nome da nova tag"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
          />
          <div
            className="flex flex-wrap items-center gap-2"
            role="radiogroup"
            aria-label="Cor da tag"
          >
            {HUES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={hue === value}
                aria-label={`Cor ${value}`}
                onClick={() => setHue(value)}
                className="h-6 w-6 rounded-full ring-offset-2 ring-offset-black aria-checked:ring-2 aria-checked:ring-white"
                style={{ background: `oklch(0.7 0.08 ${value})` }}
              />
            ))}
          </div>
          {manager && (
            <div className="lq-chips" role="radiogroup" aria-label="De quem é a tag">
              <button
                type="button"
                role="radio"
                aria-checked={!personal}
                onClick={() => setPersonal(false)}
              >
                Da empresa
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={personal}
                onClick={() => setPersonal(true)}
              >
                Só minha
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="lq-secondary" onClick={() => setCreating(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="lq-primary"
              disabled={!name.trim()}
              onClick={() => void create()}
            >
              Criar tag
            </button>
          </div>
        </div>
      ) : (
        <div className="lq-chips">
          <button type="button" onClick={() => setCreating(true)}>
            <Plus className="mr-1 inline h-3.5 w-3.5 align-[-2px]" /> Nova tag
          </button>
        </div>
      )}
    </div>
  );
}
