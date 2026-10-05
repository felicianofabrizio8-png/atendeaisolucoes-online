import { useState } from "react";
import { toast } from "sonner";
import { releaseConversationToAi, takeOverConversation } from "@/lib/inbox/conversation-actions";

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
  // Caminho de volta: o humano devolve a conversa e a IA atua de novo na próxima mensagem do cliente.
  const [releasing, setReleasing] = useState(false);
  const release = async () => {
    if (releasing) return;
    setReleasing(true);
    try {
      await releaseConversationToAi(conversationId);
      toast.success("Conversa devolvida para a IA. Ela volta a atuar na próxima mensagem do cliente.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao devolver para a IA");
    } finally {
      setReleasing(false);
    }
  };
  return { takeOver, takingOver, release, releasing };
}
