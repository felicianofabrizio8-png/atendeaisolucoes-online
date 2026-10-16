import { supabase } from "@/integrations/supabase/client";

/**
 * A estrutura nova da Agenda (autoria, histórico, tipos, checklist…) chega ao banco
 * pela migração 20261015120000. Enquanto ela não foi aplicada, a tela funciona com as
 * colunas de sempre e mostra o que falta. A checagem roda uma vez por sessão.
 */
export interface AgendaSchema {
  extended: boolean;
}

let cached: Promise<AgendaSchema> | null = null;

export function detectAgendaSchema(): Promise<AgendaSchema> {
  cached ??= (async () => {
    const { error } = await supabase
      .from("agenda_event_types" as never)
      .select("id")
      .limit(1);
    return { extended: !error };
  })().catch(() => ({ extended: false }));
  return cached;
}

/** Para testes e para depois de publicar sem recarregar a página. */
export function resetAgendaSchema() {
  cached = null;
}

export const PENDING_SCHEMA_MESSAGE = "Disponível assim que a atualização da Agenda for publicada.";
