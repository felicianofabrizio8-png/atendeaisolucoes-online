// Extraído de src/routes/configuracoes.tsx (Sprint 7 — Fase 7.1).
// Conteúdo idêntico ao original: apenas movido para reduzir o tamanho da rota.

import { useState } from "react";
import { XCircle, Plus, Pencil, Trash2, X } from "lucide-react";
import { addLossReason, updateLossReason, removeLossReason } from "@/data/settings";

export function LossReasonsSection({ reasons }: { reasons: string[] }) {
  const [newReason, setNewReason] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleAdd = () => {
    if (!newReason.trim()) return;
    addLossReason(newReason);
    setNewReason("");
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(reasons[index]);
  };

  const commitEdit = () => {
    if (editingIndex === null) return;
    updateLossReason(editingIndex, editingValue);
    setEditingIndex(null);
    setEditingValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <XCircle className="h-4 w-4 text-[var(--status-lost)]" />
        <h2 className="text-sm font-semibold">Motivos de perda</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Quando você marcar um lead como{" "}
        <span className="font-semibold">perdido</span> na conversa, vai escolher
        um destes motivos. Eles entram automaticamente nos relatórios para
        você entender por que está perdendo vendas.
      </p>

      <ul className="space-y-1.5">
        {reasons.map((reason, index) => (
          <li
            key={`${index}-${reason}`}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
          >
            {editingIndex === index ? (
              <>
                <input
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={commitEdit}
                  className="text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-[11px] font-semibold rounded-md border border-border bg-background px-2 py-1 hover:bg-accent"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{reason}</span>
                <button
                  onClick={() => startEdit(index)}
                  aria-label="Editar"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => removeLossReason(index)}
                  aria-label="Excluir"
                  disabled={reasons.length <= 1}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-border">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          Adicionar motivo
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="text"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="Ex.: Cliente sumiu após orçamento"
            className="flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleAdd}
            disabled={!newReason.trim()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>
        {reasons.length <= 1 && (
          <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <X className="h-3 w-3" /> É preciso manter ao menos um motivo
            cadastrado.
          </p>
        )}
      </div>
    </section>
  );
}
