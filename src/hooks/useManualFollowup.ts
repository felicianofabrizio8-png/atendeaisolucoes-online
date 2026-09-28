import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  runFollowupNowForConversation,
  type ManualFollowupResult,
} from "@/lib/manual-followup.functions";

/** "Executar Follow-up Agora": roda o motor ignorando os tempos configurados. */
export function useManualFollowup(
  conversationId: string,
  onUpdated?: () => void | Promise<void>,
) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ManualFollowupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runManualFollowup = useServerFn(runFollowupNowForConversation);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runManualFollowup({ data: { conversationId } });
      setResult(res);
      await onUpdated?.();
      if (res.sendStatus === "sent") toast.success("Follow-up enviado");
      else if (res.sendStatus === "failed") toast.error("Falha ao enviar follow-up");
      else if (!res.eligible)
        toast.message("Follow-up bloqueado", { description: res.blockedReason });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error("Erro ao executar follow-up");
    } finally {
      setRunning(false);
    }
  }, [conversationId, onUpdated, running, runManualFollowup]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { run, running, result, error, clear };
}
