import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Building2,
  Copy,
  History,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Package,
  Pencil,
  Phone,
  Send,
  StickyNote,
  Trash2,
  User,
  UserCog,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { getConversations } from "@/data/leadRepo";
import {
  eventEnd,
  SOURCE_LABEL,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_HUE,
  TYPE_LABEL,
  type AgendaEvent,
  type AgendaEventType,
  type EventSource,
  type VisitStatus,
} from "./agenda-model";
import { PENDING_SCHEMA_MESSAGE } from "./agenda-schema";
import { describeChange, useEventDetails } from "./useEventDetails";

/**
 * Tudo sobre um compromisso: o que é, quando, com quem, quem criou e por onde, o que
 * mudou e as ações. Abre pela direita sem tirar a pessoa da agenda.
 */
export function EventDrawer({
  event,
  type,
  extended,
  children,
  onClose,
  onStatus,
  onEdit,
  onDuplicate,
  onDelete,
  onSendTechnician,
}: {
  event: AgendaEvent | null;
  type: AgendaEventType | null;
  extended: boolean;
  /** Seções extras (checklist, campo) entram aqui sem o painel conhecê-las. */
  children?: ReactNode;
  onClose: () => void;
  onStatus: (status: VisitStatus) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSendTechnician: () => void;
}) {
  const { history, names } = useEventDetails(
    event?.id ?? null,
    [event?.created_by, event?.updated_by],
    extended,
  );
  const conversation = useMemo(
    () => (event?.lead_id ? getConversations().find((c) => c.leadId === event.lead_id) : undefined),
    [event?.lead_id],
  );

  const hue = type?.hue ?? (event ? TYPE_HUE[event.appointment_type] : 300);
  const typeName = type?.name ?? (event ? TYPE_LABEL[event.appointment_type]?.label : "");
  const phone = event?.customer_phone?.replace(/\D+/g, "") ?? "";
  const start = event ? new Date(event.scheduled_at) : null;
  const end = event ? eventEnd(event) : null;
  const creator = event?.created_by ? names[event.created_by] : null;
  const editor = event?.updated_by ? names[event.updated_by] : null;

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="lume-agenda w-[94vw] max-w-[460px] overflow-y-auto border-l border-[var(--ag-edge)] p-0 text-[var(--ag-ink)]"
      >
        {event && start && end && (
          <div style={{ ["--ag-hue" as string]: String(hue) } as CSSProperties}>
            <header
              className="relative overflow-hidden border-b border-[var(--ag-edge)] px-6 pb-6 pt-12"
              style={{
                background: `radial-gradient(ellipse 90% 80% at 100% 0%, oklch(0.55 0.2 ${hue} / 0.45), transparent 70%), #0b0a10`,
              }}
            >
              <p className="ag-mono flex items-center gap-2 !text-white/70">
                <span
                  className="ag-dot"
                  style={{ ["--ag-type" as string]: `oklch(0.75 0.19 ${hue})` }}
                />
                {typeName}
              </p>
              <SheetTitle className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-white">
                {event.title}
              </SheetTitle>
              <SheetDescription className="mt-2 text-sm text-white/75 first-letter:uppercase">
                {event.all_day
                  ? `${format(start, "EEEE, d 'de' MMMM", { locale: ptBR })} · dia inteiro`
                  : `${format(start, "EEEE, d 'de' MMMM · HH:mm", { locale: ptBR })} – ${format(end, "HH:mm")}`}
              </SheetDescription>
              <div className="mt-5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Status">
                {STATUS_KEYS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={event.status === status}
                    aria-pressed={event.status === status}
                    className="ag-chip"
                    onClick={() => onStatus(status)}
                  >
                    {STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
            </header>

            <div className="flex flex-wrap gap-2 border-b border-[var(--ag-edge)] px-6 py-4">
              <button type="button" className="ag-btn" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
              <button type="button" className="ag-btn" onClick={onDuplicate}>
                <Copy className="h-3.5 w-3.5" /> Duplicar
              </button>
              {phone && (
                <a
                  className="ag-btn"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://wa.me/${phone}?text=${encodeURIComponent(
                    `Olá ${event.customer_name ?? ""}! Confirmando nosso compromisso em ${format(start, "dd/MM 'às' HH:mm")}.`,
                  )}`}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
              {conversation && (
                <Link
                  className="ag-btn"
                  to="/inbox/$conversationId"
                  params={{ conversationId: conversation.id }}
                >
                  <MessagesSquare className="h-3.5 w-3.5" /> Conversa
                </Link>
              )}
              {event.appointment_type !== "loja" && (
                <button type="button" className="ag-btn" onClick={onSendTechnician}>
                  <Send className="h-3.5 w-3.5" /> Enviar ao técnico
                </button>
              )}
              <button
                type="button"
                className="ag-btn ml-auto !border-[#ff6b6b55] !text-[#ff9a9a]"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            </div>

            <dl className="space-y-3 px-6 py-5 text-sm">
              <Detail icon={<User />} label="Cliente" value={event.customer_name} />
              <Detail icon={<Phone />} label="Telefone" value={event.customer_phone} />
              <Detail icon={<Building2 />} label="Cidade" value={event.city} />
              <Detail icon={<MapPin />} label="Endereço" value={event.address} />
              <Detail icon={<Package />} label="Produto ou serviço" value={event.product} />
              <Detail icon={<User />} label="Vendedor" value={event.salesperson} />
              <Detail icon={<UserCog />} label="Técnico" value={event.technician} />
              <Detail icon={<StickyNote />} label="Notas" value={event.notes} multiline />
              {type?.fields.map((field) => (
                <Detail
                  key={field.key}
                  icon={<StickyNote />}
                  label={field.label}
                  value={formatCustom(event.custom_fields?.[field.key])}
                />
              ))}
            </dl>

            {children}

            <section
              className="border-t border-[var(--ag-edge)] px-6 py-5"
              aria-label="Autoria e histórico"
            >
              <h3 className="ag-mono flex items-center gap-2">
                <History className="h-3.5 w-3.5" /> Autoria e histórico
              </h3>
              {extended ? (
                <>
                  <p className="mt-3 text-sm">
                    Criado por <strong>{creator ?? "alguém da equipe"}</strong>{" "}
                    {SOURCE_LABEL[(event.source ?? "tela") as EventSource] ?? ""}
                    {event.created_at &&
                      ` em ${format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm")}`}
                    .
                  </p>
                  {editor && event.updated_at && event.updated_at !== event.created_at && (
                    <p className="mt-1 text-xs text-[var(--ag-muted)]">
                      Última alteração por {editor},{" "}
                      {formatDistanceToNowStrict(new Date(event.updated_at), {
                        locale: ptBR,
                        addSuffix: true,
                      })}
                      .
                    </p>
                  )}
                  <ol className="mt-4 space-y-3 border-l border-[var(--ag-edge)] pl-4">
                    {history.map((entry) => (
                      <li key={entry.id} className="relative text-[13px]">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--ag-violet)] shadow-[0_0_10px_var(--ag-violet)]" />
                        <strong>{entry.actor_name ?? "Sistema"}</strong> {describeChange(entry)}
                        {entry.source === "lume" && (
                          <span className="ml-1.5 rounded-full bg-[rgb(123_92_255/0.2)] px-1.5 py-0.5 text-[10px] font-semibold text-[#c6b6ff]">
                            via Lume
                          </span>
                        )}
                        <span className="block text-[11.5px] text-[var(--ag-faint)]">
                          {format(new Date(entry.created_at), "dd/MM 'às' HH:mm")}
                        </span>
                      </li>
                    ))}
                    {!history.length && (
                      <li className="text-[13px] text-[var(--ag-muted)]">
                        Sem alterações registradas ainda.
                      </li>
                    )}
                  </ol>
                </>
              ) : (
                <p className="mt-3 text-sm text-[var(--ag-muted)]">
                  {event.created_at &&
                    `Criado em ${format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm")}. `}
                  Quem criou e o histórico de alterações: {PENDING_SCHEMA_MESSAGE.toLowerCase()}
                </p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  icon,
  label,
  value,
  multiline = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  if (!value?.trim()) return null;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-[var(--ag-faint)] [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11.5px] text-[var(--ag-faint)]">{label}</dt>
        <dd className={multiline ? "whitespace-pre-wrap" : "truncate"}>{value}</dd>
      </div>
    </div>
  );
}

function formatCustom(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}
