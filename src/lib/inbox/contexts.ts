import { createContext } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { Message } from "@/data/mock";

/**
 * Contexto leve com as mensagens da conversa atual.
 * Usado pelo ReplyPreview para localizar a mensagem original e reconstruir
 * a miniatura quando o reply_to (vindo do webhook) não traz media_path —
 * caso típico de respostas a imagens enviadas pelo próprio agente.
 */
export const MessagesContext = createContext<Message[]>([]);

/**
 * Onda 2.4: dá ao ReplyPreview acesso à lista virtualizada para localizar a
 * mensagem original via scrollToIndex (caso esteja fora do viewport montado).
 */
export const VirtuosoScrollContext = createContext<{
  ref: React.RefObject<VirtuosoHandle | null>;
  items: Message[];
} | null>(null);

/**
 * Feature 3 — Reply: permite que a MessageBubble (filha) dispare o estado de
 * "respondendo a esta mensagem" no composer da ConversationPage (pai), sem
 * acoplar via props.
 */
export const ReplyComposeContext = createContext<{ start: (m: Message) => void }>({
  start: () => {
    /* no-op por padrão */
  },
});
