import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  GripVertical,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Save,
  Trash2,
  X,
  Loader2,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  reorderQuickReplies,
  updateQuickReply,
  type QuickReply,
  type QuickReplyInput,
} from "@/data/quickReplies";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/configuracoes_/respostas-rapidas")({
  component: QuickRepliesPage,
});

type FormState = {
  id: string | null;
  name: string;
  icon: string;
  category: string;
  content: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  icon: "",
  category: "",
  content: "",
  active: true,
};

function errorInfo(error: unknown) {
  const maybe = error as { message?: unknown; details?: unknown };
  return {
    message: typeof maybe?.message === "string" ? maybe.message : "Falha na operação",
    details: typeof maybe?.details === "string" ? maybe.details : maybe?.details ?? null,
  };
}

function QuickRepliesPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setItems(await listQuickReplies(companyId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (q: QuickReply) => {
    setForm({
      id: q.id,
      name: q.name,
      icon: q.icon ?? "",
      category: q.category ?? "",
      content: q.content,
      active: q.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!companyId) return;
    if (!form.name.trim() || !form.content.trim()) {
      toast.error("Nome e conteúdo são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const payload: QuickReplyInput = {
        name: form.name,
        icon: form.icon,
        category: form.category,
        content: form.content,
        active: form.active,
      };
      if (form.id) {
        console.log("QUICK_REPLY_UPDATE_ATTEMPT", { id: form.id, company_id: companyId, name: form.name });
        const saved = await updateQuickReply(companyId, form.id, payload);
        console.log("QUICK_REPLY_UPDATE_SUCCESS", { id: saved.id, company_id: saved.company_id, name: saved.name });
      } else {
        console.log("QUICK_REPLY_CREATE_ATTEMPT", { company_id: companyId, name: form.name });
        const saved = await createQuickReply(companyId, {
          ...payload,
          sort_order: items.length,
        });
        console.log("QUICK_REPLY_CREATE_SUCCESS", { id: saved.id, company_id: saved.company_id, name: saved.name });
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await reload();
      toast.success("Salvo");
    } catch (e) {
      const info = errorInfo(e);
      console.error(form.id ? "QUICK_REPLY_UPDATE_ERROR" : "QUICK_REPLY_CREATE_ERROR", {
        id: form.id,
        company_id: companyId,
        name: form.name,
        error: info.message,
        details: info.details,
      });
      toast.error(info.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (q: QuickReply) => {
    if (!companyId) return;
    try {
      console.log("QUICK_REPLY_UPDATE_ATTEMPT", { id: q.id, company_id: companyId, active: !q.active });
      const saved = await updateQuickReply(companyId, q.id, { active: !q.active });
      console.log("QUICK_REPLY_UPDATE_SUCCESS", { id: saved.id, company_id: saved.company_id, active: saved.active });
      await reload();
    } catch (e) {
      const info = errorInfo(e);
      console.error("QUICK_REPLY_UPDATE_ERROR", {
        id: q.id,
        company_id: companyId,
        error: info.message,
        details: info.details,
      });
      toast.error(info.message);
    }
  };

  const remove = async (q: QuickReply) => {
    if (!companyId) return;
    if (!confirm(`Excluir "${q.name}"?`)) return;
    try {
      console.log("QUICK_REPLY_DELETE_ATTEMPT", { id: q.id, company_id: companyId, name: q.name });
      await deleteQuickReply(companyId, q.id);
      console.log("QUICK_REPLY_DELETE_SUCCESS", { id: q.id, company_id: companyId, name: q.name });
      await reload();
      toast.success("Excluído");
    } catch (e) {
      const info = errorInfo(e);
      console.error("QUICK_REPLY_DELETE_ERROR", {
        id: q.id,
        company_id: companyId,
        name: q.name,
        error: info.message,
        details: info.details,
      });
      toast.error(info.message);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    if (!companyId) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    try {
      await reorderQuickReplies(companyId, next.map((i) => i.id));
    } catch (err) {
      const info = errorInfo(err);
      console.error("QUICK_REPLY_UPDATE_ERROR", {
        company_id: companyId,
        action: "reorder",
        error: info.message,
        details: info.details,
      });
      toast.error(info.message);
      await reload();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <Link
          to="/configuracoes"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <MessageSquareText className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold">Respostas Rápidas</h1>
          <p className="text-[11px] text-muted-foreground">
            Mensagens prontas exibidas no botão ➕ do Inbox
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nova
        </button>
      </header>

      <div className="p-4 md:p-6 max-w-3xl space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma resposta rápida cadastrada.
            <div className="mt-3">
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> Criar primeira
              </button>
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {items.map((q) => (
                  <SortableRow
                    key={q.id}
                    item={q}
                    onEdit={() => openEdit(q)}
                    onToggle={() => toggleActive(q)}
                    onDelete={() => remove(q)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !saving && setShowForm(false)}
        >
          <div
            className="bg-card rounded-lg border border-border max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm">
                {form.id ? "Editar resposta rápida" : "Nova resposta rápida"}
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="p-1 hover:bg-muted rounded"
                disabled={saving}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-[1fr_5rem] gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                    Nome
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex.: Itens Inclusos"
                    className="mt-1 h-9 w-full rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                    Ícone
                  </label>
                  <input
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    placeholder="✅"
                    maxLength={4}
                    className="mt-1 h-9 w-full rounded-md bg-input px-3 text-center text-lg outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Categoria (opcional)
                </label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Orçamento, Produtos, Suporte…"
                  className="mt-1 h-9 w-full rounded-md bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Conteúdo da mensagem
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={8}
                  placeholder="Digite a mensagem que será enviada…"
                  className="mt-1 w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  O atendente poderá editar antes de enviar.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Ativa (visível no Inbox)
              </label>
            </div>
            <div className="p-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="h-9 px-3 rounded-md text-sm hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableRow({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: QuickReply;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border border-border bg-card p-3 flex items-center gap-3",
        !item.active && "opacity-60",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="text-lg w-7 text-center">{item.icon || "💬"}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{item.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {item.category ? <span className="mr-2">[{item.category}]</span> : null}
          {item.content.slice(0, 80)}
          {item.content.length > 80 ? "…" : ""}
        </div>
      </div>
      <button
        onClick={onToggle}
        title={item.active ? "Desativar" : "Ativar"}
        className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
      >
        {item.active ? <Power className="h-4 w-4 text-[var(--status-won)]" /> : <PowerOff className="h-4 w-4" />}
      </button>
      <button
        onClick={onEdit}
        title="Editar"
        className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        onClick={onDelete}
        title="Excluir"
        className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
