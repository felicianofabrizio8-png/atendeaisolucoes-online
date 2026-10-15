import { useQuery } from "@tanstack/react-query";
import { teamRpc } from "@/lib/team/client";

export interface TeamMember {
  id: string;
  name: string;
}

/** Membros ativos da equipe (dono e participantes dos compromissos). */
export function useTeamDirectory(enabled: boolean): TeamMember[] {
  const query = useQuery({
    queryKey: ["team-directory"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const rows = await teamRpc<Array<{ id: string; name: string }>>("team_directory");
        return rows.map((row) => ({ id: row.id, name: row.name }));
      } catch {
        return [];
      }
    },
  });
  return query.data ?? [];
}
