import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { format, isAfter, isToday, isThisWeek, addMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon,
  MapPin,
  Phone,
  User,
  Package,
  StickyNote,
  Plus,
  Send,
  Trash2,
  Wrench,
  Store,
  RotateCcw,
  PackageCheck,
  Cog,
  HardHat,
  MessageCircle,
  MessagesSquare,
  Building2,
  UserCog,
  Clock,
  Filter,
  Bell,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { getConversations } from "@/data/leadRepo";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import { whatsappProvider } from "@/services/whatsappProvider";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/agenda")({
  component: AgendaPage,
});

// ---------- Tipos ----------
type VisitStatus =
  | "agendada"
  | "confirmada"
  | "em_andamento"
  | "concluida"
  | "remarcada"
  | "cancelada";

type AppointmentType =
  | "visita_tecnica"
  | "loja"
  | "retorno_comercial"
  | "pos_venda"
  | "instalacao"
  | "manutencao";

interface Visit {
  id: string;
  title: string;
  address: string | null;
  scheduled_at: string;
  status: VisitStatus;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  product: string | null;
  lead_id: string | null;
  quote_id: string | null;
  appointment_type: AppointmentType;
  city: string | null;
  salesperson: string | null;
  technician: string | null;
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  agendada: "Agendado",
  confirmada: "Confirmado",
  em_andamento: "Em andamento",
  concluida: "Finalizado",
  remarcada: "Reagendar",
  cancelada: "Cancelado",
};

const STATUS_CLASS: Record<VisitStatus, string> = {
  agendada: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  confirmada: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  em_andamento: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  concluida: "bg-green-600/15 text-green-700 dark:text-green-300",
  remarcada: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cancelada: "bg-destructive/15 text-destructive",
};

// Tipos de compromisso — cores/ícones distintos por categoria
const TYPE_META: Record<
  AppointmentType,
  { label: string; short: string; icon: typeof Wrench; class: string; needsAddress: boolean }
> = {
  visita_tecnica: {
    label: "Visita técnica",
    short: "Visita",
    icon: HardHat,
    class: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
    needsAddress: true,
  },
  loja: {
    label: "Cliente vem na loja",
    short: "Na loja",
    icon: Store,
    class: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    needsAddress: false,
  },
  retorno_comercial: {
    label: "Retorno comercial",
    short: "Retorno",
    icon: RotateCcw,
    class: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    needsAddress: false,
  },
  pos_venda: {
    label: "Pós-venda",
    short: "Pós-venda",
    icon: PackageCheck,
    class: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
    needsAddress: false,
  },
  instalacao: {
    label: "Instalação",
    short: "Instalação",
    icon: Cog,
    class: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    needsAddress: true,
  },
  manutencao: {
    label: "Manutenção",
    short: "Manutenção",
    icon: Wrench,
    class: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    needsAddress: true,
  },
};

const TYPE_KEYS = Object.keys(TYPE_META) as AppointmentType[];

function onlyDigits(s: string): string {
  return s.replace(/\D+/g, "");
}



// ---------- Página ----------
function AgendaPage() {
  const { company } = useAuth();
  const companyId = company?.id;

  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [sendTarget, setSendTarget] = useState<Visit | null>(null);

  const loadVisits = useCallback(async () => {
    if (!companyId) {
      setVisits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("visits")
      .select(
        "id,title,address,scheduled_at,status,notes,customer_name,customer_phone,product,lead_id,quote_id",
      )
      .eq("company_id", companyId)
      .order("scheduled_at", { ascending: true });
    if (error) {
      console.error("loadVisits", error);
      toast.error("Não foi possível carregar a agenda");
    } else {
      setVisits((data ?? []) as Visit[]);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void loadVisits();
  }, [loadVisits]);

  const grouped = useMemo(() => {
    const map = new Map<string, Visit[]>();
    for (const v of visits) {
      const dayKey = v.scheduled_at.slice(0, 10);
      const arr = map.get(dayKey) ?? [];
      arr.push(v);
      map.set(dayKey, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visits]);

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta visita?")) return;
    const { error } = await supabase.from("visits").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Visita excluída");
    setVisits((prev) => prev.filter((v) => v.id !== id));
  }

  async function handleStatusChange(visit: Visit, status: VisitStatus) {
    const { error } = await supabase
      .from("visits")
      .update({ status })
      .eq("id", visit.id);
    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    setVisits((prev) =>
      prev.map((v) => (v.id === visit.id ? { ...v, status } : v)),
    );
  }

  return (
    <div className="flex-1 p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Agenda de visitas técnicas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organize visitas, confirmações e envio para o técnico no WhatsApp.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpenForm(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nova visita
        </Button>
      </div>

      {!companyId && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Faça login para gerenciar a agenda.
          </CardContent>
        </Card>
      )}

      {companyId && loading && (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      )}

      {companyId && !loading && visits.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma visita agendada ainda. Clique em "Nova visita" para começar.
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {grouped.map(([day, items]) => (
          <div key={day}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {format(new Date(day + "T12:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((v) => (
                <VisitCard
                  key={v.id}
                  visit={v}
                  onEdit={() => {
                    setEditing(v);
                    setOpenForm(true);
                  }}
                  onDelete={() => handleDelete(v.id)}
                  onStatusChange={(s) => handleStatusChange(v, s)}
                  onSend={() => setSendTarget(v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {openForm && (
        <VisitFormModal
          companyId={companyId ?? null}
          visit={editing}
          onClose={() => setOpenForm(false)}
          onSaved={() => {
            setOpenForm(false);
            void loadVisits();
          }}
        />
      )}

      {sendTarget && (
        <SendTechnicianModal
          visit={sendTarget}
          onClose={() => setSendTarget(null)}
        />
      )}
    </div>
  );
}

// ---------- Card ----------
function VisitCard({
  visit,
  onEdit,
  onDelete,
  onStatusChange,
  onSend,
}: {
  visit: Visit;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: VisitStatus) => void;
  onSend: () => void;
}) {
  const time = format(new Date(visit.scheduled_at), "HH:mm");
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{visit.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{time}</p>
          </div>
          <Badge variant="secondary" className={STATUS_CLASS[visit.status]}>
            {STATUS_LABEL[visit.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {visit.customer_name && (
          <Row icon={<User className="h-3.5 w-3.5" />} text={visit.customer_name} />
        )}
        {visit.customer_phone && (
          <Row icon={<Phone className="h-3.5 w-3.5" />} text={visit.customer_phone} />
        )}
        {visit.address && (
          <Row icon={<MapPin className="h-3.5 w-3.5" />} text={visit.address} />
        )}
        {visit.product && (
          <Row icon={<Package className="h-3.5 w-3.5" />} text={visit.product} />
        )}
        {visit.notes && (
          <Row icon={<StickyNote className="h-3.5 w-3.5" />} text={visit.notes} />
        )}

        <div className="pt-2 flex flex-wrap items-center gap-2">
          <Select value={visit.status} onValueChange={(v) => onStatusChange(v as VisitStatus)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as VisitStatus[]).map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={onEdit}>
            Editar
          </Button>
          <Button size="sm" onClick={onSend}>
            <Send className="h-3.5 w-3.5" />
            Enviar ao técnico
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 text-foreground/80">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex-1 break-words">{text}</span>
    </div>
  );
}

// ---------- Formulário ----------
function useLeads() {
  return useSyncExternalStore(subscribeRepo, getLeads, getLeads);
}

function useQuotesList() {
  return useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
}

function VisitFormModal({
  companyId,
  visit,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  visit: Visit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const leads = useLeads();
  const quotes = useQuotesList();

  const initialDate = visit
    ? format(new Date(visit.scheduled_at), "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");
  const initialTime = visit
    ? format(new Date(visit.scheduled_at), "HH:mm")
    : "09:00";

  const [title, setTitle] = useState(visit?.title ?? "Visita técnica");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [leadId, setLeadId] = useState<string>(visit?.lead_id ?? "none");
  const [customerName, setCustomerName] = useState(visit?.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(visit?.customer_phone ?? "");
  const [address, setAddress] = useState(visit?.address ?? "");
  const [product, setProduct] = useState(visit?.product ?? "");
  const [quoteId, setQuoteId] = useState<string>(visit?.quote_id ?? "none");
  const [notes, setNotes] = useState(visit?.notes ?? "");
  const [status, setStatus] = useState<VisitStatus>(visit?.status ?? "agendada");
  const [saving, setSaving] = useState(false);

  // Quando escolhe lead, autopreenche nome/telefone
  useEffect(() => {
    if (leadId === "none") return;
    const l = leads.find((x) => x.id === leadId);
    if (l) {
      if (!customerName) setCustomerName(l.name);
      if (!customerPhone && l.phone) setCustomerPhone(l.phone);
      if (!product && l.product) setProduct(l.product);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const leadQuotes = useMemo(
    () => (leadId !== "none" ? quotes.filter((q) => q.leadId === leadId) : []),
    [quotes, leadId],
  );

  async function handleSave() {
    if (!companyId) {
      toast.error("Empresa não identificada");
      return;
    }
    if (!title.trim()) return toast.error("Informe o título da visita");
    if (!date || !time) return toast.error("Informe data e horário");
    if (!customerName.trim()) return toast.error("Informe o nome do cliente");

    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    const payload = {
      company_id: companyId,
      title: title.trim(),
      address: address.trim() || null,
      scheduled_at: scheduledAt,
      status,
      notes: notes.trim() || null,
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      product: product.trim() || null,
      lead_id: leadId !== "none" ? leadId : null,
      quote_id: quoteId !== "none" ? quoteId : null,
    };

    setSaving(true);
    try {
      if (visit) {
        const { error } = await supabase.from("visits").update(payload).eq("id", visit.id);
        if (error) throw error;
        toast.success("Visita atualizada");
      } else {
        const { error } = await supabase.from("visits").insert(payload);
        if (error) throw error;
        toast.success("Visita agendada");
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar visita");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{visit ? "Editar visita" : "Nova visita técnica"}</DialogTitle>
          <DialogDescription>
            Cadastre os detalhes da visita. Você poderá enviar para o técnico no WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <Label>Título da visita</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Dia</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Horário</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Cliente (opcional - vincular a lead existente)</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Cliente avulso —</SelectItem>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} {l.phone ? `· ${l.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome do cliente</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="55 11 99999-9999"
              />
            </div>
          </div>

          <div>
            <Label>Endereço da visita</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rua, número, bairro, cidade"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Produto / interesse</Label>
              <Input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="Ex.: Piscina 6x3"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as VisitStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABEL) as VisitStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {leadQuotes.length > 0 && (
            <div>
              <Label>Orçamento relacionado (opcional)</Label>
              <Select value={quoteId} onValueChange={setQuoteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhum —</SelectItem>
                  {leadQuotes.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.productName} · R$ {q.finalValue.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações para o técnico, acesso ao local, etc."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <CalendarIcon className="h-4 w-4" />
            {saving ? "Salvando..." : visit ? "Salvar alterações" : "Agendar visita"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Envio ao técnico ----------
function buildTechMessage(v: Visit): string {
  const d = new Date(v.scheduled_at);
  const data = format(d, "dd/MM/yyyy", { locale: ptBR });
  const hora = format(d, "HH:mm");
  const lines = [
    "📍 Visita técnica agendada",
    "",
    `Cliente: ${v.customer_name ?? "—"}`,
    `Telefone: ${v.customer_phone ?? "—"}`,
    `Data: ${data}`,
    `Horário: ${hora}`,
    `Endereço: ${v.address ?? "—"}`,
    `Produto/interesse: ${v.product ?? "—"}`,
    `Observações: ${v.notes ?? "—"}`,
  ];
  return lines.join("\n");
}


function SendTechnicianModal({
  visit,
  onClose,
}: {
  visit: Visit;
  onClose: () => void;
}) {
  const leads = useLeads();
  // técnicos = leads do canal whatsapp marcados com tag "tecnico" — fallback: todos com telefone
  const technicians = useMemo(() => {
    const withTag = leads.filter(
      (l) => l.phone && l.tags?.some((t) => t.toLowerCase().includes("tecnico") || t.toLowerCase().includes("técnico")),
    );
    return withTag.length > 0 ? withTag : leads.filter((l) => l.phone);
  }, [leads]);

  const [mode, setMode] = useState<"contact" | "manual">(
    technicians.length > 0 ? "contact" : "manual",
  );
  const [techId, setTechId] = useState<string>(technicians[0]?.id ?? "");
  const [manualPhone, setManualPhone] = useState("");
  const [message, setMessage] = useState(buildTechMessage(visit));
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const tech = technicians.find((t) => t.id === techId);
    const phone =
      mode === "contact" ? tech?.phone ?? "" : manualPhone;
    const digits = onlyDigits(phone);
    if (!digits) {
      toast.error("Informe um número válido");
      return;
    }

    if (mode === "manual") {
      // wa.me para número externo
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank", "noopener");
      onClose();
      return;
    }

    // Envia via WhatsApp Cloud (provider Evolution) para contato do sistema
    setSending(true);
    try {
      const res = await whatsappProvider.sendMessage({
        number: digits,
        message,
        contactName: tech?.name,
      });
      if (!res.ok) throw new Error(res.error || "Falha ao enviar");
      toast.success("Mensagem enviada ao técnico");
      onClose();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao enviar";
      toast.error(msg);
      // fallback wa.me
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank", "noopener");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar visita ao técnico</DialogTitle>
          <DialogDescription>
            Escolha o técnico cadastrado ou informe um número manualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "contact" ? "default" : "outline"}
              onClick={() => setMode("contact")}
              disabled={technicians.length === 0}
            >
              Técnico cadastrado
            </Button>
            <Button
              size="sm"
              variant={mode === "manual" ? "default" : "outline"}
              onClick={() => setMode("manual")}
            >
              Número manual
            </Button>
          </div>

          {mode === "contact" ? (
            <div>
              <Label>Técnico</Label>
              <Select value={techId} onValueChange={setTechId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {technicians.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Nenhum contato com telefone cadastrado. Use número manual.
                </p>
              )}
            </div>
          ) : (
            <div>
              <Label>Número do técnico (com DDD/país)</Label>
              <Input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="55 11 99999-9999"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Abrirá o WhatsApp (wa.me) com a mensagem preenchida.
              </p>
            </div>
          )}

          <div>
            <Label>Mensagem</Label>
            <Textarea rows={10} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            <Send className="h-4 w-4" />
            {sending ? "Enviando..." : "Enviar no WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
