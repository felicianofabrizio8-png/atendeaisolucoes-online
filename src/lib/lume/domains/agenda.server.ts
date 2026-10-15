import {
  AGENDA_SELECT,
  AGENDA_SELECT_EXTENDED,
  eventEnd,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_LABEL,
  type AgendaEvent,
  type AgendaEventType,
  type AppointmentType,
  type VisitStatus,
} from "@/components/agenda/agenda-model";
import { formatLocal, humanLocal, parseLocal } from "../time";
import type { LumeContext, LumeDomain, LumeTool, LumeUndo } from "../types";

/**
 * Domínio Agenda da Lume. Tudo passa pelo cliente com a sessão do usuário: a Lume só
 * consegue fazer o que a própria pessoa poderia fazer na tela.
 */

const MAX_LIST = 60;
const MAX_BULK = 25;

type Row = AgendaEvent & { company_id?: string };

async function companyTypes(ctx: LumeContext): Promise<AgendaEventType[]> {
  if (!ctx.extended) return [];
  const { data } = await ctx.client
    .from("agenda_event_types")
    .select(
      "id,name,hue,icon,kind,default_duration_min,requires_customer,requires_address,checklist_template,fields,legacy_type,position,active",
    )
    .eq("company_id", ctx.companyId)
    .eq("active", true)
    .order("position");
  return (data ?? []) as AgendaEventType[];
}

async function teamNames(ctx: LumeContext): Promise<Array<{ id: string; name: string }>> {
  const { data } = await ctx.client
    .from("profiles")
    .select("id,display_name")
    .eq("company_id", ctx.companyId)
    .limit(100);
  return (data ?? [])
    .filter((row: { display_name: string | null }) => row.display_name?.trim())
    .map((row: { id: string; display_name: string }) => ({
      id: row.id,
      name: row.display_name.trim(),
    }));
}

function selectColumns(ctx: LumeContext) {
  return ctx.extended ? AGENDA_SELECT_EXTENDED : AGENDA_SELECT;
}

async function loadEvents(ctx: LumeContext, ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const { data, error } = await ctx.client
    .from("visits")
    .select(`${selectColumns(ctx)},company_id`)
    .eq("company_id", ctx.companyId)
    .in("id", ids);
  if (error) throw new Error("Não consegui ler a agenda.");
  return (data ?? []) as unknown as Row[];
}

function compact(event: Row, ctx: LumeContext, types: AgendaEventType[]) {
  const type = types.find((item) => item.id === event.event_type_id);
  return {
    id: event.id,
    titulo: event.title,
    inicio: formatLocal(new Date(event.scheduled_at), ctx.timeZone),
    fim: formatLocal(eventEnd(event), ctx.timeZone),
    dia_inteiro: event.all_day ?? false,
    tipo: type?.name ?? TYPE_LABEL[event.appointment_type]?.label,
    status: STATUS_LABEL[event.status],
    cliente: event.customer_name ?? undefined,
    telefone: event.customer_phone ?? undefined,
    cidade: event.city ?? undefined,
    endereco: event.address ?? undefined,
    tecnico: event.technician ?? undefined,
    responsavel: event.salesperson ?? undefined,
    notas: event.notes?.slice(0, 280) ?? undefined,
  };
}

const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

function resolveType(types: AgendaEventType[], name: unknown): AgendaEventType | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const wanted = norm(name);
  return (
    types.find((type) => norm(type.name) === wanted) ??
    types.find((type) => norm(type.name).includes(wanted) || wanted.includes(norm(type.name))) ??
    null
  );
}

const LEGACY_BY_NAME: Record<string, AppointmentType> = Object.fromEntries(
  Object.entries(TYPE_LABEL).flatMap(([key, value]) => [
    [norm(value.label), key as AppointmentType],
    [norm(value.short), key as AppointmentType],
  ]),
);

function resolveStatus(value: unknown): VisitStatus | null {
  if (typeof value !== "string") return null;
  const wanted = norm(value);
  return STATUS_KEYS.find((key) => key === wanted || norm(STATUS_LABEL[key]) === wanted) ?? null;
}

const text = (value: unknown, max = 500) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

// ---------- Campos editáveis (mesmo vocabulário na criação e na alteração) ----------

const EVENT_FIELDS = {
  titulo: { type: "string", description: "Título curto do compromisso." },
  inicio: { type: "string", description: "Início em horário local: AAAA-MM-DDTHH:MM." },
  fim: { type: "string", description: "Fim em horário local: AAAA-MM-DDTHH:MM. Opcional." },
  duracao_min: { type: "integer", description: "Duração em minutos, se não houver fim." },
  dia_inteiro: { type: "boolean" },
  tipo: { type: "string", description: "Nome de um tipo de evento da empresa." },
  status: { type: "string", enum: STATUS_KEYS },
  cliente: { type: "string" },
  telefone: { type: "string" },
  cidade: { type: "string" },
  endereco: { type: "string", description: "Endereço ou link da reunião." },
  produto: { type: "string" },
  tecnico: { type: "string", description: "Quem executa." },
  responsavel: { type: "string", description: "Responsável ou vendedor." },
  notas: { type: "string", description: "O que será feito, pauta, orientações." },
} as const;

type EventArgs = Partial<Record<keyof typeof EVENT_FIELDS, unknown>>;

/** Converte os argumentos do modelo em colunas de `visits` (só as informadas). */
function toColumns(
  args: EventArgs,
  ctx: LumeContext,
  types: AgendaEventType[],
  current: Row | null,
): { columns: Record<string, unknown>; problems: string[] } {
  const columns: Record<string, unknown> = {};
  const problems: string[] = [];
  const type = args.tipo !== undefined ? resolveType(types, args.tipo) : null;
  if (args.tipo !== undefined) {
    if (type) {
      if (ctx.extended) columns.event_type_id = type.id;
      if (type.legacy_type) columns.appointment_type = type.legacy_type;
    } else {
      const legacy = typeof args.tipo === "string" ? LEGACY_BY_NAME[norm(args.tipo)] : undefined;
      if (legacy) columns.appointment_type = legacy;
      else if (types.length)
        problems.push(
          `Tipo "${String(args.tipo)}" não existe. Tipos: ${types.map((t) => t.name).join(", ")}.`,
        );
    }
  }
  const map: Array<[keyof EventArgs, string, number]> = [
    ["titulo", "title", 160],
    ["cliente", "customer_name", 120],
    ["telefone", "customer_phone", 40],
    ["cidade", "city", 80],
    ["endereco", "address", 300],
    ["produto", "product", 160],
    ["tecnico", "technician", 120],
    ["responsavel", "salesperson", 120],
    ["notas", "notes", 4000],
  ];
  for (const [arg, column, max] of map) {
    if (args[arg] !== undefined) columns[column] = text(args[arg], max);
  }
  if (args.status !== undefined) {
    const status = resolveStatus(args.status);
    if (status) columns.status = status;
    else problems.push(`Status inválido: ${String(args.status)}.`);
  }

  const baseStart = current ? new Date(current.scheduled_at) : null;
  const baseDuration = current
    ? eventEnd(current).getTime() - new Date(current.scheduled_at).getTime()
    : (type?.default_duration_min ?? 60) * 60_000;
  let start = baseStart;
  if (args.inicio !== undefined) {
    start = typeof args.inicio === "string" ? parseLocal(args.inicio, ctx.timeZone) : null;
    if (!start) problems.push("Início inválido: use AAAA-MM-DDTHH:MM.");
    else columns.scheduled_at = start.toISOString();
  }
  if (
    start &&
    (args.inicio !== undefined || args.fim !== undefined || args.duracao_min !== undefined)
  ) {
    let end: Date | null = null;
    if (typeof args.fim === "string") {
      end = parseLocal(args.fim, ctx.timeZone);
      if (!end || end <= start) problems.push("O fim precisa ser depois do início.");
    } else if (typeof args.duracao_min === "number" && args.duracao_min > 0) {
      end = new Date(start.getTime() + Math.min(args.duracao_min, 24 * 60) * 60_000);
    } else {
      end = new Date(start.getTime() + baseDuration);
    }
    if (end && ctx.extended) columns.ends_at = end.toISOString();
  }
  if (args.dia_inteiro !== undefined && ctx.extended) columns.all_day = args.dia_inteiro === true;
  return { columns, problems };
}

function describeColumns(columns: Record<string, unknown>, ctx: LumeContext): string {
  const parts: string[] = [];
  if (columns.scheduled_at)
    parts.push(`para ${humanLocal(new Date(String(columns.scheduled_at)), ctx.timeZone)}`);
  if (columns.title) parts.push(`título "${columns.title}"`);
  if (columns.status) parts.push(`status ${STATUS_LABEL[columns.status as VisitStatus]}`);
  if (columns.technician !== undefined) parts.push(`técnico ${columns.technician ?? "—"}`);
  if (columns.salesperson !== undefined) parts.push(`responsável ${columns.salesperson ?? "—"}`);
  if (columns.address !== undefined || columns.city !== undefined) parts.push("local");
  if (columns.notes !== undefined) parts.push("notas");
  if (columns.customer_name !== undefined) parts.push(`cliente ${columns.customer_name ?? "—"}`);
  return parts.join(", ") || "detalhes";
}

/** Compromissos da mesma pessoa que se sobrepõem ao intervalo. */
async function overlaps(
  ctx: LumeContext,
  start: Date,
  end: Date,
  people: Array<string | null | undefined>,
  ignoreId?: string,
) {
  const names = people.filter((name): name is string => !!name?.trim()).map(norm);
  if (!names.length) return [];
  const { data } = await ctx.client
    .from("visits")
    .select(selectColumns(ctx))
    .eq("company_id", ctx.companyId)
    .neq("status", "cancelada")
    .gte("scheduled_at", new Date(start.getTime() - 24 * 3_600_000).toISOString())
    .lt("scheduled_at", end.toISOString());
  return ((data ?? []) as unknown as Row[]).filter((event) => {
    if (event.id === ignoreId) return false;
    const involved = [event.technician, event.salesperson]
      .filter(Boolean)
      .map((n) => norm(String(n)));
    return (
      involved.some((name) => names.includes(name)) &&
      new Date(event.scheduled_at) < end &&
      eventEnd(event) > start
    );
  });
}

// ---------- Ferramentas ----------

const listEvents: LumeTool<{
  de: string;
  ate: string;
  busca?: string;
  pessoa?: string;
  status?: string;
}> = {
  name: "agenda_listar",
  domain: "agenda",
  description:
    "Lista compromissos num intervalo (horário local). Use antes de alterar ou excluir para achar o id certo.",
  parameters: {
    type: "object",
    properties: {
      de: { type: "string", description: "Início do intervalo: AAAA-MM-DD ou AAAA-MM-DDTHH:MM." },
      ate: { type: "string", description: "Fim do intervalo: AAAA-MM-DD ou AAAA-MM-DDTHH:MM." },
      busca: {
        type: "string",
        description: "Texto para filtrar por título, cliente, cidade ou notas.",
      },
      pessoa: { type: "string", description: "Nome do técnico ou responsável." },
      status: { type: "string", enum: STATUS_KEYS },
    },
    required: ["de", "ate"],
    additionalProperties: false,
  },
  risk: "read",
  summarize: () => "Consultar a agenda",
  async execute(args, ctx) {
    const from = parseLocal(args.de, ctx.timeZone);
    let to = parseLocal(args.ate, ctx.timeZone);
    if (!from || !to) return { output: { erro: "Intervalo inválido." } };
    if (/^\d{4}-\d{2}-\d{2}$/.test(args.ate.trim())) to = new Date(to.getTime() + 86_400_000 - 1);
    let query = ctx.client
      .from("visits")
      .select(selectColumns(ctx))
      .eq("company_id", ctx.companyId)
      .gte("scheduled_at", from.toISOString())
      .lte("scheduled_at", to.toISOString())
      .order("scheduled_at")
      .limit(300);
    if (args.status) query = query.eq("status", args.status);
    const { data, error } = await query;
    if (error) return { output: { erro: "Não consegui ler a agenda." } };
    const types = await companyTypes(ctx);
    const search = args.busca ? norm(args.busca) : "";
    const person = args.pessoa ? norm(args.pessoa) : "";
    const rows = ((data ?? []) as unknown as Row[]).filter((event) => {
      if (
        person &&
        ![event.technician, event.salesperson].some((n) => n && norm(n).includes(person))
      )
        return false;
      if (!search) return true;
      return norm(
        [event.title, event.customer_name, event.city, event.address, event.notes, event.product]
          .filter(Boolean)
          .join(" "),
      ).includes(search);
    });
    return {
      output: {
        total: rows.length,
        compromissos: rows.slice(0, MAX_LIST).map((event) => compact(event, ctx, types)),
        truncado: rows.length > MAX_LIST,
      },
    };
  },
};

const freeSlots: LumeTool<{
  de: string;
  ate: string;
  duracao_min: number;
  pessoa?: string;
  expediente_inicio?: string;
  expediente_fim?: string;
}> = {
  name: "agenda_horarios_livres",
  domain: "agenda",
  description:
    "Encontra horários livres (dias úteis, no expediente) para um compromisso, opcionalmente de uma pessoa.",
  parameters: {
    type: "object",
    properties: {
      de: { type: "string", description: "Primeiro dia: AAAA-MM-DD." },
      ate: { type: "string", description: "Último dia: AAAA-MM-DD." },
      duracao_min: { type: "integer", minimum: 5, maximum: 720 },
      pessoa: { type: "string" },
      expediente_inicio: { type: "string", description: "HH:MM, padrão 08:00." },
      expediente_fim: { type: "string", description: "HH:MM, padrão 18:00." },
    },
    required: ["de", "ate", "duracao_min"],
    additionalProperties: false,
  },
  risk: "read",
  summarize: () => "Procurar horários livres",
  async execute(args, ctx) {
    const first = parseLocal(args.de, ctx.timeZone);
    const last = parseLocal(args.ate, ctx.timeZone);
    if (!first || !last) return { output: { erro: "Intervalo inválido." } };
    const { data } = await ctx.client
      .from("visits")
      .select(selectColumns(ctx))
      .eq("company_id", ctx.companyId)
      .neq("status", "cancelada")
      .gte("scheduled_at", new Date(first.getTime() - 86_400_000).toISOString())
      .lte("scheduled_at", new Date(last.getTime() + 2 * 86_400_000).toISOString());
    const person = args.pessoa ? norm(args.pessoa) : "";
    const busy = ((data ?? []) as unknown as Row[])
      .filter((event) =>
        person
          ? [event.technician, event.salesperson].some((n) => n && norm(n).includes(person))
          : true,
      )
      .map((event) => [new Date(event.scheduled_at).getTime(), eventEnd(event).getTime()] as const);
    const slots: Array<{ inicio: string; fim: string }> = [];
    const step = 30 * 60_000;
    const duration = args.duracao_min * 60_000;
    for (let day = 0; day < 31 && slots.length < 12; day += 1) {
      const date = new Date(first.getTime() + day * 86_400_000);
      if (date > new Date(last.getTime() + 86_399_999)) break;
      const local = formatLocal(date, ctx.timeZone).slice(0, 10);
      const open = parseLocal(`${local}T${args.expediente_inicio ?? "08:00"}`, ctx.timeZone);
      const close = parseLocal(`${local}T${args.expediente_fim ?? "18:00"}`, ctx.timeZone);
      if (!open || !close) continue;
      const weekday = new Date(`${local}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (
        let at = open.getTime();
        at + duration <= close.getTime() && slots.length < 12;
        at += step
      ) {
        if (at < ctx.now.getTime()) continue;
        if (busy.some(([s, e]) => at < e && at + duration > s)) continue;
        slots.push({
          inicio: formatLocal(new Date(at), ctx.timeZone),
          fim: formatLocal(new Date(at + duration), ctx.timeZone),
        });
        at += duration - step;
      }
    }
    return { output: { horarios: slots } };
  },
};

const createEvent: LumeTool<EventArgs> = {
  name: "agenda_criar",
  domain: "agenda",
  description:
    "Cria um compromisso. Executa na hora e a pessoa pode desfazer. Informe pelo menos título e início.",
  parameters: {
    type: "object",
    properties: EVENT_FIELDS as unknown as Record<string, unknown>,
    required: ["titulo", "inicio"],
    additionalProperties: false,
  },
  risk: "safe",
  summarize: (args, ctx) => {
    const start = typeof args.inicio === "string" ? parseLocal(args.inicio, ctx.timeZone) : null;
    return `Criar "${String(args.titulo ?? "compromisso")}"${start ? ` em ${humanLocal(start, ctx.timeZone)}` : ""}`;
  },
  async execute(args, ctx) {
    const types = await companyTypes(ctx);
    const { columns, problems } = toColumns(args, ctx, types, null);
    if (!columns.title) problems.push("Falta o título.");
    if (!columns.scheduled_at) problems.push("Falta o início.");
    const type = resolveType(types, args.tipo);
    if (type?.requires_customer && !columns.customer_name)
      problems.push(`"${type.name}" precisa do nome do cliente.`);
    if (type?.requires_address && !columns.address)
      problems.push(`"${type.name}" precisa do endereço.`);
    if (problems.length) return { output: { erro: problems.join(" ") } };

    const row: Record<string, unknown> = {
      company_id: ctx.companyId,
      status: "agendada",
      appointment_type: "retorno_comercial",
      ...columns,
    };
    if (ctx.extended) {
      row.source = "lume";
      if (!row.ends_at)
        row.ends_at = new Date(
          new Date(String(row.scheduled_at)).getTime() +
            (type?.default_duration_min ?? 60) * 60_000,
        ).toISOString();
    }
    const start = new Date(String(row.scheduled_at));
    const end = row.ends_at ? new Date(String(row.ends_at)) : new Date(start.getTime() + 3_600_000);
    const clash = await overlaps(ctx, start, end, [
      row.technician as string,
      row.salesperson as string,
    ]);

    const { data, error } = await ctx.client.from("visits").insert(row).select("id").single();
    if (error || !data)
      return {
        output: { erro: "O banco recusou o compromisso (verifique sua permissão de agenda)." },
      };
    const id = (data as { id: string }).id;
    if (ctx.extended && type?.checklist_template.length) {
      await ctx.client.from("agenda_checklist_items").insert(
        type.checklist_template.map((label, position) => ({
          company_id: ctx.companyId,
          event_id: id,
          label,
          position,
        })),
      );
    }
    return {
      output: {
        criado: {
          id,
          inicio: formatLocal(start, ctx.timeZone),
          fim: formatLocal(end, ctx.timeZone),
        },
        conflitos: clash.map((event) => ({
          titulo: event.title,
          inicio: formatLocal(new Date(event.scheduled_at), ctx.timeZone),
        })),
      },
      undo: { op: "delete_events", ids: [id] },
      touched: [id],
    };
  },
};

const updateEvent: LumeTool<{ id: string } & EventArgs> = {
  name: "agenda_alterar",
  domain: "agenda",
  description:
    "Altera um compromisso existente (remarcar, trocar status, pessoa, local, notas). Precisa do id; a pessoa confirma antes.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" }, ...(EVENT_FIELDS as unknown as Record<string, unknown>) },
    required: ["id"],
    additionalProperties: false,
  },
  risk: "confirm",
  async summarize(args, ctx) {
    const [event] = await loadEvents(ctx, [args.id]).catch(() => []);
    const types = await companyTypes(ctx);
    const { columns } = toColumns(args, ctx, types, event ?? null);
    return `Alterar "${event?.title ?? "compromisso"}": ${describeColumns(columns, ctx)}`;
  },
  async execute(args, ctx) {
    const [current] = await loadEvents(ctx, [args.id]);
    if (!current) return { output: { erro: "Compromisso não encontrado." } };
    const types = await companyTypes(ctx);
    const { columns, problems } = toColumns(args, ctx, types, current);
    if (problems.length) return { output: { erro: problems.join(" ") } };
    if (!Object.keys(columns).length) return { output: { erro: "Nada para alterar." } };
    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(columns))
      previous[key] = (current as unknown as Record<string, unknown>)[key] ?? null;
    const { error } = await ctx.client.from("visits").update(columns).eq("id", current.id);
    if (error) return { output: { erro: "O banco recusou a alteração." } };
    let clash: Row[] = [];
    if (columns.scheduled_at || columns.technician || columns.salesperson) {
      const merged = { ...current, ...columns } as Row;
      clash = await overlaps(
        ctx,
        new Date(merged.scheduled_at),
        eventEnd(merged),
        [merged.technician, merged.salesperson],
        current.id,
      );
    }
    return {
      output: {
        alterado: current.id,
        conflitos: clash.map((event) => ({
          titulo: event.title,
          inicio: formatLocal(new Date(event.scheduled_at), ctx.timeZone),
        })),
      },
      undo: { op: "update_event", id: current.id, changes: previous },
      touched: [current.id],
    };
  },
};

const deleteEvents: LumeTool<{ ids: string[] }> = {
  name: "agenda_excluir",
  domain: "agenda",
  description:
    "Exclui um ou mais compromissos pelos ids. A pessoa confirma antes; dá para desfazer.",
  parameters: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_BULK },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  risk: "confirm",
  async summarize(args, ctx) {
    const rows = await loadEvents(ctx, args.ids.slice(0, MAX_BULK)).catch(() => []);
    if (rows.length === 1)
      return `Excluir "${rows[0].title}" (${humanLocal(new Date(rows[0].scheduled_at), ctx.timeZone)})`;
    return `Excluir ${rows.length || args.ids.length} compromissos`;
  },
  async execute(args, ctx) {
    const rows = await loadEvents(ctx, args.ids.slice(0, MAX_BULK));
    if (!rows.length) return { output: { erro: "Nenhum compromisso encontrado com esses ids." } };
    const { error } = await ctx.client
      .from("visits")
      .delete()
      .in(
        "id",
        rows.map((row) => row.id),
      );
    if (error) return { output: { erro: "O banco recusou a exclusão." } };
    return {
      output: { excluidos: rows.length },
      undo: { op: "restore_events", rows: rows as unknown as Array<Record<string, unknown>> },
      touched: rows.map((row) => row.id),
    };
  },
};

const remind: LumeTool<{ id: string; minutos_antes: number; canal?: "app" | "email" }> = {
  name: "agenda_lembrete",
  domain: "agenda",
  description:
    "Agenda um lembrete para os participantes de um compromisso (no Lume ou por e-mail).",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      minutos_antes: { type: "integer", minimum: 0, maximum: 43200 },
      canal: { type: "string", enum: ["app", "email"] },
    },
    required: ["id", "minutos_antes"],
    additionalProperties: false,
  },
  risk: "safe",
  summarize: (args) =>
    `Lembrar ${args.minutos_antes >= 60 ? `${Math.round(args.minutos_antes / 60)} h` : `${args.minutos_antes} min`} antes${args.canal === "email" ? " por e-mail" : ""}`,
  async execute(args, ctx) {
    if (!ctx.extended)
      return {
        output: { erro: "Lembretes ficam disponíveis após publicar a atualização da Agenda." },
      };
    // Só lembra de compromisso que esta pessoa enxerga na própria empresa.
    const [event] = await loadEvents(ctx, [args.id]).catch(() => []);
    if (!event) return { output: { erro: "Compromisso não encontrado." } };
    const { data, error } = await ctx.client
      .from("agenda_reminders")
      .insert({
        company_id: ctx.companyId,
        event_id: args.id,
        offset_min: args.minutos_antes,
        channel: args.canal ?? "app",
      })
      .select("id")
      .single();
    if (error || !data) return { output: { erro: "Não consegui criar o lembrete." } };
    const id = (data as { id: string }).id;
    return {
      output: { lembrete: id },
      undo: { op: "delete_rows", table: "agenda_reminders", ids: [id] },
      touched: [args.id],
    };
  },
};

const notify: LumeTool<{
  para: string[];
  titulo: string;
  mensagem?: string;
  compromisso_id?: string;
}> = {
  name: "equipe_avisar",
  domain: "agenda",
  description:
    "Envia um aviso dentro do Lume para pessoas da equipe (pelo nome, ou 'todos'). A pessoa confirma antes.",
  parameters: {
    type: "object",
    properties: {
      para: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 30 },
      titulo: { type: "string" },
      mensagem: { type: "string" },
      compromisso_id: { type: "string" },
    },
    required: ["para", "titulo"],
    additionalProperties: false,
  },
  risk: "confirm",
  summarize: (args) => `Avisar ${args.para.join(", ")}: "${args.titulo}"`,
  async execute(args, ctx) {
    if (!ctx.extended)
      return {
        output: { erro: "Avisos ficam disponíveis após publicar a atualização da Agenda." },
      };
    const team = await teamNames(ctx);
    const everyone = args.para.some((name) =>
      ["todos", "equipe", "todo mundo"].includes(norm(name)),
    );
    const targets = everyone
      ? team
      : team.filter((member) => args.para.some((name) => norm(member.name).includes(norm(name))));
    const missing = everyone
      ? []
      : args.para.filter((name) => !team.some((member) => norm(member.name).includes(norm(name))));
    if (!targets.length)
      return { output: { erro: `Não encontrei na equipe: ${args.para.join(", ")}.` } };
    const rows = targets.map((member) => ({
      company_id: ctx.companyId,
      user_id: member.id,
      domain: "agenda",
      title: args.titulo.slice(0, 160),
      body: [args.mensagem?.slice(0, 1000), ctx.userName ? `— ${ctx.userName}, via Lume` : null]
        .filter(Boolean)
        .join("\n"),
      link: args.compromisso_id ? `/agenda?evento=${args.compromisso_id}` : "/agenda",
    }));
    const { data, error } = await ctx.client.from("lume_notifications").insert(rows).select("id");
    if (error) return { output: { erro: "Não consegui enviar os avisos." } };
    return {
      output: { avisados: targets.map((member) => member.name), nao_encontrados: missing },
      undo: {
        op: "delete_rows",
        table: "lume_notifications",
        ids: (data ?? []).map((row: { id: string }) => row.id),
      },
    };
  },
};

const createAutomation: LumeTool<{
  nome: string;
  quando: "compromisso_criado" | "antes_do_compromisso" | "resumo_diario";
  tipo?: string;
  minutos_antes?: number;
  horario?: string;
  acoes: Array<{
    acao: "lembrete" | "avisar";
    para?: string[];
    canal?: "app" | "email";
    mensagem?: string;
  }>;
}> = {
  name: "automacao_criar",
  domain: "agenda",
  description:
    "Cria uma automação 'quando X, faça Y' na agenda: ao criar compromisso (de um tipo), antes de cada compromisso, ou resumo diário. A pessoa confirma antes.",
  parameters: {
    type: "object",
    properties: {
      nome: { type: "string" },
      quando: {
        type: "string",
        enum: ["compromisso_criado", "antes_do_compromisso", "resumo_diario"],
      },
      tipo: { type: "string", description: "Só para compromissos deste tipo (opcional)." },
      minutos_antes: { type: "integer", minimum: 0, maximum: 43200 },
      horario: { type: "string", description: "HH:MM do resumo diário." },
      acoes: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            acao: { type: "string", enum: ["lembrete", "avisar"] },
            para: { type: "array", items: { type: "string" } },
            canal: { type: "string", enum: ["app", "email"] },
            mensagem: { type: "string" },
          },
          required: ["acao"],
          additionalProperties: false,
        },
      },
    },
    required: ["nome", "quando", "acoes"],
    additionalProperties: false,
  },
  risk: "confirm",
  summarize: (args) => `Criar automação "${args.nome}"`,
  async execute(args, ctx) {
    if (!ctx.extended)
      return {
        output: { erro: "Automações ficam disponíveis após publicar a atualização da Agenda." },
      };
    const trigger = {
      event:
        args.quando === "compromisso_criado"
          ? "agenda.event_created"
          : args.quando === "antes_do_compromisso"
            ? "agenda.event_upcoming"
            : "agenda.daily_briefing",
      type: args.tipo ?? null,
      minutes_before: args.minutos_antes ?? null,
      at: args.horario ?? null,
    };
    const { data, error } = await ctx.client
      .from("lume_automations")
      .insert({
        company_id: ctx.companyId,
        name: args.nome.slice(0, 120),
        domain: "agenda",
        trigger,
        actions: args.acoes,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !data) return { output: { erro: "Não consegui salvar a automação." } };
    const id = (data as { id: string }).id;
    return {
      output: { automacao: id },
      undo: { op: "delete_rows", table: "lume_automations", ids: [id] },
    };
  },
};

const UNDO_TABLES = new Set([
  "agenda_reminders",
  "lume_notifications",
  "lume_automations",
  "agenda_checklist_items",
]);

export const agendaDomain: LumeDomain = {
  id: "agenda",
  async instructions(ctx) {
    const [types, team] = await Promise.all([companyTypes(ctx), teamNames(ctx)]);
    const typeLines = types.length
      ? types
          .map(
            (type) =>
              `- ${type.name} (${type.kind}, ${type.default_duration_min} min${type.requires_customer ? ", exige cliente" : ""}${type.requires_address ? ", exige endereço" : ""})`,
          )
          .join("\n")
      : Object.values(TYPE_LABEL)
          .map((type) => `- ${type.label}`)
          .join("\n");
    return `AGENDA DA EMPRESA
Tipos de compromisso:
${typeLines}
Equipe com conta no Lume: ${team.map((member) => member.name).join(", ") || "(não informada)"}
Regras da agenda:
- Datas e horas sempre em horário local no formato AAAA-MM-DDTHH:MM. Resolva "amanhã", "sexta", "semana que vem" a partir de AGORA.
- Para alterar ou excluir, primeiro use agenda_listar para achar o id certo. Se houver mais de um candidato, pergunte qual.
- Ao criar, se faltar só um detalhe opcional, crie assim mesmo e diga o que pode ser completado. Se faltar dia ou hora, pergunte.
- Se a ferramenta devolver conflitos, avise a pessoa com os horários que se chocam.
- Não peça "tem certeza?": o sistema mostra o cartão de confirmação sozinho para alterações, exclusões e avisos.`;
  },
  tools: [
    listEvents,
    freeSlots,
    createEvent,
    updateEvent,
    deleteEvents,
    remind,
    notify,
    createAutomation,
  ] as LumeTool<never>[],
  async undo(undo: LumeUndo, ctx) {
    if (undo.op === "delete_events") {
      const { error } = await ctx.client
        .from("visits")
        .delete()
        .eq("company_id", ctx.companyId)
        .in("id", undo.ids);
      if (error) throw new Error("Não foi possível desfazer.");
    } else if (undo.op === "restore_events") {
      const rows = undo.rows.map((row) => {
        const { created_at: _c, updated_at: _u, created_by: _cb, updated_by: _ub, ...rest } = row;
        return { ...rest, company_id: ctx.companyId };
      });
      const { error } = await ctx.client.from("visits").insert(rows);
      if (error) throw new Error("Não foi possível restaurar os compromissos.");
    } else if (undo.op === "update_event") {
      const { error } = await ctx.client
        .from("visits")
        .update(undo.changes)
        .eq("company_id", ctx.companyId)
        .eq("id", undo.id);
      if (error) throw new Error("Não foi possível desfazer a alteração.");
    } else if (undo.op === "delete_rows") {
      if (!UNDO_TABLES.has(undo.table)) throw new Error("Desfazer não suportado.");
      const { error } = await ctx.client
        .from(undo.table)
        .delete()
        .eq("company_id", ctx.companyId)
        .in("id", undo.ids);
      if (error) throw new Error("Não foi possível desfazer.");
    }
  },
};
