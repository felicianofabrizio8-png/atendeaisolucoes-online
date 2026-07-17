import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";

export type Admin = SupabaseClient;

export function createAdmin(cfg: WorkerConfig): Admin {
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
