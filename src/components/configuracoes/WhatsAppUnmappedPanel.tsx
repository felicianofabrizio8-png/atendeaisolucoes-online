// Extraído de src/routes/configuracoes.tsx (Sprint 7 — Fase 7.1).
// Conteúdo idêntico ao original: apenas movido para reduzir o tamanho da rota.

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Painel administrativo: mensagens WhatsApp recebidas pela Meta que não
// casaram com nenhuma integração cadastrada. Surge quando o cliente envia
// para um número que existe no Business Manager mas não está conectado aqui
// (ex.: número antigo). Apenas leitura — não bloqueia o webhook.
// ---------------------------------------------------------------------------

interface UnmappedEvent {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  from_wa_id: string | null;
  contact_name: string | null;
  message_preview: string | null;
  created_at: string;
}

export function WhatsAppUnmappedPanel() {
  const [events, setEvents] = useState<UnmappedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setEvents([]);
        return;
      }
      const res = await fetch("/api/whatsapp/unmapped", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { events?: UnmappedEvent[] };
      setEvents(json.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && events.length === 0) return null;
  if (events.length === 0 && !error) return null;

  // Agrupa por phone_number_id para reduzir ruído
  const grouped = new Map<string, UnmappedEvent[]>();
  for (const ev of events) {
    const k = ev.phone_number_id;
    const arr = grouped.get(k) ?? [];
    arr.push(ev);
    grouped.set(k, arr);
  }

  return (
    <div className="mb-4 rounded-md border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/5 p-3">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-[var(--status-urgent)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            Mensagem recebida de número WhatsApp não vinculado à empresa
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Existem mensagens chegando para um número do seu Business Manager
            que ainda <strong>não está conectado</strong> ao Atende Ai. Conecte
            esse número como uma nova integração WhatsApp, ou peça para o
            cliente usar o número oficialmente divulgado.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-[11px] font-semibold rounded-md bg-secondary text-foreground px-2 py-1 hover:bg-accent"
          title="Atualizar"
        >
          Atualizar
        </button>
      </div>
      {error && (
        <div className="text-[11px] text-[var(--status-urgent)] mb-2">
          {error}
        </div>
      )}
      <ul className="space-y-2">
        {Array.from(grouped.entries()).map(([phoneId, list]) => {
          const first = list[0];
          return (
            <li
              key={phoneId}
              className="rounded-md border border-border bg-background px-3 py-2 text-[11px] space-y-0.5"
            >
              <div>
                Número:{" "}
                <span className="font-mono text-foreground">
                  {first.display_phone_number ?? "—"}
                </span>
              </div>
              <div>
                phone_number_id: <span className="font-mono">{phoneId}</span>
              </div>
              <div>
                waba_id: <span className="font-mono">{first.waba_id ?? "—"}</span>
              </div>
              <div className="text-muted-foreground">
                {list.length} mensagem{list.length > 1 ? "s" : ""} • última em{" "}
                {new Date(first.created_at).toLocaleString("pt-BR")}
              </div>
              {first.message_preview && (
                <div className="text-muted-foreground italic truncate">
                  “{first.message_preview}”
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
