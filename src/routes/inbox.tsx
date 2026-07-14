import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { advanceFocus, stopFocus, useFocus } from "@/lib/inbox-focus";
import { getConversationById, getLeadById } from "@/data/leadRepo";
import { Play, X, SkipForward } from "lucide-react";

export const Route = createFileRoute("/inbox")({
  component: InboxLayout,
  notFoundComponent: () => (
    <div className="flex-1 p-8">
      <p>Conversa não encontrada.</p>
      <Link to="/inbox" className="text-primary hover:underline">Voltar à caixa</Link>
    </div>
  ),
});

function InboxLayout() {
  return (
    <>
      <Outlet />
      <FocusBar />
    </>
  );
}

function FocusBar() {
  const focus = useFocus();
  const navigate = useNavigate();

  // Auto-stop se saímos completamente do inbox
  useEffect(() => {
    if (!focus) return;
    if (focus.index >= focus.queue.length) stopFocus();
  }, [focus]);

  if (!focus) return null;
  const currentId = focus.queue[focus.index];
  const remaining = focus.queue.length - focus.index - 1;
  const conv = currentId ? getConversationById(currentId) : undefined;
  const lead = conv ? getLeadById(conv.leadId) : undefined;

  const next = () => {
    const id = advanceFocus();
    if (id) navigate({ to: "/inbox/$conversationId", params: { conversationId: id } });
    else navigate({ to: "/inbox" });
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]">
      <div className="flex items-center gap-3 rounded-full border border-primary/30 bg-background/95 backdrop-blur shadow-lg px-4 py-2">
        <Play className="h-4 w-4 text-primary fill-current" />
        <div className="text-xs leading-tight">
          <div className="font-semibold">
            Modo Foco · {focus.index + 1}/{focus.queue.length}
          </div>
          {lead && <div className="text-muted-foreground truncate max-w-[240px]">{lead.name}</div>}
        </div>
        <button
          type="button"
          onClick={next}
          className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-primary/90"
        >
          <SkipForward className="h-3.5 w-3.5" />
          {remaining > 0 ? "Próximo" : "Finalizar"}
        </button>
        <button
          type="button"
          onClick={() => stopFocus()}
          className="h-8 w-8 rounded-full inline-flex items-center justify-center hover:bg-accent"
          aria-label="Sair do Modo Foco"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
