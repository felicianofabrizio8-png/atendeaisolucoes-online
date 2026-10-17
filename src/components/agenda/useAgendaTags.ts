import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { AgendaTag } from "./agenda-model";

/**
 * Tags da Agenda. Da empresa (owner_id vazio: gestão cria) e pessoais (só a dona vê).
 * Nada vem pronto: cada empresa monta as suas.
 */
export function useAgendaTags(companyId: string | null | undefined, enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tags, setTags] = useState<AgendaTag[]>([]);
  const table = () => supabase.from("agenda_tags" as never);

  const load = useCallback(async () => {
    if (!companyId || !enabled) {
      setTags([]);
      return;
    }
    const { data } = await table()
      .select("id,name,hue,owner_id")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setTags((data ?? []) as unknown as AgendaTag[]);
  }, [companyId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: { name: string; hue: number; personal: boolean }) => {
      if (!companyId) return null;
      const row = {
        company_id: companyId,
        name: input.name.trim(),
        hue: input.hue,
        owner_id: input.personal ? userId : null,
      };
      const { data, error } = await table()
        .insert(row as never)
        .select("id,name,hue,owner_id")
        .single();
      if (error || !data) {
        toast.error(
          error?.code === "23505"
            ? "Já existe uma tag com esse nome."
            : "Não foi possível criar a tag.",
        );
        return null;
      }
      await load();
      return data as unknown as AgendaTag;
    },
    [companyId, userId, load],
  );

  const update = useCallback(
    async (id: string, changes: { name?: string; hue?: number }) => {
      const { error } = await table()
        .update(changes as never)
        .eq("id", id);
      if (error) toast.error("Não foi possível alterar a tag.");
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await table().delete().eq("id", id);
      if (error) toast.error("Não foi possível excluir a tag.");
      await load();
    },
    [load],
  );

  const companyTags = useMemo(() => tags.filter((tag) => tag.owner_id === null), [tags]);
  const myTags = useMemo(() => tags.filter((tag) => tag.owner_id === userId), [tags, userId]);
  return { tags, companyTags, myTags, create, update, remove };
}
