import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAtendimentoData } from "@/hooks/useAtendimentoData";
import { computeStats } from "@/lib/atendimento/stats";
import { ConversationRail } from "@/components/atendimento/ConversationRail";
import { ChatThread } from "@/components/atendimento/ChatThread";
import { InsightPanel } from "@/components/atendimento/InsightPanel";
import { StatCarousel } from "@/components/atendimento/StatCarousel";

export const Route = createFileRoute("/atendimento")({ component: AtendimentoPage });

function AtendimentoPage() {
  const { contacts, status, error, remote } = useAtendimentoData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compact, setCompact] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [statKey, setStatKey] = useState<string | null>(null);
  const stats = useMemo(() => computeStats(contacts), [contacts]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const selected = contacts.find((contact) => contact.conversation.id === selectedId) ?? (compact === false ? contacts[0] : undefined);
  const visible = contacts.filter((contact) => {
    const stat = stats.find((item) => item.key === statKey);
    const searchable = [contact.lead.name, contact.lead.phone, contact.lead.product, contact.conversation.detectedCity, contact.conversation.detectedState].filter(Boolean).join(" ").toLowerCase();
    return (!stat || stat.match(contact, Date.now())) && (!query.trim() || searchable.includes(query.trim().toLowerCase()));
  });
  const content = status === "loading"
    ? <div className="p-6 text-sm text-muted-foreground">Carregando conversas...</div>
    : status === "error"
      ? <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" role="alert"><p className="text-sm font-medium">Não foi possível carregar as conversas.</p><p className="text-xs text-muted-foreground">{error ?? "Tente novamente mais tarde."}</p></div>
      : status === "empty"
        ? <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Nenhuma conversa disponível.</div>
        : selected
          ? <ChatThread contact={selected} />
          : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Selecione uma conversa.</div>;
  return <main className="flex h-full min-h-0 flex-1 flex-col bg-background"><header className="border-b border-border px-5 py-4"><h1 className="text-lg font-bold">Atendimento 2.0</h1><p className="text-xs text-muted-foreground">{remote ? "Conversas reais da empresa" : "Nenhuma fonte remota ativa"}</p></header><div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[clamp(260px,24vw,340px)_minmax(0,1fr)_clamp(280px,25vw,360px)]"><aside className={selected ? "hidden min-h-0 flex-col gap-4 border-r border-border p-4 lg:flex" : "flex min-h-0 flex-col gap-4 border-r border-border p-4"}><StatCarousel stats={stats} activeKey={statKey} onSelect={setStatKey} /><ConversationRail contacts={visible} selectedId={selected?.conversation.id ?? null} onSelect={setSelectedId} query={query} onQueryChange={setQuery} /></aside><section className={selected ? "block min-h-0" : "hidden min-h-0 lg:block"}>{content}</section><aside className="hidden min-h-0 border-l border-border p-4 lg:block">{selected && <InsightPanel contact={selected} />}</aside></div></main>;
}
