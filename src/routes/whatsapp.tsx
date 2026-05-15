import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  whatsapp_jid?: string | null;
  push_name?: string | null;
};

// ===== Identidade do contato =====
const JID_RE = /@(lid|s\.whatsapp\.net|g\.us|broadcast)$/i;

function isJid(v: unknown): v is string {
  return typeof v === "string" && JID_RE.test(v);
}

// Extrai telefone real (apenas dígitos, 8-15) de um valor que pode ser
// telefone, JID @s.whatsapp.net, ou nada.
function extractPhone(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const trimmed = v.trim();
  if (JID_RE.test(trimmed)) {
    const [local, domain] = trimmed.split("@");
    if (domain?.toLowerCase() === "s.whatsapp.net" && /^\d+$/.test(local ?? "")) {
      return local.length >= 8 && local.length <= 15 ? local : "";
    }
    return ""; // @lid, @g.us, @broadcast não têm telefone real
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

// Formata telefone como +55 (DD) NNNNN-NNNN quando possível.
function formatPhone(digits: string): string {
  if (!digits) return "";
  // BR: 55 + DDD(2) + 8 ou 9 dígitos
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  // Fallback genérico
  return `+${digits}`;
}

function displayName(phone: string, pushName?: string | null): string {
  if (pushName && pushName.trim()) return pushName.trim();
  if (phone) return formatPhone(phone);
  return "Contato WhatsApp";
}

function avatarInitials(phone: string, pushName?: string | null): string {
  if (pushName && pushName.trim()) {
    const parts = pushName.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  }
  if (phone) return phone.slice(-2);
  return "WA";
}

function normalizeContactName(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function formatTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
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

type Conversation = {
  key: string;
  phoneReal: string; // só dígitos, "" se não houver
  jid: string; // identificador técnico, "" se não houver
  pushName: string | null;
  last: WaMessage | undefined;
  messages: WaMessage[];
  isGroup: boolean;
};

function WhatsAppInbox() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [contactRows, setContactRows] = useState<WaMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contactsLoadedRef = useRef(false);

  // Carga inicial + polling 3s + realtime
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      const pageSize = 1000;
      const all: WaMessage[] = [];
      let errorMsg = "";

      for (let from = 0; from < 10000; from += pageSize) {
        const { data, error } = await supabase
          .from("whatsapp_messages")
          .select("*")
          .order("created_at", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          errorMsg = error.message;
          break;
        }

        all.push(...((data ?? []) as WaMessage[]));
        if (!data || data.length < pageSize) break;
      }

      if (cancelled) return;
      if (errorMsg) {
        console.error("WHATSAPP_LOAD_ERROR", errorMsg);
        toast.error(`Erro ao carregar contatos: ${errorMsg}`);
      } else {
        setMessages(all);
      }

      if (!contactsLoadedRef.current) {
        contactsLoadedRef.current = true;
        const { data: contactsData, error: contactsError } = await supabase.functions.invoke(
          "send-whatsapp-message",
          { body: { action: "contacts" } },
        );
        if (contactsError) {
          console.warn("WHATSAPP_CONTACTS_LOAD_ERROR", contactsError.message);
        } else if (contactsData?.ok && Array.isArray(contactsData.contacts)) {
          const rows = contactsData.contacts.map((contact: Record<string, unknown>, idx: number) => {
            const numero = typeof contact.numero === "string" ? contact.numero : "";
            const jid = typeof contact.whatsapp_jid === "string" ? contact.whatsapp_jid : "";
            const pushName = typeof contact.push_name === "string" ? contact.push_name : "";
            return {
              id: `contact:${jid || numero || idx}`,
              company_id: companyId,
              numero: numero || jid,
              mensagem: "",
              direction: "in" as const,
              created_at: "1970-01-01T00:00:00.000Z",
              whatsapp_jid: jid || null,
              push_name: pushName || null,
            };
          }).filter((row: WaMessage) => row.numero || row.whatsapp_jid || row.push_name);
          setContactRows(rows);
        } else if (contactsData?.error) {
          console.warn("WHATSAPP_CONTACTS_LOAD_ERROR", contactsData.error);
        }
      }
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 3000);

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

  // Agrupar conversas — chave preferencial = telefone real; fallback = jid; último = numero cru.
  // Mescla automaticamente conversas que têm o mesmo telefone (ainda que apareçam por jid em outras msgs).
  const conversations = useMemo<Conversation[]>(() => {
    const allMessages = [...contactRows, ...messages];
    // 1) primeiro passo: descobrir telefone real por jid e por nome exato.
    const jidToPhone = new Map<string, string>();
    const nameToPhone = new Map<string, string>();
    for (const m of allMessages) {
      const jid = typeof m.whatsapp_jid === "string" ? m.whatsapp_jid : "";
      const phoneFromNumero = extractPhone(m.numero);
      if (jid && phoneFromNumero && !jidToPhone.has(jid)) {
        jidToPhone.set(jid, phoneFromNumero);
      }
      const nameKey = normalizeContactName(m.push_name);
      if (nameKey && phoneFromNumero && !nameToPhone.has(nameKey)) {
        nameToPhone.set(nameKey, phoneFromNumero);
      }
    }

    // 2) agrupar por chave canônica
    const groups = new Map<string, WaMessage[]>();
    for (const m of allMessages) {
      if (!m) continue;
      const phoneFromNumero = extractPhone(m.numero);
      const phoneFromJid = m.whatsapp_jid ? jidToPhone.get(m.whatsapp_jid) ?? "" : "";
      const phoneFromName = nameToPhone.get(normalizeContactName(m.push_name)) ?? "";
      const phone = phoneFromNumero || phoneFromJid || phoneFromName;
      const jid = typeof m.whatsapp_jid === "string" && m.whatsapp_jid ? m.whatsapp_jid : "";
      const numero = typeof m.numero === "string" ? m.numero : "";
      const key = phone ? `p:${phone}` : jid ? `j:${jid}` : numero ? `n:${numero}` : `id:${m.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const list: Conversation[] = [];
    for (const [key, msgs] of groups) {
      const sorted = [...msgs].sort(
        (a, b) =>
          new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime(),
      );
      const last = sorted[sorted.length - 1];
      // Telefone real: melhor candidato em qualquer mensagem do grupo
      let phoneReal = "";
      for (const m of sorted) {
        const p = extractPhone(m.numero);
        if (p) {
          phoneReal = p;
          break;
        }
      }
      // jid técnico
      const jid =
        sorted.map((m) => (typeof m.whatsapp_jid === "string" ? m.whatsapp_jid : ""))
          .find((v) => isJid(v)) ?? "";
      const pushName =
        sorted.map((m) => m?.push_name).filter((v): v is string => !!v && !!v.trim()).pop() ?? null;
      if (!phoneReal) {
        const byName = nameToPhone.get(normalizeContactName(pushName));
        if (byName) phoneReal = byName;
      }
      const isGroup = jid.endsWith("@g.us") || jid.endsWith("@broadcast");
      list.push({ key, phoneReal, jid, pushName, last, messages: sorted, isGroup });
    }

    list.sort(
      (a, b) =>
        new Date(b?.last?.created_at ?? 0).getTime() -
        new Date(a?.last?.created_at ?? 0).getTime(),
    );
    return list;
  }, [messages, contactRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    const qDigits = q.replace(/\D/g, "");
    return conversations.filter((c) => {
      const name = displayName(c.phoneReal, c.pushName).toLowerCase();
      const phoneMatch = qDigits && c.phoneReal.includes(qDigits);
      const lastMsg = (c.last?.mensagem ?? "").toLowerCase();
      return name.includes(q) || phoneMatch || lastMsg.includes(q);
    });
  }, [conversations, search]);

  const current = useMemo(
    () => conversations.find((c) => c.key === selected) ?? null,
    [conversations, selected],
  );

  // Auto-scroll quando trocar conversa ou chegar mensagem nova
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages.length, selected]);

  // Auto-selecionar primeira conversa (apenas desktop)
  useEffect(() => {
    if (!selected && conversations.length > 0 && typeof window !== "undefined" && window.innerWidth >= 768) {
      setSelected(conversations[0].key);
    }
  }, [conversations, selected]);

  async function handleSend() {
    const text = draft.trim();
    if (sending) return;
    if (!current) {
      toast.error("Nenhuma conversa selecionada.");
      return;
    }
    if (!companyId) {
      toast.error("Sessão sem empresa vinculada.");
      return;
    }
    if (!text) return;

    // Decide o destinatário: phone_real > jid (não-grupo) > erro.
    let target = "";
    if (current.phoneReal) {
      target = current.phoneReal;
    } else if (current.jid && !current.isGroup) {
      target = current.jid;
    } else {
      toast.error(
        current.isGroup
          ? "Envio para grupos não é suportado."
          : "Conversa sem telefone real ou JID válido.",
      );
      return;
    }

    console.log("SEND_SELECTED_CONTACT", {
      key: current.key,
      phoneReal: current.phoneReal,
      jid: current.jid,
      pushName: current.pushName,
    });
    console.log("SEND_TARGET_FINAL", target);

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-whatsapp-message",
        {
          body: {
            number: target,
            message: text,
            whatsapp_jid: current.jid || undefined,
            contactName: current.pushName || undefined,
          },
        },
      );
      console.log("SEND_SERVER_RESPONSE", { data, error });

      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as unknown as { context?: { response?: Response } }).context;
          if (ctx?.response) {
            const body = await ctx.response.clone().text();
            if (body) detail = body;
          }
        } catch {
          /* noop */
        }
        console.error("BAILEYS_SEND_ERROR", detail);
        toast.error(`Erro ao enviar: ${detail}`);
        return;
      }
      if (!data?.ok) {
        const detail = data?.error || "send failed";
        console.error("BAILEYS_SEND_ERROR", detail);
        toast.error(`Erro ao enviar: ${detail}`);
        return;
      }
      console.log("BAILEYS_SEND_SUCCESS", data);
      setDraft("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("BAILEYS_SEND_ERROR", msg);
      toast.error(`Erro ao enviar: ${msg}`);
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

  // Container ocupa toda a viewport disponível (descontado o topbar mobile de 3rem).
  return (
    <div className="flex w-full overflow-hidden bg-background h-[calc(100dvh-3rem)] md:h-screen">
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full md:w-80 shrink-0 border-r border-border flex-col bg-card min-h-0",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-border shrink-0">
          <h1 className="text-base font-semibold">Conversas</h1>
          <span className="text-[11px] text-muted-foreground">
            {conversations.length}
          </span>
        </div>
        <div className="p-2 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar nome ou telefone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="p-4 text-xs text-muted-foreground">Carregando…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhuma conversa encontrada.
            </div>
          )}
          {filtered.map((c) => {
            const active = c.key === selected;
            const name = displayName(c.phoneReal, c.pushName);
            const sub = c.phoneReal ? formatPhone(c.phoneReal) : c.isGroup ? "Grupo" : "Sem telefone real";
            return (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className={cn(
                  "w-full text-left px-3 py-2.5 flex gap-3 items-start border-b border-border/50 hover:bg-accent/50 transition-colors",
                  active && "bg-accent",
                )}
              >
                <div className="h-10 w-10 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
                  {avatarInitials(c.phoneReal, c.pushName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(c.last?.created_at)}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.last?.direction === "out" ? "Você: " : ""}
                    {c.last?.mensagem ?? ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat */}
      <section
        className={cn(
          "flex-1 min-w-0 min-h-0 flex-col",
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
            <header className="h-14 px-3 md:px-4 border-b border-border flex items-center gap-3 bg-card shrink-0">
              <button
                onClick={() => setSelected(null)}
                className="md:hidden p-1.5 rounded-md hover:bg-accent"
                aria-label="Voltar"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
                {avatarInitials(current.phoneReal, current.pushName)}
              </div>
              <div className="leading-tight min-w-0">
                <div className="text-sm font-semibold truncate">
                  {displayName(current.phoneReal, current.pushName)}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {current.phoneReal
                    ? formatPhone(current.phoneReal)
                    : current.isGroup
                      ? "Grupo — envio desabilitado"
                      : "Sem telefone real — envio limitado"}
                </div>
              </div>
            </header>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2 bg-background"
            >
              {current.messages.map((m, idx) => {
                const prev = current.messages[idx - 1];
                const showDay =
                  !prev || formatDay(prev.created_at) !== formatDay(m.created_at);
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
                    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[70%] rounded-2xl px-3 py-1.5 text-sm shadow-sm",
                          mine
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-card border border-border rounded-bl-sm",
                        )}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.mensagem ?? ""}
                        </div>
                        <div
                          className={cn(
                            "text-[10px] mt-0.5 text-right",
                            mine ? "text-primary-foreground/70" : "text-muted-foreground",
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

            <footer className="p-3 border-t border-border bg-card shrink-0">
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
                  placeholder={
                    current.isGroup
                      ? "Envio para grupos desabilitado"
                      : "Digite uma mensagem"
                  }
                  disabled={current.isGroup}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || sending || current.isGroup}
                >
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
