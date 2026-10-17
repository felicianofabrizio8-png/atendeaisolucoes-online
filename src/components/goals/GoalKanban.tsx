// src/components/goals/GoalKanban.tsx
import { useState } from "react";
import { MoreHorizontal, Plus, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedTabs } from "@/components/layout/MobileSections";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Goal, GoalProgress } from "@/lib/goals/model";
import type { GoalStage } from "@/lib/goals/api";
import { GoalCard } from "./GoalCard";
import { StageManager } from "./StageManager";

const NONE = "__none";

export function GoalKanban({
  goals,
  progress,
  stages,
  members,
  canManage,
  onMove,
  onOpen,
  onSaveStage,
  onRemoveStage,
}: {
  goals: Goal[];
  progress: Map<string, GoalProgress>;
  stages: GoalStage[];
  members: Array<{ id: string; name: string }>;
  canManage: boolean;
  onMove: (goalId: string, stageId: string | null) => void;
  onOpen: (goal: Goal) => void;
  onSaveStage: (stage: Partial<GoalStage> & { name: string }) => void;
  onRemoveStage: (id: string, moveTo: string | null) => void;
}) {
  const isMobile = useIsMobile();
  const [managing, setManaging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const columns = [
    ...stages.map((s) => ({ id: s.id, name: s.name, hue: s.hue })),
    { id: NONE, name: "Sem etapa", hue: 0 },
  ];
  const [mobileColumn, setMobileColumn] = useState(columns[0].id);
  const visible = isMobile ? columns.filter((c) => c.id === mobileColumn) : columns;

  return (
    <div className="gl-kanban-wrap">
      <div className="mb-3 flex items-center justify-between gap-2">
        {isMobile ? (
          <SegmentedTabs
            label="Etapas"
            value={mobileColumn}
            onChange={setMobileColumn}
            tabs={columns.map((c) => ({
              id: c.id,
              label: `${c.name} · ${goals.filter((g) => (g.stageId ?? NONE) === c.id).length}`,
            }))}
          />
        ) : (
          <span />
        )}
        {canManage && (
          <button type="button" className="gl-ghost" onClick={() => setManaging(true)}>
            {stages.length ? (
              <Settings2 className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {stages.length ? "Etapas" : "Criar etapas"}
          </button>
        )}
      </div>
      <div className="gl-kanban" data-mobile={isMobile || undefined}>
        {visible.map((column) => {
          const items = goals.filter((g) => (g.stageId ?? NONE) === column.id);
          return (
            <section
              key={column.id}
              role="region"
              aria-label={column.name}
              className="gl-column"
              data-over={over === column.id || undefined}
              onDragOver={(e) => {
                if (!canManage) return;
                e.preventDefault();
                setOver(column.id);
              }}
              onDragLeave={() => setOver((o) => (o === column.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) onMove(id, column.id === NONE ? null : column.id);
              }}
            >
              <h3 className="gl-column-title">
                {column.id !== NONE && (
                  <i style={{ background: `oklch(0.66 0.17 ${column.hue})` }} />
                )}
                {column.name} <span>{items.length}</span>
              </h3>
              <div className="space-y-3">
                {items.map((goal) => (
                  <div
                    key={goal.id}
                    draggable={canManage}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", goal.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <GoalCard
                      goal={goal}
                      progress={progress.get(goal.id)}
                      members={members}
                      onOpen={onOpen}
                      footer={
                        canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="gl-card-move"
                                aria-label={`Mover ${goal.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {columns
                                .filter((c) => c.id !== (goal.stageId ?? NONE))
                                .map((c) => (
                                  <DropdownMenuItem
                                    key={c.id}
                                    onSelect={() => onMove(goal.id, c.id === NONE ? null : c.id)}
                                  >
                                    {c.name}
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null
                      }
                    />
                  </div>
                ))}
                {items.length === 0 && <p className="gl-empty">Nenhuma meta aqui.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onSave={onSaveStage}
          onRemove={onRemoveStage}
        />
      )}
    </div>
  );
}
