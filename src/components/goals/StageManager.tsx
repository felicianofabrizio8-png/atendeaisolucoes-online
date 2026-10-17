// src/components/goals/StageManager.tsx
import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { GoalStage } from "@/lib/goals/api";

export function StageManager({
  stages,
  onClose,
  onSave,
  onRemove,
}: {
  stages: GoalStage[];
  onClose: () => void;
  onSave: (stage: Partial<GoalStage> & { name: string }) => void;
  onRemove: (id: string, moveTo: string | null) => void;
}) {
  const [name, setName] = useState("");
  const swap = (index: number, dir: -1 | 1) => {
    const other = stages[index + dir];
    if (!other) return;
    onSave({ ...stages[index], position: other.position });
    onSave({ ...other, position: stages[index].position });
  };
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[94vw] max-w-[420px] space-y-4">
        <SheetTitle>Etapas das metas</SheetTitle>
        <p className="text-sm text-muted-foreground">
          As colunas do kanban. Só você define quais são.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onSave({ name: name.trim(), position: stages.length });
            setName("");
          }}
        >
          <input
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-transparent px-4 text-sm"
            placeholder="Ex.: Planejada"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nome da etapa"
          />
          <button type="submit" className="lq-primary">
            Adicionar
          </button>
        </form>
        <ul className="space-y-2">
          {stages.map((stage, index) => (
            <li
              key={stage.id}
              className="flex items-center gap-2 rounded-2xl border border-border px-3 py-2"
            >
              <input
                className="min-w-0 flex-1 bg-transparent text-sm"
                defaultValue={stage.name}
                maxLength={40}
                aria-label={`Renomear ${stage.name}`}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== stage.name &&
                  onSave({ ...stage, name: e.target.value.trim() })
                }
              />
              <button
                type="button"
                aria-label={`Subir ${stage.name}`}
                onClick={() => swap(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Descer ${stage.name}`}
                onClick={() => swap(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Excluir ${stage.name}`}
                onClick={() => {
                  const others = stages.filter((s) => s.id !== stage.id);
                  const target = others.length
                    ? window.prompt(
                        `Mover as metas de "${stage.name}" para qual etapa?\n${others.map((s) => s.name).join(", ")}\n(deixe vazio para "Sem etapa")`,
                      )
                    : "";
                  if (target === null) return;
                  onRemove(
                    stage.id,
                    others.find((s) => s.name.toLowerCase() === target.trim().toLowerCase())?.id ??
                      null,
                  );
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
