// Rota legada do WhatsApp via QR Code (Evolution).
// Descontinuada — toda a operação migrou para o WhatsApp Cloud API oficial.
// Mantida como página de aviso para não quebrar links/históricos.

import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Cloud } from "lucide-react";

export const Route = createFileRoute("/whatsapp")({
  component: WhatsAppDeprecatedPage,
});

function WhatsAppDeprecatedPage() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/5 p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-md inline-flex items-center justify-center bg-[var(--status-urgent)]/15 text-[var(--status-urgent)] shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold mb-1">
              Conexão via QR Code foi descontinuada
            </h1>
            <p className="text-sm text-muted-foreground mb-4">
              O Atende Ai agora opera exclusivamente com o{" "}
              <strong>WhatsApp Oficial da Meta (Cloud API)</strong> para
              garantir estabilidade, conformidade e suporte profissional a
              múltiplos atendentes. Conecte seu número oficial para continuar
              recebendo mensagens, automações de IA e follow-ups.
            </p>
            <Link
              to="/configuracoes"
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90"
            >
              <Cloud className="h-3.5 w-3.5" />
              Conectar WhatsApp Oficial Meta
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4">
        Seus dados históricos permanecem preservados. Apenas a forma de
        conexão foi atualizada.
      </p>
    </div>
  );
}
