import { supabase } from "@/integrations/supabase/client";

// Isolates RPCs introduced by the team migration until the generated DB types are refreshed.
export async function teamRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
