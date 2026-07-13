// Hook para consumir GET /api/executive/sales-intelligence via TanStack Query.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SalesIntelligenceBundle } from "@/lib/sales-intelligence/SalesIntelligenceTypes";

export type SalesPeriod = "7d" | "30d" | "90d";

export class SalesIntelligenceError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

async function fetchBundle(period: SalesPeriod): Promise<SalesIntelligenceBundle> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new SalesIntelligenceError(401, "unauthorized");

  const res = await fetch(`/api/executive/sales-intelligence?period=${period}`, {
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
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${res.status}`;
    throw new SalesIntelligenceError(res.status, code);
  }
  return (body as { data: SalesIntelligenceBundle }).data;
}

export function useSalesIntelligence(period: SalesPeriod) {
  return useQuery({
    queryKey: ["sales-intelligence", period],
    queryFn: () => fetchBundle(period),
    staleTime: 45_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: (count, err) => {
      if (err instanceof SalesIntelligenceError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });
}
