import { useState } from "react";
import { toast } from "sonner";
import { takeOverConversation } from "@/lib/inbox/conversation-actions";

/** Humano assume a conversa (IA pausada), com o feedback padrão. */
export function useTakeOver(conversationId: string) {
  const [takingOver, setTakingOver] = useState(false);
  const takeOver = async () => {
    if (takingOver) return;
    setTakingOver(true);
    try {
      await takeOverConversation(conversationId);
      toast.success("Você assumiu o atendimento. IA pausada para esta conversa.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao assumir atendimento");
    } finally {
      setTakingOver(false);
    }
  };
  return { takeOver, takingOver };
}
