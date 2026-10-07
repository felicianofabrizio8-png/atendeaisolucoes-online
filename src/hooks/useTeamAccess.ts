import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readTeamAccess } from "@/lib/team/access";
import { can, canOpenPage, type Permission } from "@/lib/team/permissions";

export function useTeamAccess() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const companyId = profile?.company_id;
  const query = useQuery({
    queryKey: ["team-access", user?.id, companyId],
    enabled: !!user,
    queryFn: () =>
      readTeamAccess(supabase as unknown as Parameters<typeof readTeamAccess>[0], user!.id),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`team-access:${user?.id}:${companyId}:${Math.random()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_member_access",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["team-access"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `company_id=eq.${companyId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["team-access"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, user?.id, queryClient]);
  // Fail closed even when stale data exists after a failed refresh.
  const access = query.isError ? undefined : query.data;
  return {
    ...query,
    access,
    isAdmin: !!access?.active && access.role === "admin",
    can: (p: Permission) => can(access, p),
    canOpen: (path: string) => canOpenPage(access, path),
  };
}
