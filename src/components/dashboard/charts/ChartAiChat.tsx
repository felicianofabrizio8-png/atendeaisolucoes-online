import { useEffect, useRef, useState } from "react";
import { Copy, Square } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AiComposer } from "@/components/atendimento/AiComposer";
import { RichText } from "@/components/atendimento/RichText";
import { OrbBloop } from "@/components/ui/orb-bloop";
import { Button } from "@/components/ui/button";
import type { ChartContext } from "@/lib/dashboard-analysis";
type Turn = { role: "user" | "assistant"; text: string };

export function ChartAiChat(props: { context: ChartContext; simulated?: boolean }) {
  const { user, profile } = useAuth();
  return (
    <ChatSession
      key={`${user?.id}:${profile?.company_id}:${JSON.stringify(props.context)}`}
      {...props}
    />
  );
}
function ChatSession({ context, simulated }: { context: ChartContext; simulated?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [input, setInput] = useState(""),
    [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null),
    log = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, pending]);
  async function ask(question: string) {
    if (active.current || !question.trim()) return false;
    const controller = new AbortController();
    active.current = controller;
    setPending(question);
    setError(null);
    try {
      let answer: string;
      if (simulated) {
        answer = `Demonstração local — a IA não foi consultada.\n\n${context.title} · ${context.period}\n\n${
          context.rows.length
            ? context.rows
                .slice(0, 4)
                .map((row) => row.map((value, i) => `${context.columns[i]}: ${value}`).join(" · "))
                .join("\n")
            : "Ainda não há valores neste recorte."
        }\n\n${context.notes}\n\nNa conta conectada, a Lume usa estes dados para responder à sua pergunta e sugerir próximos passos.`;
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Entre na sua conta para analisar com a Lume.");
        const response = await fetch("/api/dashboard/analyze", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question, context, history: turns.slice(-12) }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || typeof result?.answer !== "string")
          throw new Error(result?.error || "Não foi possível analisar o gráfico.");
        answer = result.answer;
      }
      if (controller.signal.aborted || active.current !== controller) return false;
      setTurns((previous) => [
        ...previous,
        { role: "user", text: question },
        { role: "assistant", text: answer },
      ]);
      setInput("");
      return true;
    } catch (e) {
      if (!controller.signal.aborted && active.current === controller)
        setError(e instanceof Error ? e.message : "Falha ao consultar a Lume.");
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(null);
      }
    }
  }
  return (
    <section className="dash-chart-chat" aria-label="Análise com Lume">
      <div className="border-b border-border pb-4">
        <h3 className="text-sm font-semibold">Lume · seu olhar sobre os dados</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Contexto vinculado: {context.title}
        </p>
      </div>
      <div
        ref={log}
        className="dash-chat-log"
        role="log"
        aria-label="Mensagens sobre o gráfico"
        aria-live="polite"
      >
        {!turns.length && !pending && (
          <div className="dash-chat-welcome">
            <OrbBloop size={130} />
            <h4 className="text-lg font-semibold">Vamos entender este gráfico?</h4>
          </div>
        )}
        {[...turns, ...(pending ? [{ role: "user" as const, text: pending }] : [])].map(
          (turn, i) => (
            <article
              key={i}
              className={turn.role === "user" ? "dash-chat-user" : "dash-chat-answer"}
            >
              <RichText text={turn.text} />
              {turn.role === "assistant" && (
                <button
                  className="mt-2 flex items-center gap-1 rounded-full p-1 text-[10px] text-muted-foreground"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(turn.text);
                      setCopied(i);
                    } catch {
                      setError("Não foi possível copiar.");
                    }
                  }}
                >
                  <Copy size={12} />
                  {copied === i ? "Copiado" : "Copiar"}
                </button>
              )}
            </article>
          ),
        )}
        {pending && (
          <div
            role="status"
            className="flex items-center justify-between text-xs text-muted-foreground"
          >
            Analisando os dados…
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                active.current?.abort();
                active.current = null;
                setPending(null);
              }}
            >
              <Square />
              Parar
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-3 pt-3">
        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}
        <AiComposer
          value={input}
          onChange={setInput}
          onSubmit={ask}
          disabled={pending !== null}
          allowAttachments={false}
          label="Pergunte à Lume sobre este gráfico"
          placeholder="O que estes números mostram?"
        />
        <div className="flex flex-wrap gap-1.5">
          {[
            ["Resumo", "Resuma os números deste gráfico."],
            [
              "Pontos de atenção",
              "Quais pontos merecem atenção neste gráfico? Diferencie fatos de hipóteses.",
            ],
            ["Próximos passos", "Quais ações posso priorizar com base nestes dados?"],
          ].map(([label, prompt]) => (
            <Button
              key={label}
              size="sm"
              disabled={pending !== null}
              onClick={() => void ask(prompt)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {simulated
            ? "Prévia demonstrativa · respostas locais"
            : "A Lume analisa este recorte e não altera seus dados."}
        </p>
      </div>
    </section>
  );
}
