import { useEffect, useState } from "react";
import { MapPin, Loader2, Send, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CompanyLocation {
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function SendLocationDialog({
  open,
  onOpenChange,
  conversationId,
  companyId,
  disabled,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string;
  companyId: string | null;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loc, setLoc] = useState<CompanyLocation | null>(null);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from("company_settings")
          .select("location")
          .eq("company_id", companyId)
          .maybeSingle();
        if (cancelled) return;
        const raw = (data?.location ?? null) as Record<string, unknown> | null;
        if (!raw) {
          setLoc(null);
        } else {
          const lat = raw.latitude != null ? Number(raw.latitude) : NaN;
          const lng = raw.longitude != null ? Number(raw.longitude) : NaN;
          setLoc({
            name: (raw.name as string | null) ?? null,
            address: (raw.address as string | null) ?? null,
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
          });
        }
      } catch {
        if (!cancelled) setLoc(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, companyId]);

  if (!open) return null;

  const isValid =
    loc?.latitude != null &&
    loc?.longitude != null &&
    loc.latitude >= -90 && loc.latitude <= 90 &&
    loc.longitude >= -180 && loc.longitude <= 180;

  const mapUrl = isValid
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${loc!.longitude! - 0.005}%2C${loc!.latitude! - 0.003}%2C${loc!.longitude! + 0.005}%2C${loc!.latitude! + 0.003}&layer=mapnik&marker=${loc!.latitude}%2C${loc!.longitude}`
    : null;

  const handleSend = async () => {
    if (!isValid || sending || disabled) return;
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/whatsapp/send-location", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; requires_template?: boolean };
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success("Localização enviada");
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar localização";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !sending && onOpenChange(false)}
    >
      <div
        className="bg-card rounded-lg border border-border max-w-md w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            Enviar localização
          </div>
          <button
            type="button"
            onClick={() => !sending && onOpenChange(false)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Carregando localização da empresa…
            </div>
          ) : !isValid ? (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 text-foreground font-medium">
                <AlertTriangle className="h-4 w-4 text-[var(--status-warm)]" />
                Localização não configurada
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Cadastre a localização da empresa em{" "}
                <span className="font-semibold">Configurações &gt; Localização da empresa</span>{" "}
                para enviar pelo chat.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5 text-sm">
                {loc?.name && (
                  <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Nome</div>
                    <div className="font-medium">{loc.name}</div>
                  </div>
                )}
                {loc?.address && (
                  <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Endereço</div>
                    <div>{loc.address}</div>
                  </div>
                )}
                <div className="flex gap-4">
                  <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Latitude</div>
                    <div className="font-mono text-xs">{loc!.latitude!.toFixed(6)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Longitude</div>
                    <div className="font-mono text-xs">{loc!.longitude!.toFixed(6)}</div>
                  </div>
                </div>
              </div>

              {mapUrl && (
                <div className="rounded-md overflow-hidden border border-border">
                  <iframe
                    src={mapUrl}
                    title="Pré-visualização do mapa"
                    className="w-full h-48 block"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="h-9 px-3 rounded-md text-sm hover:bg-accent disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!isValid || sending || disabled}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
