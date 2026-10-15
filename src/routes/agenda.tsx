import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MapPin,
  Phone,
  User,
  Package,
  StickyNote,
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
  Bell,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { getConversations } from "@/data/leadRepo";
// whatsappProvider (Evolution) descontinuado — envio agora usa wa.me ou Cloud API oficial.
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
import { AgendaHero } from "@/components/agenda/AgendaHero";
import { AgendaToolbar } from "@/components/agenda/AgendaToolbar";
import { MonthView, TeamView, TimeGridView, TimelineView } from "@/components/agenda/AgendaViews";
import { useAgendaEvents } from "@/components/agenda/useAgendaEvents";
import { EventDrawer } from "@/components/agenda/EventDrawer";
import { EventFieldSection } from "@/components/agenda/EventFieldSection";
import { EventFormModal } from "@/components/agenda/EventFormModal";
import { useEventTypes } from "@/components/agenda/useEventTypes";
import { AgendaCustomize } from "@/components/agenda/AgendaCustomize";
import { LumeDock } from "@/components/lume/LumeDock";
import { AgendaTagsSection } from "@/components/agenda/AgendaTagsSection";
import { useAgendaTags } from "@/components/agenda/useAgendaTags";
import { useTeamDirectory } from "@/components/agenda/useTeamDirectory";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { canManageTeamAgenda } from "@/lib/team/permissions";
import {
  applyFilters,
  daysOf,
  EMPTY_FILTERS,
  findConflicts,
  matchesScope,
  peopleOf,
  pulseOf,
  shiftFocus,
  viewRange,
  DEFAULT_PREFERENCES,
  type AgendaEvent,
  type AgendaFilters,
  type AgendaPreferences,
  type AgendaView,
  type ScopeFilter,
} from "@/components/agenda/agenda-model";
import "@/components/agenda/agenda.css";

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

function onlyDigits(s: string): string {
  return s.replace(/\D+/g, "");
}

// ---------- Página ----------
function AgendaPage() {
  const { company, user } = useAuth();
  const me = user?.id ?? "";
  const teamAccess = useTeamAccess();
  const manager = canManageTeamAgenda(teamAccess.access);
  const companyId = company?.id;

  const [view, setView] = useState<AgendaView>(() => readPreference("view", "semana"));
  const [focus, setFocus] = useState(() => new Date());
  const [filters, setFilters] = useState<AgendaFilters>(EMPTY_FILTERS);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [createAt, setCreateAt] = useState<Date | null>(null);
  const [sendTarget, setSendTarget] = useState<Visit | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [lumeSignal, setLumeSignal] = useState(0);
  // De quem é a agenda exibida (gestor escolhe; funcionário vê a sua).
  const [scope, setScope] = useState<ScopeFilter>(() => {
    try {
      return JSON.parse(readPreference("scope", JSON.stringify({ kind: "minha" }))) as ScopeFilter;
    } catch {
      return { kind: "minha" };
    }
  });
  // Link de aviso da Lume (/agenda?evento=…) abre o compromisso direto.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("evento");
    if (id) setSelectedId(id);
  }, []);
  const [preferences, setPreferences] = useState<AgendaPreferences>(() => {
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(readPreference("prefs", "{}")) };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });

  const range = useMemo(() => viewRange(view, focus), [view, focus]);
  const {
    events: allEvents,
    loading,
    error,
    extended,
    hierarchy,
    reload,
    setStatus,
    reschedule,
    remove,
    duplicate,
  } = useAgendaEvents(companyId, range);
  const agendaTags = useAgendaTags(companyId, hierarchy);
  const members = useTeamDirectory(hierarchy);
  const tagById = useMemo(
    () => new Map(agendaTags.tags.map((tag) => [tag.id, tag])),
    [agendaTags.tags],
  );
  // Com hierarquia, só os compromissos do escopo escolhido (o banco já esconde os alheios).
  const effectiveScope: ScopeFilter = manager ? scope : { kind: "minha" };
  const events = useMemo(
    () =>
      hierarchy && me
        ? allEvents.filter((event) => matchesScope(event, effectiveScope, me))
        : allEvents,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escopo comparado por valor
    [allEvents, hierarchy, me, JSON.stringify(effectiveScope)],
  );
  // Funcionário não tem a visão Pessoas (agenda de todos): volta para a semana.
  useEffect(() => {
    if (hierarchy && !manager && view === "equipe") setView("semana");
  }, [hierarchy, manager, view]);
  function changeScope(next: ScopeFilter) {
    setScope(next);
    writePreference("scope", JSON.stringify(next));
  }
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId],
  );
  const eventTypes = useEventTypes(companyId, extended);
  const typeById = useMemo(
    () => new Map(eventTypes.types.map((type) => [type.id, type])),
    [eventTypes.types],
  );
  const pulse = useMemo(() => pulseOf(events), [events]);
  const people = useMemo(() => peopleOf(events), [events]);
  const inRange = useMemo(
    () =>
      applyFilters(events, filters)
        .filter((event) => {
          const at = new Date(event.scheduled_at);
          return at >= range.from && at <= range.to;
        })
        .map((event) => {
          // Cor: a primeira tag (hierarquia) ou o tipo da empresa.
          const tag =
            hierarchy && event.tag_ids?.length ? tagById.get(event.tag_ids[0]) : undefined;
          if (tag) return { ...event, type_hue: tag.hue, type_name: tag.name };
          const type = event.event_type_id ? typeById.get(event.event_type_id) : undefined;
          return type ? { ...event, type_hue: type.hue, type_name: type.name } : event;
        }),
    [events, filters, range, typeById, tagById, hierarchy],
  );
  const conflicts = useMemo(() => findConflicts(inRange), [inRange]);
  const days = useMemo(() => {
    const all = daysOf(range.from, range.to);
    if (view !== "semana" || !preferences.hideWeekends) return all;
    return all.filter((day) => day.getDay() !== 0 && day.getDay() !== 6);
  }, [range, view, preferences.hideWeekends]);
  function changePreferences(next: AgendaPreferences) {
    setPreferences(next);
    writePreference("prefs", JSON.stringify(next));
  }

  function changeView(next: AgendaView) {
    setView(next);
    writePreference("view", next);
  }
  function openCreate(at: Date | null = null) {
    setEditing(null);
    setCreateAt(at);
    setOpenForm(true);
  }
  function openEdit(event: Visit) {
    setEditing(event);
    setCreateAt(null);
    setOpenForm(true);
  }
  async function move(event: Visit, at: Date) {
    if (at.getTime() === new Date(event.scheduled_at).getTime()) return;
    const before = new Date(event.scheduled_at);
    if (!(await reschedule(event.id, at))) return;
    toast.success(`Remarcado para ${format(at, "EEE dd/MM 'às' HH:mm", { locale: ptBR })}`, {
      action: { label: "Desfazer", onClick: () => void reschedule(event.id, before) },
    });
  }
  async function handleDelete(event: Visit) {
    if (!confirm(`Excluir "${event.title}"?`)) return;
    if (await remove(event.id)) {
      setSelectedId((current) => (current === event.id ? null : current));
      toast.success("Compromisso excluído");
    }
  }
  async function handleDuplicate(event: AgendaEvent) {
    const id = await duplicate(event);
    if (!id) return;
    toast.success("Cópia criada no dia seguinte", {
      action: { label: "Abrir", onClick: () => setSelectedId(id) },
    });
  }

  if (!companyId) {
    return (
      <div className="lume-agenda flex-1 p-6 text-sm text-[var(--ag-muted)]">
        Faça login para gerenciar a agenda.
      </div>
    );
  }

  return (
    <div className="lume-agenda flex-1">
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <AgendaHero
          pulse={pulse}
          onCreate={() => openCreate()}
          onAskLume={() => setLumeSignal((n) => n + 1)}
        />

        <section className="ag-panel p-4 sm:p-5" aria-label="Calendário">
          <AgendaToolbar
            view={view}
            focus={focus}
            filters={filters}
            people={people}
            onView={changeView}
            onNavigate={(direction) => setFocus((current) => shiftFocus(view, current, direction))}
            onToday={() => setFocus(new Date())}
            onFilters={setFilters}
            onCustomize={() => setCustomizing(true)}
            customTypes={eventTypes.types.filter((type) => type.active)}
            tags={hierarchy ? agendaTags.tags : undefined}
            manager={hierarchy && manager}
            scope={effectiveScope}
            members={members}
            onScope={changeScope}
            hideTeamView={hierarchy && !manager}
          />
          {conflicts.size > 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-[#ff9a9a]">
              <Bell className="h-3.5 w-3.5" />
              {conflicts.size} compromissos com a mesma pessoa no mesmo horário — marcados com borda
              tracejada.
            </p>
          )}
        </section>

        {error && (
          <div className="ag-panel flex items-center justify-between gap-3 p-4 text-sm">
            <span>{error}</span>
            <button type="button" className="ag-btn" onClick={() => void reload()}>
              Tentar novamente
            </button>
          </div>
        )}

        <section className="ag-panel overflow-hidden" aria-busy={loading}>
          {view === "dia" || view === "semana" ? (
            <TimeGridView
              days={days}
              events={inRange}
              conflicts={conflicts}
              onOpen={(event) => setSelectedId(event.id)}
              startHour={preferences.dayStartHour}
              onCreateAt={(at) => openCreate(at)}
              onMove={(event, at) => void move(event, at)}
            />
          ) : view === "mes" ? (
            <MonthView
              days={days}
              focus={focus}
              events={inRange}
              conflicts={conflicts}
              onOpen={(event) => setSelectedId(event.id)}
              onOpenDay={(day) => {
                setFocus(day);
                changeView("dia");
              }}
            />
          ) : view === "linha" ? (
            <TimelineView
              days={days}
              events={inRange}
              conflicts={conflicts}
              onOpen={(event) => setSelectedId(event.id)}
            />
          ) : view === "equipe" ? (
            <TeamView
              days={days}
              events={inRange}
              conflicts={conflicts}
              onOpen={(event) => setSelectedId(event.id)}
              members={hierarchy ? members : undefined}
            />
          ) : (
            <ListView
              events={inRange}
              loading={loading}
              onEdit={openEdit}
              onDelete={(event) => void handleDelete(event)}
              onStatus={(event, status) => void setStatus(event.id, status)}
              onSend={setSendTarget}
            />
          )}
        </section>
      </div>

      <LumeDock
        page="Agenda"
        greeting="O que vamos organizar?"
        openSignal={lumeSignal}
        suggestions={[
          "O que tenho amanhã?",
          "Reunião de equipe sexta às 10h",
          "Achar 1h livre nesta semana",
          "Lembrar 30 min antes das visitas",
        ]}
        onChanged={(touched) => {
          void reload();
          if (touched.length === 1) setSelectedId(touched[0]);
        }}
      />

      <AgendaCustomize
        open={customizing}
        extended={extended}
        types={eventTypes.types}
        preferences={preferences}
        onClose={() => setCustomizing(false)}
        onPreferences={changePreferences}
        onSave={eventTypes.save}
        onToggle={(id, active) => void eventTypes.setActive(id, active)}
        onRemove={(id) => void eventTypes.remove(id)}
        onSeed={() => void eventTypes.seedStarters()}
        tagsSlot={
          hierarchy ? (
            <AgendaTagsSection
              tags={agendaTags.tags}
              me={me}
              manager={manager}
              onCreate={agendaTags.create}
              onUpdate={(id, changes) => void agendaTags.update(id, changes)}
              onRemove={(id) => void agendaTags.remove(id)}
            />
          ) : undefined
        }
      />

      <EventDrawer
        event={selected}
        type={(selected?.event_type_id && typeById.get(selected.event_type_id)) || null}
        extended={extended}
        hierarchy={hierarchy}
        manager={manager}
        me={me}
        members={members}
        tags={agendaTags.tags}
        onClose={() => setSelectedId(null)}
        onStatus={(status) => selected && void setStatus(selected.id, status)}
        onEdit={() => selected && openEdit(selected)}
        onDuplicate={() => selected && void handleDuplicate(selected)}
        onDelete={() => selected && void handleDelete(selected)}
        onSendTechnician={() => selected && setSendTarget(selected)}
      >
        {selected && extended && (
          <EventFieldSection key={selected.id} eventId={selected.id} companyId={companyId} />
        )}
      </EventDrawer>

      {openForm && (
        <EventFormModal
          companyId={companyId}
          event={editing}
          initialAt={createAt}
          types={eventTypes.types}
          extended={extended}
          hierarchy={hierarchy}
          manager={manager}
          me={me}
          members={members}
          tags={agendaTags.tags}
          onCreateTag={agendaTags.create}
          onClose={() => setOpenForm(false)}
          onSaved={(id) => {
            setOpenForm(false);
            setSelectedId(id);
            void reload();
          }}
        />
      )}

      {sendTarget && <SendTechnicianModal visit={sendTarget} onClose={() => setSendTarget(null)} />}
    </div>
  );
}

/** Lista: os cartões completos de sempre (status, WhatsApp, conversa, técnico), por dia. */
function ListView({
  events,
  loading,
  onEdit,
  onDelete,
  onStatus,
  onSend,
}: {
  events: Visit[];
  loading: boolean;
  onEdit: (event: Visit) => void;
  onDelete: (event: Visit) => void;
  onStatus: (event: Visit, status: VisitStatus) => void;
  onSend: (event: Visit) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Visit[]>();
    for (const event of events) {
      const key = format(new Date(event.scheduled_at), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (!grouped.length)
    return (
      <p className="p-10 text-center text-sm text-[var(--ag-muted)]">
        {loading ? "Carregando…" : "Nenhum compromisso neste período."}
      </p>
    );
  return (
    <div className="space-y-6 p-4 sm:p-5">
      {grouped.map(([day, items]) => (
        <div key={day}>
          <h3 className="ag-mono mb-2">
            {format(new Date(`${day}T12:00:00`), "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((event) => (
              <VisitCard
                key={event.id}
                visit={event}
                onEdit={() => onEdit(event)}
                onDelete={() => onDelete(event)}
                onStatusChange={(status) => onStatus(event, status)}
                onSend={() => onSend(event)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Preferências da visão ficam no navegador de cada usuário.
function readPreference<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(`lume.agenda.${key}`) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(`lume.agenda.${key}`, value);
  } catch {
    /* navegação privada: segue sem lembrar */
  }
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
  const meta = TYPE_META[visit.appointment_type];
  const Icon = meta.icon;
  const isStore = visit.appointment_type === "loja";

  const conversation = useMemo(() => {
    if (!visit.lead_id) return undefined;
    return getConversations().find((c) => c.leadId === visit.lead_id);
  }, [visit.lead_id]);

  const phoneDigits = onlyDigits(visit.customer_phone ?? "");
  const waUrl = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(
        `Olá ${visit.customer_name ?? ""}! Confirmando seu compromisso (${meta.label}) em ${format(new Date(visit.scheduled_at), "dd/MM 'às' HH:mm")}.`,
      )}`
    : null;

  return (
    <Card
      className={cn("border-l-4", meta.class.replace(/bg-[^\s]+/g, "").trim() || "border-l-border")}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn("gap-1 border", meta.class)}>
                <Icon className="h-3 w-3" />
                {meta.short}
              </Badge>
              {isStore && (
                <Badge
                  variant="outline"
                  className="gap-1 border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                >
                  <Store className="h-3 w-3" />
                  Na loja
                </Badge>
              )}
            </div>
            <CardTitle className="text-base mt-1.5 truncate">{visit.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {time}
            </p>
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
        {visit.city && <Row icon={<Building2 className="h-3.5 w-3.5" />} text={visit.city} />}
        {visit.address && !isStore && (
          <Row icon={<MapPin className="h-3.5 w-3.5" />} text={visit.address} />
        )}
        {visit.product && <Row icon={<Package className="h-3.5 w-3.5" />} text={visit.product} />}
        {visit.salesperson && (
          <Row icon={<User className="h-3.5 w-3.5" />} text={`Vendedor: ${visit.salesperson}`} />
        )}
        {visit.technician && (
          <Row icon={<UserCog className="h-3.5 w-3.5" />} text={`Técnico: ${visit.technician}`} />
        )}
        {visit.notes && <Row icon={<StickyNote className="h-3.5 w-3.5" />} text={visit.notes} />}

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
          {waUrl && (
            <Button size="sm" variant="outline" asChild title="Abrir WhatsApp com o cliente">
              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </a>
            </Button>
          )}
          {conversation && (
            <Button size="sm" variant="outline" asChild title="Abrir conversa no inbox">
              <Link to="/inbox/$conversationId" params={{ conversationId: conversation.id }}>
                <MessagesSquare className="h-3.5 w-3.5" />
                Abrir conversa
              </Link>
            </Button>
          )}
          {!isStore && (
            <Button size="sm" onClick={onSend}>
              <Send className="h-3.5 w-3.5" />
              Enviar ao técnico
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit}>
            Editar
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

// ---------- Envio ao técnico ----------
function buildTechMessage(v: Visit): string {
  const d = new Date(v.scheduled_at);
  const data = format(d, "dd/MM/yyyy", { locale: ptBR });
  const hora = format(d, "HH:mm");
  const lines = [
    `📍 ${TYPE_META[v.appointment_type].label} agendada`,
    "",
    `Cliente: ${v.customer_name ?? "—"}`,
    `Telefone: ${v.customer_phone ?? "—"}`,
    `Data: ${data}`,
    `Horário: ${hora}`,
    `Cidade: ${v.city ?? "—"}`,
    `Endereço: ${v.address ?? "—"}`,
    `Produto/interesse: ${v.product ?? "—"}`,
    `Observações: ${v.notes ?? "—"}`,
  ];
  return lines.join("\n");
}

function SendTechnicianModal({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const leads = useLeads();
  // técnicos = leads do canal whatsapp marcados com tag "tecnico" — fallback: todos com telefone
  const technicians = useMemo(() => {
    const withTag = leads.filter(
      (l) =>
        l.phone &&
        l.tags?.some(
          (t) => t.toLowerCase().includes("tecnico") || t.toLowerCase().includes("técnico"),
        ),
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
    const phone = mode === "contact" ? (tech?.phone ?? "") : manualPhone;
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

    // Envio via wa.me (Evolution descontinuado; Cloud API oficial é gerenciada pelo inbox)
    setSending(true);
    try {
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank", "noopener");
      toast.success("Abrindo WhatsApp para envio ao técnico");
      onClose();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao enviar";
      toast.error(msg);
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
