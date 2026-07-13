// Hook que consome GET /api/executive/snapshot via TanStack Query.
// READ-ONLY. Não altera cache nem duplica lógica do Executive Intelligence.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExecutiveDashboardBundle, ExecutivePeriod } from "@/lib/executive-ai/types";

export type SnapshotPeriod = Extract<ExecutivePeriod, "7d" | "30d" | "90d">;

export class SnapshotError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function fetchSnapshot(period: SnapshotPeriod): Promise<ExecutiveDashboardBundle> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new SnapshotError(401, "unauthorized");

  const res = await fetch(`/api/executive/snapshot?period=${period}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* noop */
  }
  if (!res.ok || !body || typeof body !== "object" || !(body as { ok?: boolean }).ok) {
    const code =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${res.status}`;
    throw new SnapshotError(res.status, code);
  }
  return (body as { data: ExecutiveDashboardBundle }).data;
}

export function useExecutiveSnapshot(period: SnapshotPeriod) {
  return useQuery({
    queryKey: ["executive-snapshot", period],
    queryFn: () => fetchSnapshot(period),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: (count, err) => {
      if (err instanceof SnapshotError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });
}
