import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STARTER_TYPES, type AgendaEventType } from "./agenda-model";

const COLUMNS =
  "id,name,hue,icon,kind,default_duration_min,requires_customer,requires_address,checklist_template,fields,legacy_type,position,active";

export type EventTypeDraft = Omit<AgendaEventType, "id" | "position" | "active">;

/** Tipos de evento da empresa. Sem a estrutura nova no banco, a lista fica vazia. */
export function useEventTypes(companyId: string | null | undefined, extended: boolean) {
  const [types, setTypes] = useState<AgendaEventType[]>([]);
  const [loading, setLoading] = useState(false);

  const table = () => supabase.from("agenda_event_types" as never);

  const load = useCallback(async () => {
    if (!companyId || !extended) {
      setTypes([]);
      return;
    }
    setLoading(true);
    const { data } = await table()
      .select(COLUMNS)
      .eq("company_id", companyId)
      .order("position", { ascending: true });
    setTypes((data ?? []) as unknown as AgendaEventType[]);
    setLoading(false);
  }, [companyId, extended]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (draft: EventTypeDraft, id?: string) => {
      if (!companyId) return false;
      const row = { ...draft, company_id: companyId };
      const { error } = id
        ? await table()
            .update(row as never)
            .eq("id", id)
        : await table().insert({ ...row, position: types.length } as never);
      if (error) {
        toast.error(
          error.code === "23505"
            ? "Já existe um tipo com esse nome."
            : "Não foi possível salvar o tipo.",
        );
        return false;
      }
      await load();
      return true;
    },
    [companyId, load, types.length],
  );

  const setActive = useCallback(
    async (id: string, active: boolean) => {
      const { error } = await table()
        .update({ active } as never)
        .eq("id", id);
      if (error) toast.error("Não foi possível alterar o tipo.");
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      // Eventos desse tipo continuam existindo: o banco limpa a referência.
      const { error } = await table().delete().eq("id", id);
      if (error) toast.error("Não foi possível excluir o tipo.");
      await load();
    },
    [load],
  );

  /** Ponto de partida para empresa nova: tipos genéricos que ela edita depois. */
  const seedStarters = useCallback(async () => {
    if (!companyId) return;
    const rows = STARTER_TYPES.map((type, position) => ({
      ...type,
      company_id: companyId,
      position,
      fields: [],
    }));
    const { error } = await table().insert(rows as never);
    if (error) toast.error("Não foi possível criar os tipos sugeridos.");
    await load();
  }, [companyId, load]);

  return { types, loading, reload: load, save, setActive, remove, seedStarters };
}
