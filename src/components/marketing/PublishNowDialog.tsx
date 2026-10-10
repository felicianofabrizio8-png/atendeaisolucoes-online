// "Publicar agora": escolha do destino (Instagram, Facebook ou os dois).
// Cada canal vira um agendamento próprio, então o envio, o erro e a situação
// de um canal não dependem do outro.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiListPublishSchedule, apiScheduleContent } from "@/data/marketingRepo";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";

export type PublishChannel = "instagram" | "facebook";
export const PUBLISH_CHANNELS: PublishChannel[] = ["instagram", "facebook"];
const CHANNEL_LABEL: Record<PublishChannel, string> = { instagram: "Instagram", facebook: "Facebook" };
const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  planned: "agendado",
  queued: "na fila de publicação",
  published: "publicado",
  failed: "falhou",
  cancelled: "cancelado",
};

export type ChannelResult = { state: "sending" } | { state: "queued" } | { state: "error"; message: string };

export interface PublishNowDeps {
  schedule: (input: { content_id: string; channel: PublishChannel; scheduled_at: string }) => Promise<unknown>;
  listSchedule: () => Promise<MarketingScheduleRow[]>;
}
const defaultDeps: PublishNowDeps = { schedule: apiScheduleContent, listSchedule: apiListPublishSchedule };

/** Último agendamento de cada canal para este conteúdo. */
export function latestByChannel(schedule: MarketingScheduleRow[], contentId: string): Partial<Record<PublishChannel, MarketingScheduleRow>> {
  const out: Partial<Record<PublishChannel, MarketingScheduleRow>> = {};
  for (const row of schedule) {
    if (row.content_id !== contentId || (row.channel !== "instagram" && row.channel !== "facebook")) continue;
    const cur = out[row.channel];
    if (!cur || new Date(row.scheduled_at).getTime() > new Date(cur.scheduled_at).getTime()) out[row.channel] = row;
  }
  return out;
}

/**
 * Enfileira a publicação em cada canal escolhido, um de cada vez. A falha de
 * um canal não impede nem desfaz o outro.
 */
export async function publishToChannels(
  contentId: string,
  channels: PublishChannel[],
  schedule: PublishNowDeps["schedule"],
  onUpdate?: (channel: PublishChannel, result: ChannelResult) => void,
): Promise<Partial<Record<PublishChannel, ChannelResult>>> {
  const results: Partial<Record<PublishChannel, ChannelResult>> = {};
  for (const channel of channels) {
    onUpdate?.(channel, { state: "sending" });
    let result: ChannelResult;
    try {
      await schedule({ content_id: contentId, channel, scheduled_at: new Date(Date.now() + 1000).toISOString() });
      result = { state: "queued" };
    } catch (e) {
      result = { state: "error", message: e instanceof Error && e.message ? e.message : "Falha ao enfileirar a publicação." };
    }
    results[channel] = result;
    onUpdate?.(channel, result);
  }
  return results;
}

export function PublishNowDialog({
  row,
  facebookBlockedReason,
  onClose,
  onDone,
  deps = defaultDeps,
}: {
  row: MarketingContentRow;
  /** Preenchido quando a Página do Facebook não pode publicar (ex.: permissão ausente). */
  facebookBlockedReason?: string | null;
  onClose: () => void;
  /** Chamado quando ao menos um canal foi enfileirado. */
  onDone?: () => void;
  deps?: PublishNowDeps;
}) {
  const [selected, setSelected] = useState<Record<PublishChannel, boolean>>({
    instagram: row.channel !== "facebook",
    facebook: row.channel === "facebook" && !facebookBlockedReason,
  });
  const [results, setResults] = useState<Partial<Record<PublishChannel, ChannelResult>>>({});
  const [history, setHistory] = useState<Partial<Record<PublishChannel, MarketingScheduleRow>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    deps
      .listSchedule()
      .then((list) => alive && setHistory(latestByChannel(list, row.id)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [deps, row.id]);

  const chosen = PUBLISH_CHANNELS.filter((c) => selected[c] && results[c]?.state !== "queued");

  async function confirm() {
    if (chosen.length === 0) return;
    setBusy(true);
    const out = await publishToChannels(row.id, chosen, deps.schedule, (channel, result) => setResults((cur) => ({ ...cur, [channel]: result })));
    setBusy(false);
    const queued = Object.values(out).some((r) => r?.state === "queued");
    if (queued) onDone?.();
    if (Object.values(out).every((r) => r?.state === "queued")) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Publicar agora">
      <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4">
        <div className="font-semibold">Publicar agora</div>
        <p className="text-xs text-muted-foreground">Escolha onde publicar. Cada canal é enviado e acompanhado separadamente.</p>
        <div className="space-y-2">
          {PUBLISH_CHANNELS.map((channel) => {
            const blocked = channel === "facebook" ? (facebookBlockedReason ?? null) : null;
            const result = results[channel];
            const last = history[channel];
            return (
              <div key={channel} className="rounded-md border p-2 text-sm" data-testid={`publish-channel-${channel}`}>
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={selected[channel]}
                    disabled={busy || !!blocked || result?.state === "queued"}
                    onChange={(e) => setSelected((cur) => ({ ...cur, [channel]: e.target.checked }))}
                  />
                  {CHANNEL_LABEL[channel]}
                </label>
                {blocked && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{blocked}</p>}
                {!result && last && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Último envio: {SCHEDULE_STATUS_LABEL[last.status] ?? last.status} ({new Date(last.scheduled_at).toLocaleString("pt-BR")})
                  </p>
                )}
                {result?.state === "sending" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Enviando para a fila…
                  </p>
                )}
                {result?.state === "queued" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Na fila de publicação. Aguardando confirmação do canal.
                  </p>
                )}
                {result?.state === "error" && (
                  <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {result.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Fechar
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || chosen.length === 0}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {chosen.length > 1 ? "Publicar nos dois" : "Publicar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
