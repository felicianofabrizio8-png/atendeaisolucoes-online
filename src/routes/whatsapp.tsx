import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Search, MessageSquare, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Atende Ai!" },
      { name: "description", content: "Atendimento em tempo real estilo WhatsApp Web." },
    ],
  }),
  component: WhatsAppInbox,
});

type WaMessage = {
  id: string;
  company_id: string;
  numero: string;
  mensagem: string;
  direction: "in" | "out";
  created_at: string;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return "Hoje";
  if (same(d, yest)) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

function WhatsAppInbox() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carga inicial + polling 3s (fallback caso realtime falhe)
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(2000);
      if (cancelled) return;
      if (!error && data) setMessages(data as WaMessage[]);
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 3000);

    // Realtime
    const channel = supabase
      .channel("whatsapp_messages_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const m = payload.new as WaMessage;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id) ? prev : [...prev, m],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  // Agrupar por número
  const conversations = useMemo(() => {
    const map = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (!map.has(m.numero)) map.set(m.numero, []);
      map.get(m.numero)!.push(m);
    }
    const list = Array.from(map.entries()).map(([numero, msgs]) => {
      const sorted = [...msgs].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const last = sorted[sorted.length - 1];
      return { numero, last, messages: sorted };
    });
    list.sort(
      (a, b) =>
        new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime(),
    );
    return list;
  }, [messages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.numero.toLowerCase().includes(q) ||
        c.last.mensagem.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const current = useMemo(
    () => conversations.find((c) => c.numero === selected) ?? null,
    [conversations, selected],
  );

  // Auto-scroll bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages.length, selected]);

  // Auto-selecionar primeira conversa
  useEffect(() => {
    if (!selected && conversations.length > 0) {
      setSelected(conversations[0].numero);
    }
  }, [conversations, selected]);

  const [sending, setSending] = useState(false);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !current || !companyId || sending) return;
    setSending(true);
    const numero = current.numero;
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-whatsapp-message",
        {
          body: { number: numero, message: text },
          headers: { "x-company-id": companyId },
        },
      );
      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || "send failed");
      }
      setDraft("");
      // Realtime/polling vai trazer a mensagem inserida pela edge function.
    } catch (e) {
      console.error("send failed", e);
      toast.error("Não foi possível enviar a mensagem pelo WhatsApp.");
    } finally {
      setSending(false);
    }
  }

  if (!companyId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Faça login para acessar o WhatsApp.
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-background">
      {/* Sidebar de conversas — esconde no mobile quando há conversa selecionada */}
      <aside
        className={cn(
          "w-full md:w-80 shrink-0 border-r border-border flex-col bg-card",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        <div className="h-14 px-4 flex items-center border-b border-border">
          <h1 className="text-base font-semibold">Conversas</h1>
        </div>
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar número ou mensagem"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loading && (
            <div className="p-4 text-xs text-muted-foreground">Carregando…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhuma conversa ainda.
            </div>
          )}
          {filtered.map((c) => {
            const active = c.numero === selected;
            return (
              <button
                key={c.numero}
                onClick={() => setSelected(c.numero)}
                className={cn(
                  "w-full text-left px-3 py-2.5 flex gap-3 items-start border-b border-border/50 hover:bg-accent/50 transition-colors",
                  active && "bg-accent",
                )}
              >
                <div className="h-10 w-10 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
                  {c.numero.slice(-2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{c.numero}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(c.last.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.last.direction === "out" ? "Você: " : ""}
                    {c.last.mensagem}
                  </p>
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </aside>

      {/* Chat */}
      <section
        className={cn(
          "flex-1 min-w-0 flex-col",
          selected ? "flex" : "hidden md:flex",
        )}
      >
        {!current ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="h-10 w-10 opacity-40" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          <>
            <header className="h-14 px-3 md:px-4 border-b border-border flex items-center gap-3 bg-card">
              <button
                onClick={() => setSelected(null)}
                className="md:hidden p-1.5 rounded-md hover:bg-accent"
                aria-label="Voltar"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
                {current.numero.slice(-2)}
              </div>
              <div className="leading-tight min-w-0">
                <div className="text-sm font-semibold truncate">{current.numero}</div>
                <div className="text-[11px] text-muted-foreground">WhatsApp</div>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-background"
            >
              {current.messages.map((m, idx) => {
                const prev = current.messages[idx - 1];
                const showDay =
                  !prev ||
                  formatDay(prev.created_at) !== formatDay(m.created_at);
                const mine = m.direction === "out";
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="flex justify-center my-3">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {formatDay(m.created_at)}
                        </span>
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex",
                        mine ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-3 py-1.5 text-sm shadow-sm",
                          mine
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-card border border-border rounded-bl-sm",
                        )}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.mensagem}
                        </div>
                        <div
                          className={cn(
                            "text-[10px] mt-0.5 text-right",
                            mine
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <footer className="p-3 border-t border-border bg-card">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex gap-2"
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite uma mensagem"
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={!draft.trim() || sending}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
