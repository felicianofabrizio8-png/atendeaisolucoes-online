import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChartContext } from "@/lib/dashboard-analysis";
import { ChartAiChat } from "./ChartAiChat";

export const DashboardAnalysisContext = createContext<{
  charts: Record<string, ChartContext>;
  simulated?: boolean;
}>({ charts: {} });

export function ChartExplorer({
  title,
  subtitle,
  children,
  chartClass = "",
  context,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  chartClass?: string;
  context?: ChartContext;
}) {
  const environment = useContext(DashboardAnalysisContext);
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
  const [chatVisited, setChatVisited] = useState(false);
  const chatRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (chat && window.matchMedia("(max-width: 950px)").matches) {
      chatRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }, [chat]);
  const facts = context ??
    environment.charts[title] ?? {
      title,
      period: subtitle ?? "",
      notes: "Nenhum valor disponível para análise.",
      columns: ["Indicador", "Valor"],
      rows: [],
    };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setChat(false);
          setChatVisited(false);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="dash-eye"
          aria-label={`Expandir ${title}`}
          title="Expandir e analisar"
        >
          <Eye size={17} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dash-explorer-overlay" />
        <Dialog.Content
          className={`lume-dashboard dash-explorer ${chat ? "dash-explorer-with-chat" : ""}`}
        >
          <header className="dash-explorer-header">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold tracking-tight">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {facts.period}
                {environment.simulated ? " · Dados fictícios de demonstração" : ""}
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setChatVisited(true);
                  setChat(!chat);
                }}
                aria-expanded={chat}
                aria-controls="chart-lume-chat"
              >
                <Sparkles />
                {chat ? "Ocultar Lume" : "Analisar com Lume"}
              </Button>
              <Dialog.Close asChild>
                <button className="dash-eye" aria-label="Fechar detalhes">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <div className="dash-explorer-body">
            <div className="dash-explorer-visual">
              <section
                aria-label={`Gráfico ampliado: ${title}`}
                className={`lume-dash-card dash-expanded-chart ${chartClass}`}
              >
                <div className="min-w-0 flex-1">{children}</div>
              </section>
              <details className="dash-details" open>
                <summary>Valores do gráfico</summary>
                <div className="overflow-x-auto">
                  <table className="dash-data-table">
                    <thead>
                      <tr>
                        {facts.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {facts.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, j) => (
                            <td key={j}>{v}</td>
                          ))}
                        </tr>
                      ))}
                      {!facts.rows.length && (
                        <tr>
                          <td colSpan={facts.columns.length}>Ainda não há dados neste recorte.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
              {facts.notes && (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{facts.notes}</p>
              )}
            </div>
            <aside
              ref={chatRef}
              id="chart-lume-chat"
              className="dash-explorer-chat"
              aria-hidden={!chat}
              inert={!chat}
            >
              {chatVisited && <ChartAiChat context={facts} simulated={environment.simulated} />}
            </aside>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
