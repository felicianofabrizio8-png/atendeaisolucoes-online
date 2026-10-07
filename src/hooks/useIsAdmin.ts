import { useTeamAccess } from "./useTeamAccess";
export function useIsAdmin() {
  const access = useTeamAccess();
  return { isAdmin: access.isAdmin, isLoading: access.isPending };
}
