import { useState } from "react";
import type { DashboardData } from "../useDashboardData";
import { num } from "./primitives";

const STATUSES = [
  { key: "completed", label: "Concluídas pela IA", color: "#ffe15c" },
  { key: "active", label: "Em atendimento", color: "#ff9650" },
  { key: "waiting", label: "Aguardando humano", color: "#ff4f87" },
] as const;
type Status = (typeof STATUSES)[number]["key"];
const emptyCounts = () => ({ completed: 0, active: 0, waiting: 0 });

/** Snapshot, not historical throughput. Explicit states take precedence over stale handling flags. */
export function buildAiLoad(conversations: DashboardData["conversations"]) {
  const groups = ["WhatsApp", "Instagram", "Facebook", "Outros"].map((label) => ({
    label,
    counts: emptyCounts(),
    total: 0,
  }));
  const totals = emptyCounts();
  for (const c of conversations) {
    const status: Status | null =
      c.aiStatus === "aguardando_humano"
        ? "waiting"
        : c.aiStatus === "pre_atendido_ia"
          ? "completed"
          : c.aiHandling
            ? "active"
            : null;
    if (!status) continue;
    const index = ["whatsapp", "instagram", "facebook"].indexOf(c.channel);
    const group = groups[index < 0 ? 3 : index];
    group.counts[status]++;
    group.total++;
    totals[status]++;
  }
  return {
    groups: groups.filter((g, i) => i < 3 || g.total > 0),
    totals,
    total: Object.values(totals).reduce((a, b) => a + b, 0),
  };
}

export function AiLoadChart({ conversations }: { conversations: DashboardData["conversations"] }) {
  const { groups, totals, total } = buildAiLoad(conversations);
  const [selected, setSelected] = useState<string | null>(null);
  const active = groups.find((g) => g.label === selected);
  return (
    <div className="dash-ai-load">
      <div className="dash-ai-summary">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Conversas da IA
          </p>
          <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums">{num(total)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Distribuição atual por canal</p>
        </div>
        <dl className="dash-ai-legend">
          {STATUSES.map((s) => (
            <div key={s.key}>
              <dt>
                <i style={{ background: s.color }} aria-hidden />
                {s.label}
              </dt>
              <dd>{num(totals[s.key])}</dd>
            </div>
          ))}
        </dl>
      </div>
      {total === 0 ? (
        <p className="dash-ai-empty">Nenhuma conversa da IA para comparar.</p>
      ) : (
        <div>
          <div className="dash-ai-columns" role="group" aria-label="Situação da IA por canal">
            <div className="dash-ai-axis" aria-hidden>
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
            {groups.map((g) => (
              <button
                type="button"
                key={g.label}
                className="dash-ai-column"
                aria-pressed={selected === g.label}
                aria-label={`${g.label}: ${num(g.total)} conversas; ${STATUSES.map((s) => `${s.label}: ${num(g.counts[s.key])}`).join("; ")}`}
                onMouseEnter={() => setSelected(g.label)}
                onFocus={() => setSelected(g.label)}
                onClick={() => setSelected(g.label)}
              >
                <strong className="text-sm tabular-nums">{num(g.total)}</strong>
                <span className="dash-ai-stack" aria-hidden>
                  {STATUSES.map(
                    (s) =>
                      g.counts[s.key] > 0 && (
                        <span
                          key={s.key}
                          style={{
                            height: `${(g.counts[s.key] / g.total) * 100}%`,
                            background: `linear-gradient(100deg, ${s.color}, color-mix(in srgb, ${s.color} 84%, #fff))`,
                          }}
                        />
                      ),
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground">{g.label}</span>
              </button>
            ))}
          </div>
          <p className="dash-ai-readout" aria-live="polite">
            {active
              ? `${active.label} · ${num(active.counts.completed)} concluídas · ${num(active.counts.active)} em atendimento · ${num(active.counts.waiting)} aguardando humano`
              : "Selecione um canal para consultar suas quantidades."}
          </p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Cada coluna preenchida representa 100% das conversas da IA no canal. O número acima
            indica o volume; uma conversa é contada uma única vez.
          </p>
        </div>
      )}
    </div>
  );
}
