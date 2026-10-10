// Proteção contra publicação duplicada do MESMO conteúdo no MESMO canal por
// cliques repetidos ou pedidos simultâneos. Regras puras (sem IO), usadas em
// três pontos: antes de gravar o agendamento, logo depois de gravar (para o
// caso de dois pedidos ao mesmo tempo) e quando o agendamento vira publicação.
//
// Não impede republicar de propósito: agendamentos em horários diferentes
// convivem, e depois que uma publicação termina (e passa a janela) o mesmo
// conteúdo pode ser publicado de novo.

/** Dois pedidos para o mesmo conteúdo e canal dentro desta janela são o mesmo pedido. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface ScheduleSibling {
  id: string;
  status: string;
  scheduled_at: string;
  created_at: string;
}

export interface ScheduleCandidate {
  /** Ausente = ainda não gravado (conferência antes de inserir). */
  id?: string;
  scheduled_at: string;
  created_at?: string;
}

const ms = (iso: string | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Ordem estável entre agendamentos: horário, criação, id. O primeiro vence. */
export function comesBefore(a: { id: string; scheduled_at: string; created_at?: string }, b: { id: string; scheduled_at: string; created_at?: string }): boolean {
  const byTime = ms(a.scheduled_at) - ms(b.scheduled_at);
  if (byTime !== 0) return byTime < 0;
  const byCreation = ms(a.created_at) - ms(b.created_at);
  if (byCreation !== 0) return byCreation < 0;
  return a.id < b.id;
}

/**
 * Agendamento do mesmo conteúdo e canal que torna `candidate` uma repetição,
 * ou null. `siblings` = outros agendamentos do MESMO conteúdo e canal (a
 * consulta já restringe à empresa).
 *
 * - "request": pedido do usuário. Além da janela, um "publicar agora" é
 *   recusado enquanto houver outro envio do mesmo conteúdo ainda em andamento.
 * - "materialize": fila. Só a janela conta — agendamentos antigos em horários
 *   distintos, mesmo atrasados, são todos publicados.
 */
export function findDuplicateSchedule(
  candidate: ScheduleCandidate,
  siblings: ScheduleSibling[],
  options: { mode: "request" | "materialize"; now?: Date },
): ScheduleSibling | null {
  const now = (options.now ?? new Date()).getTime();
  const at = ms(candidate.scheduled_at);
  const dueSoon = (t: number) => t <= now + DUPLICATE_WINDOW_MS;
  for (const s of siblings) {
    if (candidate.id && s.id === candidate.id) continue;
    const near = Math.abs(ms(s.scheduled_at) - at) <= DUPLICATE_WINDOW_MS;
    const bothNow = options.mode === "request" && dueSoon(at) && dueSoon(ms(s.scheduled_at));
    if (s.status === "queued" && (near || bothNow)) return s;
    if (s.status === "published" && near) return s;
    if (s.status === "planned" && (near || bothNow)) {
      // Já gravado: entre dois pedidos pendentes só o primeiro da ordem segue.
      if (!candidate.id || comesBefore(s, { id: candidate.id, scheduled_at: candidate.scheduled_at, created_at: candidate.created_at })) return s;
    }
  }
  return null;
}

export function duplicateMessage(canal: string, sibling: Pick<ScheduleSibling, "status">): string {
  return sibling.status === "published"
    ? `Este conteúdo acabou de ser publicado no ${canal}. Para publicar de novo, aguarde alguns minutos e repita o pedido.`
    : `Já existe uma publicação deste conteúdo em andamento no ${canal}. Aguarde a conclusão (ou cancele o envio na Agenda) antes de publicar de novo.`;
}
