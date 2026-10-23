import { useEffect, useState } from "react";
import { useOptionalAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAiReplyScope, type AiReplyScope } from "@/lib/ai-reply-control";

export function useAiGlobalConfig(): { scope: AiReplyScope | null; enabled: boolean | null } {
  const auth = useOptionalAuth();
  const companyId = auth?.profile?.company_id;
  const [config, setConfig] = useState<{ scope: AiReplyScope | null; enabled: boolean | null }>({ scope: null, enabled: null });

  useEffect(() => {
    let active = true;
    if (!companyId) {
      setConfig({ scope: null, enabled: null });
      return () => { active = false; };
    }
    void supabase
      .from("company_settings")
      .select("ai_auto_reply_scope, ai_auto_reply_enabled")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(
        ({ data }) => {
          if (!active) return;
          const row = data as { ai_auto_reply_scope?: unknown; ai_auto_reply_enabled?: boolean | null } | null;
          setConfig({
            scope: normalizeAiReplyScope(row?.ai_auto_reply_scope, row?.ai_auto_reply_enabled ?? false),
            enabled: row ? row.ai_auto_reply_enabled === true : false,
          });
        },
        () => {
          if (active) setConfig({ scope: null, enabled: null });
        },
      );
    return () => { active = false; };
  }, [companyId]);

  return config;
}
