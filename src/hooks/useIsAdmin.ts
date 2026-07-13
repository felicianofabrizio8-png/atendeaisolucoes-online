// useIsAdmin — hook centralizado que consulta has_role(admin) uma vez por sessão.
// Usa TanStack Query com cache infinito para evitar consultas redundantes.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";

export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { user, profile } = useAuth();
  const q = useQuery({
    queryKey: ["is-admin", user?.id, profile?.company_id],
    enabled: Boolean(user?.id && profile?.company_id),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase.rpc("has_role", {
        _user_id: user!.id,
        _company_id: profile!.company_id,
        _role: "admin",
      });
      return Boolean(data);
    },
  });
  return { isAdmin: Boolean(q.data), isLoading: q.isLoading };
}
