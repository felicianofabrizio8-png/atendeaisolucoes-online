// ============================================================================
// Upload Security — Repository. Registra hashes e detecta duplicidade.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface UploadRecord {
  companyId: string;
  bucket: string;
  objectPath: string;
  sha256: string;
  byteSize: number;
  mime?: string | null;
  magicFamily?: string | null;
}

export class UploadHashRepository {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async recordOrDedupe(
    input: UploadRecord,
  ): Promise<{ recorded: boolean; existing?: { objectPath: string } }> {
    const { data: existing } = await this.writer
      .from("upload_hashes")
      .select("object_path")
      .eq("company_id", input.companyId)
      .eq("sha256", input.sha256)
      .maybeSingle();
    if (existing) {
      return { recorded: false, existing: { objectPath: existing.object_path } };
    }
    const { error } = await this.writer.from("upload_hashes").insert({
      company_id: input.companyId,
      bucket: input.bucket,
      object_path: input.objectPath,
      sha256: input.sha256,
      byte_size: input.byteSize,
      mime: input.mime ?? null,
      magic_family: input.magicFamily ?? null,
    });
    if (error && error.code !== "23505") {
      throw new Error(`[UploadHash.record] ${error.message}`);
    }
    return { recorded: !error };
  }
}
