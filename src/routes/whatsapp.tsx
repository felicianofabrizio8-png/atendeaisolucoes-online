import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Search, MessageSquare, ArrowLeft, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { whatsappProvider, type WhatsAppQr, type WhatsAppStatus } from "@/services/whatsappProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Normaliza telefone para envio via Evolution (BR-friendly).
function normalizeWaPhone(input: string): string {
  const d = (input ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

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

function jidLocalNumber(jid: string): string {
  if (!jid) return "";
  const [local, domain] = jid.split("@");
  return domain?.toLowerCase() === "lid" && /^\d{8,20}$/.test(local ?? "") ? local : "";
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
  const [serverContactRows, setServerContactRows] = useState<WaMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contactsLoadedRef = useRef(false);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [metaCloud, setMetaCloud] = useState<{ connected: boolean; displayName?: string } | null>(
    null,
  );
  const [qr, setQr] = useState<WhatsAppQr | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Modal: editar telefone do contato atual
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Modal: adicionar contato manual
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addNote, setAddNote] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

  // Polling de status Evolution a cada 10s
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const s = await whatsappProvider.getStatus();
      if (!cancelled) setStatus(s);
      if (s.connected && showQr) setShowQr(false);
    }
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showQr]);

  // Detecta integração WhatsApp Cloud API (Meta) — considera conectada quando
  // existe uma integração ativa com access_token gravado para o canal whatsapp.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              eq: (
                c: string,
                v: boolean,
              ) => {
                limit: (
                  n: number,
                ) => Promise<{
                  data: Array<{
                    display_name: string;
                    has_access_token: boolean;
                    last_error: string | null;
                  }> | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        };
      })
        .from("integrations_safe")
        .select("display_name, has_access_token, last_error")
        .eq("channel", "whatsapp")
        .eq("active", true)
        .limit(5);
      if (cancelled) return;
      if (error || !data) {
        setMetaCloud({ connected: false });
        return;
      }
      const row = data.find((r) => r.has_access_token);
      setMetaCloud(
        row
          ? { connected: true, displayName: row.display_name }
          : { connected: false },
      );
    }
    check();
    const id = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);


  // Carrega QR sob demanda quando o usuário pedir
  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    async function load() {
      const q = await whatsappProvider.getQrCode();
      if (!cancelled) setQr(q);
    }
    load();
    const id = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showQr]);

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

      const { data: leads, error: leadsError } = await supabase
        .from("leads")
        .select("id, name, phone, external_id, created_at")
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (leadsError) {
        console.warn("WHATSAPP_LEADS_LOAD_ERROR", leadsError.message);
      } else {
        const leadRows = (leads ?? [])
          .map((lead) => {
            const phone = typeof lead.phone === "string" ? lead.phone : "";
            const externalId = typeof lead.external_id === "string" ? lead.external_id : "";
            const numero = phone || externalId;
            return {
              id: `lead:${lead.id}`,
              company_id: companyId,
              numero,
              mensagem: "",
              direction: "in" as const,
              created_at: "1970-01-01T00:00:00.000Z",
              whatsapp_jid: isJid(externalId) ? externalId : null,
              push_name: typeof lead.name === "string" ? lead.name : null,
            };
          })
          .filter((row) => row.numero || row.push_name);
        setContactRows(leadRows as WaMessage[]);
      }

      if (!contactsLoadedRef.current) {
        contactsLoadedRef.current = true;
        const { data: contactsData, error: contactsError } = await supabase.functions.invoke(
          "whatsapp-status",
          { body: { action: "contacts" } },
        );
        if (contactsError) {
          console.warn("WHATSAPP_CONTACTS_LOAD_ERROR", contactsError.message);
        } else if (contactsData?.ok && Array.isArray(contactsData.contacts)) {
          const rows = contactsData.contacts
            .map((contact: Record<string, unknown>, idx: number) => {
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
            })
            .filter((row: WaMessage) => row.numero || row.whatsapp_jid || row.push_name);
          setServerContactRows(rows);
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
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
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
    const allMessages = [...contactRows, ...serverContactRows, ...messages];
    // 1) descobrir telefone real APENAS por jid (não por nome — nomes duplicados
    //    mesclavam contatos diferentes na mesma conversa).
    const jidToPhone = new Map<string, string>();
    for (const m of allMessages) {
      const jid = typeof m.whatsapp_jid === "string" ? m.whatsapp_jid : "";
      const phoneFromNumero = extractPhone(m.numero);
      if (jid && phoneFromNumero && !jidToPhone.has(jid)) {
        jidToPhone.set(jid, phoneFromNumero);
      }
    }

    // 2) agrupar por chave canônica (telefone real > jid > numero cru)
    const groups = new Map<string, WaMessage[]>();
    for (const m of allMessages) {
      if (!m) continue;
      const phoneFromNumero = extractPhone(m.numero);
      const phoneFromJid = m.whatsapp_jid ? (jidToPhone.get(m.whatsapp_jid) ?? "") : "";
      const phone = phoneFromNumero || phoneFromJid;
      const jid = typeof m.whatsapp_jid === "string" && m.whatsapp_jid ? m.whatsapp_jid : "";
      const numero = typeof m.numero === "string" ? m.numero : "";
      const key = phone ? `p:${phone}` : jid ? `j:${jid}` : numero ? `n:${numero}` : `id:${m.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const list: Conversation[] = [];
    for (const [key, msgs] of groups) {
      const sorted = [...msgs].sort(
        (a, b) => new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime(),
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
        sorted
          .map((m) => (typeof m.whatsapp_jid === "string" ? m.whatsapp_jid : ""))
          .find((v) => isJid(v)) ?? "";
      const pushName =
        sorted
          .map((m) => m?.push_name)
          .filter((v): v is string => !!v && !!v.trim())
          .pop() ?? null;
      if (!phoneReal) {
        // sem fallback por nome — evita merge entre contatos homônimos
      }
      const isGroup = jid.endsWith("@g.us") || jid.endsWith("@broadcast");
      list.push({ key, phoneReal, jid, pushName, last, messages: sorted, isGroup });
    }

    list.sort(
      (a, b) =>
        new Date(b?.last?.created_at ?? 0).getTime() - new Date(a?.last?.created_at ?? 0).getTime(),
    );
    return list;
  }, [messages, contactRows, serverContactRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    const qDigits = q.replace(/\D/g, "");
    return conversations.filter((c) => {
      const name = displayName(c.phoneReal, c.pushName).toLowerCase();
      const lidNumber = jidLocalNumber(c.jid);
      const phoneMatch = qDigits && (c.phoneReal.includes(qDigits) || lidNumber.includes(qDigits));
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

  // Limpa rascunho ao trocar de conversa — evita reusar texto/contexto antigo
  useEffect(() => {
    setDraft("");
  }, [selected]);

  // Auto-selecionar primeira conversa (apenas desktop)
  useEffect(() => {
    if (
      !selected &&
      conversations.length > 0 &&
      typeof window !== "undefined" &&
      window.innerWidth >= 768
    ) {
      setSelected(conversations[0].key);
    }
  }, [conversations, selected]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    const isMetaCloud = !!metaCloud?.connected;
    console.log("SYNC_CONTACTS_START", { provider: isMetaCloud ? "meta_cloud_api" : "evolution" });
    try {
      if (isMetaCloud) {
        // Meta Cloud API não tem sincronização de agenda — apenas recarrega o banco.
        const [{ data: leads }, { data: msgs }] = await Promise.all([
          supabase
            .from("leads")
            .select("id, name, phone, external_id, created_at")
            .eq("channel", "whatsapp")
            .order("created_at", { ascending: false })
            .limit(1000),
          supabase
            .from("whatsapp_messages")
            .select("*")
            .order("created_at", { ascending: true })
            .limit(1000),
        ]);
        const leadRows = (leads ?? [])
          .map((lead) => {
            const phone = typeof lead.phone === "string" ? lead.phone : "";
            const externalId = typeof lead.external_id === "string" ? lead.external_id : "";
            const numero = phone || externalId;
            return {
              id: `lead:${lead.id}`,
              company_id: companyId!,
              numero,
              mensagem: "",
              direction: "in" as const,
              created_at: "1970-01-01T00:00:00.000Z",
              whatsapp_jid: isJid(externalId) ? externalId : null,
              push_name: typeof lead.name === "string" ? lead.name : null,
            };
          })
          .filter((r) => r.numero || r.push_name);
        setContactRows(leadRows as WaMessage[]);
        if (msgs) setMessages(msgs as WaMessage[]);
        console.log("CONTACT_LIST_LOADED", { count: leadRows.length, mode: "meta_cloud_api" });
        toast.success(`Contatos recarregados (${leadRows.length})`);
        return;
      }
      const res = await whatsappProvider.syncContacts();
      console.log("SYNC_CONTACTS_RESULT", res);
      if (!res.ok) {
        toast.error(`Falha ao sincronizar: ${res.error ?? "erro"}`);
        return;
      }
      const rows = (res.contacts as Array<Record<string, unknown>>)
        .map((contact, idx) => {
          const numero = typeof contact.numero === "string" ? contact.numero : "";
          const jid = typeof contact.whatsapp_jid === "string" ? contact.whatsapp_jid : "";
          const pushName = typeof contact.push_name === "string" ? contact.push_name : "";
          return {
            id: `contact:${jid || numero || idx}`,
            company_id: companyId!,
            numero: numero || jid,
            mensagem: "",
            direction: "in" as const,
            created_at: "1970-01-01T00:00:00.000Z",
            whatsapp_jid: jid || null,
            push_name: pushName || null,
          };
        })
        .filter((row) => row.numero || row.whatsapp_jid || row.push_name);
      setServerContactRows(rows as WaMessage[]);
      toast.success(
        `Contatos sincronizados (${rows.length})${res.updated ? ` — ${res.updated} atualizados` : ""}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao sincronizar: ${msg}`);
    } finally {
      setSyncing(false);
    }
  }


  function openEditPhone() {
    if (!current) return;
    setEditName(current.pushName ?? "");
    setEditPhone(current.phoneReal ? formatPhone(current.phoneReal) : "");
    setEditOpen(true);
  }

  async function saveEditPhone() {
    if (!current || !companyId) return;
    const phone = normalizeWaPhone(editPhone);
    if (!phone || phone.length < 8 || phone.length > 15) {
      toast.error("Telefone inválido.");
      return;
    }
    const name = editName.trim() || current.pushName || displayName(phone, null);
    setSavingEdit(true);
    try {
      const externalId = current.jid || `phone:${phone}`;
      // upsert manual: tenta achar lead com mesmo external_id, senão insere
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("company_id", companyId)
        .eq("channel", "whatsapp")
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("leads").update({ phone, name }).eq("id", existing.id);
      } else {
        await supabase.from("leads").insert({
          company_id: companyId,
          channel: "whatsapp",
          name,
          phone,
          external_id: externalId,
        });
      }
      // Injeta localmente para mesclar imediatamente na conversa atual
      const synthetic: WaMessage = {
        id: `manual:${externalId}`,
        company_id: companyId,
        numero: phone,
        mensagem: "",
        direction: "in",
        created_at: "1970-01-01T00:00:00.000Z",
        whatsapp_jid: current.jid || null,
        push_name: name,
      };
      setContactRows((prev) => {
        const filtered = prev.filter((r) => r.id !== synthetic.id);
        return [...filtered, synthetic];
      });
      // Reseleciona pela nova chave canônica (telefone real)
      setSelected(`p:${phone}`);
      toast.success("Telefone salvo.");
      setEditOpen(false);
    } catch (e) {
      toast.error(`Falha ao salvar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveAddContact() {
    if (!companyId) return;
    const phone = normalizeWaPhone(addPhone);
    if (!phone || phone.length < 8 || phone.length > 15) {
      toast.error("Telefone inválido.");
      return;
    }
    const name = addName.trim() || displayName(phone, null);
    setSavingAdd(true);
    try {
      const externalId = `phone:${phone}`;
      const { data: existing, error: selErr } = await supabase
        .from("leads")
        .select("id")
        .eq("company_id", companyId)
        .eq("channel", "whatsapp")
        .eq("external_id", externalId)
        .maybeSingle();
      if (selErr) {
        console.error("CONTACT_CREATE_ERROR_SELECT", selErr);
        toast.error(`Falha ao verificar contato: ${selErr.message}`);
        return;
      }
      let leadId = existing?.id ?? null;
      if (leadId) {
        const { error: updErr } = await supabase
          .from("leads")
          .update({
            phone,
            name,
            ...(addNote.trim() ? { next_action_label: addNote.trim() } : {}),
          })
          .eq("id", leadId);
        if (updErr) {
          console.error("CONTACT_CREATE_ERROR_UPDATE", updErr);
          toast.error(`Falha ao salvar: ${updErr.message}`);
          return;
        }
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("leads")
          .insert({
            company_id: companyId,
            channel: "whatsapp",
            name,
            phone,
            external_id: externalId,
            ...(addNote.trim() ? { next_action_label: addNote.trim() } : {}),
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          console.error("CONTACT_CREATE_ERROR_INSERT", insErr);
          toast.error(`Falha ao adicionar: ${insErr?.message ?? "erro desconhecido"}`);
          return;
        }
        leadId = inserted.id;
      }
      console.log("CONTACT_CREATE_SUCCESS", { leadId, phone, name, provider_type: "meta_cloud_api" });

      // Injeta localmente para aparecer já na lista, sem esperar polling
      const synthetic: WaMessage = {
        id: `manual:${externalId}`,
        company_id: companyId,
        numero: phone,
        mensagem: "",
        direction: "in",
        created_at: "1970-01-01T00:00:00.000Z",
        whatsapp_jid: null,
        push_name: name,
      };
      setContactRows((prev) => {
        const filtered = prev.filter((r) => r.id !== synthetic.id && r.id !== `lead:${leadId}`);
        return [
          ...filtered,
          synthetic,
          {
            ...synthetic,
            id: `lead:${leadId}`,
          },
        ];
      });
      console.log("CONTACT_LIST_LOADED", { added: 1, phone });
      setSelected(`p:${phone}`);
      toast.success("Contato adicionado.");
      setAddOpen(false);
      setAddName("");
      setAddPhone("");
      setAddNote("");
    } catch (e) {
      console.error("CONTACT_CREATE_ERROR", e);
      toast.error(`Falha ao adicionar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingAdd(false);
    }
  }


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

    // Prioridade: telefone real > jid @s.whatsapp.net > jid @lid (tenta mesmo assim).
    let target = "";
    if (current.phoneReal) {
      target = current.phoneReal;
    } else if (current.jid && current.jid.endsWith("@s.whatsapp.net")) {
      target = current.jid;
    } else if (current.jid && !current.isGroup) {
      // Inclui @lid — não bloqueia antes de tentar
      target = current.jid;
    } else {
      toast.error(
        current.isGroup ? "Envio para grupos não é suportado." : "Conversa sem destino válido.",
      );
      return;
    }

    console.log("CHAT_ATUAL", {
      key: current.key,
      phoneReal: current.phoneReal,
      jid: current.jid,
      pushName: current.pushName,
      selectedKey: selected,
    });
    console.log("NUMERO_ENVIO", target);
    console.log("REMOTE_JID", current.jid);
    console.log("FRONT_SEND_TARGET", { target, jid: current.jid, name: current.pushName });

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          number: target,
          message: text,
          whatsapp_jid: current.jid || undefined,
          contactName: current.pushName || undefined,
        },
      });
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
          <div className="flex items-center gap-2">
            {(() => {
              const evolutionOn = !!status?.connected;
              const metaOn = !!metaCloud?.connected;
              const isConnected = evolutionOn || metaOn;
              const label = evolutionOn
                ? "Conectado"
                : metaOn
                  ? "Conectado via Meta Cloud API"
                  : "Desconectado";
              const tip = evolutionOn
                ? (status?.state ?? "")
                : metaOn
                  ? `Meta Cloud API${metaCloud?.displayName ? ` — ${metaCloud.displayName}` : ""}`
                  : "";
              return (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
                    isConnected
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                      : "bg-amber-500/10 text-amber-600 border-amber-500/30",
                  )}
                  title={tip}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isConnected ? "bg-emerald-500" : "bg-amber-500",
                    )}
                  />
                  {label}
                </span>
              );
            })()}
            <span className="text-[11px] text-muted-foreground">{conversations.length}</span>
          </div>
        </div>
        <div className="p-2 border-b border-border shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "Sincronizando…" : "Sincronizar contatos"}
          </Button>
          <Button
            size="sm"
            variant="default"
            className="w-full mt-2"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> Adicionar contato manual
          </Button>
        </div>
        {!status?.connected && !metaCloud?.connected && (
          <div className="p-3 border-b border-border bg-amber-500/5 shrink-0">
            {!showQr ? (
              <Button size="sm" variant="outline" className="w-full" onClick={() => setShowQr(true)}>
                Conectar WhatsApp (Evolution)
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground text-center">
                  Escaneie o QR no seu WhatsApp
                </p>
                {qr?.qrcode ? (
                  <img
                    src={
                      qr.qrcode.startsWith("data:")
                        ? qr.qrcode
                        : `data:image/png;base64,${qr.qrcode}`
                    }
                    alt="QR Code"
                    className="mx-auto h-40 w-40 rounded bg-white p-1"
                  />
                ) : (
                  <div className="text-center text-[11px] text-muted-foreground">
                    {qr?.error ?? "Gerando QR…"}
                  </div>
                )}
                {qr?.pairingCode && (
                  <div className="text-center text-xs font-mono">{qr.pairingCode}</div>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowQr(false)}
                >
                  Fechar
                </Button>
              </div>
            )}
          </div>
        )}
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
          {loading && <div className="p-4 text-xs text-muted-foreground">Carregando…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhuma conversa encontrada.
            </div>
          )}
          {filtered.map((c) => {
            const active = c.key === selected;
            const name = displayName(c.phoneReal, c.pushName);
            const sub = c.phoneReal
              ? formatPhone(c.phoneReal)
              : c.isGroup
                ? "Grupo"
                : "Sem telefone real";
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
        className={cn("flex-1 min-w-0 min-h-0 flex-col", selected ? "flex" : "hidden md:flex")}
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
              <div className="leading-tight min-w-0 flex-1">
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
              {!current.isGroup && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openEditPhone}
                  className="shrink-0"
                  title="Editar telefone"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar telefone
                </Button>
              )}
            </header>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2 bg-background"
            >
              {current.messages.map((m, idx) => {
                const prev = current.messages[idx - 1];
                const showDay = !prev || formatDay(prev.created_at) !== formatDay(m.created_at);
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
                        <div className="whitespace-pre-wrap break-words">{m.mensagem ?? ""}</div>
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
                    current.isGroup ? "Envio para grupos desabilitado" : "Digite uma mensagem"
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

      {/* Modal: Editar telefone */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar telefone</DialogTitle>
            <DialogDescription>
              Defina o telefone WhatsApp real deste contato.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Nome do contato</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nome"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">Telefone WhatsApp real</Label>
              <Input
                id="edit-phone"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="(11) 91234-5678"
                inputMode="tel"
              />
              <p className="text-[11px] text-muted-foreground">
                {editPhone
                  ? `Será enviado como: ${normalizeWaPhone(editPhone) || "inválido"}`
                  : "Será adicionado +55 automaticamente se necessário."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button onClick={saveEditPhone} disabled={savingEdit}>
              {savingEdit ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Adicionar contato manual */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar contato manual</DialogTitle>
            <DialogDescription>
              Crie uma conversa nova para enviar pelo WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Nome</Label>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Nome do contato"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone">Telefone WhatsApp</Label>
              <Input
                id="add-phone"
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                placeholder="(11) 91234-5678"
                inputMode="tel"
              />
              <p className="text-[11px] text-muted-foreground">
                {addPhone
                  ? `Será enviado como: ${normalizeWaPhone(addPhone) || "inválido"}`
                  : "Será adicionado +55 automaticamente se necessário."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-note">Observação (opcional)</Label>
              <Textarea
                id="add-note"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="Anotação interna"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={savingAdd}>
              Cancelar
            </Button>
            <Button onClick={saveAddContact} disabled={savingAdd}>
              {savingAdd ? "Salvando…" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
