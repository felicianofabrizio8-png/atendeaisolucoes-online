import { useState } from "react";
import { Check, Loader2, MessageSquareText, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SmartImage } from "@/components/SmartImage";
import {
  approveTrainingLearningCandidate,
  createTrainingLearningCandidate,
  createTrainingSession,
  getTrainingSession,
  reviewTrainingResponse,
  sendTrainingMessage,
  type TrainingMessage,
} from "@/lib/sales-training.functions";
import { getTrainingLearningDiagnostics } from "@/lib/sales-training-domain";

export function SalesTrainingChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TrainingMessage[]>([]);
  const [message, setMessage] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function startSession() {
    setBusy(true);
    try {
      const created = await createTrainingSession();
      setSessionId(created.sessionId);
      const session = await getTrainingSession({ data: { sessionId: created.sessionId } });
      setMessages(session.messages);
    } catch {
      toast.error("Não foi possível iniciar o treinamento.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!sessionId || !message.trim() || busy) return;
    const leadText = message.trim();
    setMessage("");
    setBusy(true);
    try {
      await sendTrainingMessage({ data: { sessionId, message: leadText } });
      const session = await getTrainingSession({ data: { sessionId } });
      setMessages(session.messages);
    } catch {
      setMessage(leadText);
      try {
        const session = await getTrainingSession({ data: { sessionId } });
        setMessages(session.messages);
      } catch {
        // Mantém o estado atual se a própria recarga falhar.
      }
      toast.error("Não foi possível gerar a resposta simulada.");
    } finally {
      setBusy(false);
    }
  }

  async function review(item: TrainingMessage, status: "approved" | "rejected" | "corrected") {
    setBusy(true);
    try {
      const updated = await reviewTrainingResponse({
        data: {
          messageId: item.id,
          status,
          correctionText: status === "corrected" ? corrections[item.id]?.trim() || null : null,
        },
      });
      setMessages((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      toast.error(status === "corrected" ? "Informe a resposta corrigida." : "Falha ao avaliar.");
    } finally {
      setBusy(false);
    }
  }

  async function updateLearning(item: TrainingMessage, action: "create" | "approve") {
    setBusy(true);
    try {
      const updated =
        action === "create"
          ? await createTrainingLearningCandidate({ data: { messageId: item.id } })
          : await approveTrainingLearningCandidate({ data: { messageId: item.id } });
      setMessages((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      toast.success(
        action === "create"
          ? "Candidato criado. Revise e aprove para ativar."
          : "Aprendizado aprovado e ativado.",
      );
    } catch {
      toast.error(
        action === "create" ? "Falha ao criar candidato." : "Falha ao aprovar aprendizado.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5" /> Chat de Treinamento
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Ambiente simulado. Não envia mensagens nem altera leads ou conversas reais.
          </p>
        </div>
        <Button onClick={startSession} disabled={busy} variant={sessionId ? "outline" : "default"}>
          {sessionId ? "Nova sessão" : "Iniciar sessão"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sessionId ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Inicie uma sessão para simular um cliente.
          </div>
        ) : (
          <>
            <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-lg border p-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Envie a primeira mensagem.
                </p>
              )}
              {messages.map((item) => {
                const learningDiagnostics = getTrainingLearningDiagnostics(
                  item.decision?.learning_ids_used,
                );

                return (
                  <div
                    key={item.id}
                    className={`max-w-[85%] rounded-lg p-3 text-sm ${
                      item.role === "lead"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{item.content}</p>
                    {item.role === "agent" && (
                      <div className="mt-2 rounded border border-border/60 bg-background/40 px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
                        <span>Aprendizados usados: {learningDiagnostics.count}</span>
                        <span className="ml-2 break-all font-mono">
                          learning_ids_used: [{learningDiagnostics.learningIds.join(", ")}]
                        </span>
                      </div>
                    )}
                    {item.role === "agent" &&
                      item.decision?.simulated_product_images &&
                      item.decision.simulated_product_images.length > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {item.decision.simulated_product_images.map((image) => (
                            <div key={image.product_id} className="space-y-1">
                              <SmartImage
                                src={image.image}
                                alt={image.product_name}
                                wrapperClassName="overflow-hidden rounded-md border bg-background"
                                className="h-full w-full object-cover"
                                aspectRatio="1/1"
                                thumbWidth={320}
                              />
                              <p className="truncate text-xs text-muted-foreground">
                                Simulação: {image.product_name}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    {item.role === "lead" && item.generation_status === "pending" && (
                      <p className="mt-2 text-xs opacity-80">Gerando resposta…</p>
                    )}
                    {item.role === "lead" && item.generation_status === "failed" && (
                      <p className="mt-2 text-xs font-medium text-destructive-foreground">
                        A geração falhou. Esta mensagem não recebeu resposta.
                      </p>
                    )}
                    {item.role === "agent" && (
                      <div className="mt-3 space-y-2 border-t pt-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => review(item, "approved")}
                            disabled={busy}
                          >
                            <Check className="mr-1 h-3 w-3" /> Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => review(item, "rejected")}
                            disabled={busy}
                          >
                            <ThumbsDown className="mr-1 h-3 w-3" /> Rejeitar
                          </Button>
                        </div>
                        <Textarea
                          value={corrections[item.id] ?? item.correction_text ?? ""}
                          onChange={(event) =>
                            setCorrections((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                          placeholder="Escreva a resposta correta"
                          rows={2}
                        />
                        <Button size="sm" onClick={() => review(item, "corrected")} disabled={busy}>
                          Salvar correção
                        </Button>
                        {item.review_status === "corrected" && !item.promoted_learning_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateLearning(item, "create")}
                            disabled={busy}
                          >
                            Criar candidato a aprendizado
                          </Button>
                        )}
                        {item.learning_promotion_status === "pending" && (
                          <Button
                            size="sm"
                            onClick={() => updateLearning(item, "approve")}
                            disabled={busy}
                          >
                            Aprovar aprendizado
                          </Button>
                        )}
                        {item.learning_promotion_status === "approved" && (
                          <span className="ml-2 text-xs text-emerald-600">Aprendizado ativo</span>
                        )}
                        {item.review_status && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Avaliação: {item.review_status}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Digite como se fosse o cliente..."
                rows={2}
              />
              <Button onClick={send} disabled={busy || !message.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
