// Sem UI. Liga o emitter de novas mensagens (leadRepo) ao serviço de notificações.
// Suprime a notificação browser quando a conversa já está aberta e visível.

import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { subscribeNewLeadMessage, getLeadById, getConversationById } from "@/data/leadRepo";
import { notifyNewLeadMessage, describeMessage, setupAudioUnlock } from "@/lib/notifications";

export function NotificationBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setupAudioUnlock();
  }, []);

  useEffect(() => {
    const unsub = subscribeNewLeadMessage((evt) => {
      const conv = getConversationById(evt.conversationId);
      const lead = conv ? getLeadById(conv.leadId) : undefined;
      const leadName = lead?.name ?? lead?.phone ?? lead?.handle ?? "Nova mensagem";

      const isViewingThisConv =
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        location.pathname === `/inbox/${evt.conversationId}`;

      notifyNewLeadMessage({
        messageId: evt.messageId,
        externalId: evt.externalId,
        conversationId: evt.conversationId,
        leadName,
        body: describeMessage(evt.text, evt.subtype, evt.metadata),
        suppressBrowser: isViewingThisConv,
        onOpen: () => {
          void navigate({
            to: "/inbox/$conversationId",
            params: { conversationId: evt.conversationId },
          });
        },
      });
    });
    return unsub;
  }, [location.pathname, navigate]);

  return null;
}
