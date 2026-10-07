import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "./useTeamAccess";
import { supabase } from "@/integrations/supabase/client";
import { teamRpc } from "@/lib/team/client";

export function useTeamDirectory() {
  const { user, profile } = useAuth();
  return useQuery({
    queryKey: ["team-directory", profile?.company_id, user?.id],
    enabled: !!profile && !!user,
    queryFn: () =>
      teamRpc<Array<{ id: string; name: string; canReply: boolean }>>("team_directory"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
export function useLeadAssignment(leadId?: string) {
  const { user, profile } = useAuth();
  const access = useTeamAccess();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["lead-assignment", profile?.company_id, user?.id, leadId],
    enabled: !!leadId && !!profile && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("assigned_to")
        .eq("id", leadId!)
        .eq("company_id", profile!.company_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
    staleTime: 0,
  });
  useEffect(() => {
    if (!leadId) return;
    const channel = supabase
      .channel(`lead-owner:${leadId}:${Math.random()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: `id=eq.${leadId}` },
        () => {
          void cache.invalidateQueries({ queryKey: ["lead-assignment"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leadId, cache]);
  return {
    ...query,
    ready: access.access?.schemaReady === true,
    userId: user?.id,
    assignedTo: query.data?.assigned_to,
    canReply:
      access.access?.schemaReady === false
        ? access.isAdmin
        : !query.isError &&
          !!query.data &&
          query.data.assigned_to === user?.id &&
          access.can("conversations.reply"),
    canClaim: !!query.data && !query.data.assigned_to && access.can("conversations.reply"),
    canTransfer: !!query.data && access.can("conversations.assign"),
    assign: async (target: string | null) => {
      await teamRpc("team_assign_lead", { _lead: leadId, _user: target });
      await cache.invalidateQueries({ queryKey: ["lead-assignment"] });
      if (profile) {
        const { loadRemote, refreshTeamScope } = await import("@/data/leadRepo");
        await loadRemote(profile.company_id);
        await refreshTeamScope(profile.company_id);
      }
    },
  };
}
