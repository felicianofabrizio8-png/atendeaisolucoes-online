// Checklist visual de 8 itens do onboarding Cloud API.
// Consome /api/whatsapp/debug com { useSaved: true } e mostra status
// claro de cada etapa + botão "Resolver na Meta" quando aplicável.

import { useCallback, useEffect, useState } from "react";
import { Check, AlertTriangle, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type Status = "ok" | "warn" | "error" | "pending" | "loading";

interface Item {
  key: string;
  label: string;
  status: Status;
  hint?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

interface DebugResp {
  ok: boolean;
  saved_integration?: {
    id: string;
    external_account_id: string | null;
    saved_waba_id: string | null;
    token_expires_at: string | null;
    active: boolean;
  } | null;
  debug_token?: {
    ok: boolean;
    body?: {
      data?: {
        is_valid?: boolean;
        expires_at?: number;
        scopes?: string[];
        application?: string;
      };
      error?: { message?: string };
    };
  };
  me?: { ok: boolean; body?: { name?: string } };
  waba?: {
    ok: boolean;
    body?: { id?: string; name?: string; currency?: string; timezone_id?: string };
  };
  phone_number?: {
    ok: boolean;
    body?: {
      display_phone_number?: string;
      verified_name?: string;
      code_verification_status?: string;
      whatsapp_business_account?: { id?: string };
    };
  };
  webhook_subscribed?: boolean;
  billing_likely_ok?: boolean;
  billing?: {
    body?: {
      account_review_status?: string;
      business_verification_status?: string;
    };
  };
  comparison?: { verdict?: string };
  error?: string;
}

const META_LINKS = {
  whatsappManager: "https://business.facebook.com/wa/manage/home/",
  phoneNumbers: "https://business.facebook.com/wa/manage/phone-numbers/",
  billing: "https://business.facebook.com/billing_hub/payment_settings/",
  businessSettings: "https://business.facebook.com/settings",
};

export function OnboardingChecklist({
  onTestSend,
  testSendOk,
}: {
  onTestSend?: () => void;
  testSendOk?: boolean;
}) {
  const [data, setData] = useState<DebugResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/whatsapp/debug", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ useSaved: true }),
      });
      const json = (await res.json()) as DebugResp;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao validar conexão");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items: Item[] = (() => {
    if (loading || !data) {
      return [
        "Login Meta",
        "Empresa selecionada",
        "WABA encontrada",
        "Número conectado",
        "Token válido",
        "Webhook ativo",
        "Pagamento configurado",
        "Teste de envio aprovado",
      ].map((label, i) => ({
        key: `pending-${i}`,
        label,
        status: "loading" as Status,
      }));
    }

    const saved = data.saved_integration ?? null;
    const tokenValid = data.debug_token?.body?.data?.is_valid === true;
    const tokenExp = data.debug_token?.body?.data?.expires_at ?? 0;
    const tokenExpiresSoon =
      tokenExp > 0 && tokenExp * 1000 - Date.now() < 7 * 24 * 60 * 60 * 1000;
    const wabaOk = data.waba?.ok === true;
    const phoneOk = data.phone_number?.ok === true;
    const verdict = data.comparison?.verdict ?? "";
    const webhookOk = !!data.webhook_subscribed;
    const billingOk = !!data.billing_likely_ok;

    return [
      {
        key: "login",
        label: "Login Meta",
        status: (data.me?.ok ? "ok" : "error") as Status,
        hint: data.me?.body?.name
          ? `Conectado como ${data.me.body.name}`
          : "Não autenticado na Meta",
        action: data.me?.ok
          ? undefined
          : { label: "Refazer login", href: "/onboarding/whatsapp" },
      },
      {
        key: "empresa",
        label: "Empresa selecionada",
        status: (saved?.active ? "ok" : "error") as Status,
        hint: saved?.id ? `Integração #${saved.id.slice(0, 8)}` : "Sem integração ativa",
      },
      {
        key: "waba",
        label: "WABA encontrada",
        status: (wabaOk ? "ok" : "error") as Status,
        hint: data.waba?.body?.name ?? "WABA não encontrada para esta empresa",
        action: wabaOk
          ? undefined
          : { label: "Resolver na Meta", href: META_LINKS.whatsappManager },
      },
      {
        key: "phone",
        label: "Número conectado",
        status: (phoneOk ? "ok" : "error") as Status,
        hint: phoneOk
          ? `${data.phone_number?.body?.display_phone_number} · ${data.phone_number?.body?.verified_name ?? "sem verified name"}`
          : "Número não acessível com o token salvo",
        action: phoneOk
          ? undefined
          : { label: "Resolver na Meta", href: META_LINKS.phoneNumbers },
      },
      {
        key: "token",
        label: "Token válido",
        status: (tokenValid
          ? tokenExpiresSoon
            ? "warn"
            : "ok"
          : "error") as Status,
        hint: tokenValid
          ? tokenExp > 0
            ? `Expira em ${new Date(tokenExp * 1000).toLocaleDateString("pt-BR")}`
            : "Token de longa duração"
          : (data.debug_token?.body?.error?.message ?? "Token inválido ou expirado"),
        action: tokenValid && !tokenExpiresSoon
          ? undefined
          : { label: "Renovar conexão", href: "/onboarding/whatsapp" },
      },
      {
        key: "webhook",
        label: "Webhook ativo",
        status: (webhookOk ? "ok" : "error") as Status,
        hint: webhookOk
          ? "App inscrito para receber eventos da WABA"
          : "Nenhum app subscrito nessa WABA",
        action: webhookOk
          ? undefined
          : { label: "Reconfigurar webhook", href: "/onboarding/whatsapp" },
      },
      {
        key: "billing",
        label: "Pagamento configurado",
        status: (billingOk ? "ok" : "warn") as Status,
        hint: billingOk
          ? `Moeda WABA: ${data.waba?.body?.currency ?? "—"}`
          : "Não foi possível confirmar billing automaticamente. Verifique no Meta Business.",
        action: { label: "Abrir billing", href: META_LINKS.billing },
      },
      {
        key: "test",
        label: "Teste de envio aprovado",
        status: (testSendOk ? "ok" : verdict === "OK" && phoneOk ? "pending" : "warn") as Status,
        hint: testSendOk
          ? "Mensagem de teste enviada com sucesso"
          : "Envie uma mensagem de teste abaixo para confirmar",
        action: onTestSend
          ? { label: "Enviar teste", onClick: onTestSend }
          : undefined,
      },
    ];
  })();

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Checklist da conexão</h3>
          <p className="text-[11px] text-muted-foreground">
            Validamos cada etapa direto na Meta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-md border border-border px-2.5 py-1.5 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Reverificar
        </button>
      </div>

      {err && (
        <div className="px-4 py-2.5 text-xs text-destructive border-b border-border bg-destructive/5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <ol className="divide-y divide-border">
        {items.map((it, idx) => (
          <ChecklistRow key={it.key} index={idx + 1} item={it} />
        ))}
      </ol>
    </div>
  );
}

function ChecklistRow({ index, item }: { index: number; item: Item }) {
  const Icon = () => {
    switch (item.status) {
      case "ok":
        return (
          <span className="h-6 w-6 rounded-full bg-[var(--status-ok)]/15 text-[var(--status-ok)] inline-flex items-center justify-center">
            <Check className="h-3.5 w-3.5" />
          </span>
        );
      case "warn":
        return (
          <span className="h-6 w-6 rounded-full bg-yellow-500/15 text-yellow-600 inline-flex items-center justify-center">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        );
      case "error":
        return (
          <span className="h-6 w-6 rounded-full bg-destructive/15 text-destructive inline-flex items-center justify-center">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        );
      case "loading":
        return (
          <span className="h-6 w-6 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        );
      default:
        return (
          <span className="h-6 w-6 rounded-full border border-border text-muted-foreground inline-flex items-center justify-center text-[10px] font-semibold">
            {index}
          </span>
        );
    }
  };

  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <Icon />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">{item.label}</div>
        {item.hint && (
          <div className="text-[11px] text-muted-foreground truncate">{item.hint}</div>
        )}
      </div>
      {item.action && (item.status === "error" || item.status === "warn" || item.status === "pending") && (
        item.action.href ? (
          <a
            href={item.action.href}
            target={item.action.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5"
          >
            {item.action.label}
            {item.action.href.startsWith("http") && <ExternalLink className="h-3 w-3" />}
          </a>
        ) : (
          <button
            type="button"
            onClick={item.action.onClick}
            className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 px-2.5 py-1.5"
          >
            {item.action.label}
          </button>
        )
      )}
    </li>
  );
}
