import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Modelos sugeridos de Follow-up para envio fora da janela de 24h.
 *
 * Todos foram redigidos para a categoria UTILITY do WhatsApp Business:
 *  - linguagem neutra, de continuidade de atendimento;
 *  - sem termos promocionais (oferta, desconto, promoção, condição especial,
 *    oportunidade, últimas unidades);
 *  - 1 variável apenas ({{1}} = nome do cliente).
 *
 * Os textos abaixo são apenas referência para cadastro no Gerenciador de
 * Negócios da Meta. Após aprovados, o motor de Follow-up os utilizará
 * automaticamente quando a janela de 24h estiver fechada.
 */
const SUGGESTIONS: Array<{
  name: string;
  purpose: string;
  body: string;
}> = [
  {
    name: "followup_continuidade_atendimento",
    purpose: "Continuidade de atendimento (orçamento em aberto)",
    body:
      "Olá {{1}}, tudo bem?\n" +
      "Estamos entrando em contato para dar continuidade ao atendimento que você iniciou conosco.\n" +
      "Caso ainda tenha alguma dúvida sobre seu orçamento ou projeto, responda esta mensagem que teremos prazer em ajudar.",
  },
  {
    name: "followup_solicitacao_em_aberto",
    purpose: "Solicitação em aberto",
    body:
      "Olá {{1}}.\n" +
      "Identificamos que sua solicitação permanece em aberto.\n" +
      "Se desejar continuar o atendimento ou receber mais informações sobre o projeto solicitado, basta responder esta mensagem.",
  },
  {
    name: "followup_atendimento_disponivel",
    purpose: "Atendimento disponível no sistema",
    body:
      "Olá {{1}}, tudo bem?\n" +
      "Seu atendimento continua disponível em nosso sistema.\n" +
      "Caso precise atualizar informações ou esclarecer dúvidas, estamos à disposição.\n" +
      "Responda esta mensagem para continuar o atendimento.",
  },
];

export function WhatsappTemplateSuggestions() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-2">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base md:text-lg">
            Modelos sugeridos (Utility) para Follow-up fora da janela de 24h
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre estes modelos no Gerenciador da Meta como categoria{" "}
            <strong>Utility</strong> (Utilidade), idioma <code>pt_BR</code> e
            variável <code>{"{{1}}"}</code> = nome do cliente. Após aprovados,
            sincronize, defina o propósito e ative “Auto-usar”. Eles serão
            usados automaticamente quando o cliente estiver fora da janela de
            24h.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {SUGGESTIONS.map((t) => (
            <div
              key={t.name}
              className="rounded-lg border border-border p-3 bg-card space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium break-all min-w-0">
                  {t.name}
                </span>
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border bg-primary/15 text-primary border-primary/30">
                  utility
                </span>
                <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded border border-border">
                  pt_BR
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t.purpose}</p>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed bg-muted/40 border border-border rounded p-2 font-sans">
                {t.body}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(t.body, `${t.name}-body`)}
                  className="h-8"
                >
                  {copied === `${t.name}-body` ? (
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Copiar corpo
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(t.name, `${t.name}-name`)}
                  className="h-8"
                >
                  {copied === `${t.name}-name` ? (
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Copiar nome
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
