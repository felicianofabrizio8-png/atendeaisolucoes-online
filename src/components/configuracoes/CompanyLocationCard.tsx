// Extraído de src/routes/configuracoes.tsx (Sprint 7 — Fase 7.1).
// Conteúdo idêntico ao original: apenas movido para reduzir o tamanho da rota.

import { useState, useEffect } from "react";
import { Check, Loader2, AlertTriangle, MapPin, Crosshair } from "lucide-react";
import { safeErrorMessage } from "@/lib/audit/sanitize";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Localização da empresa — usada pelo botão "Localização" no chat (Feature 2)
// Armazena em company_settings.location (JSONB): { name, address, latitude, longitude }
// ---------------------------------------------------------------------------
export function CompanyLocationCard() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleUseCurrentLocation = () => {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocalização não é suportada neste navegador.");
      return;
    }
    setLocating(true);
    // CRÍTICO: chamar getCurrentPosition SÍNCRONO no handler do clique
    // para preservar o gesto do usuário (exigido pelos navegadores).
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        setLatitude(la.toFixed(6));
        setLongitude(lo.toFixed(6));
        setSavedAt(null);
        setLocating(false);
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permissão de localização negada. Habilite no navegador e tente novamente."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Não foi possível obter sua localização agora."
              : err.code === err.TIMEOUT
                ? "Tempo esgotado ao obter localização."
                : "Falha ao obter localização.";
        setGeoError(msg);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    if (!companyId) return;
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
        if (raw) {
          setName((raw.name as string | null) ?? "");
          setAddress((raw.address as string | null) ?? "");
          setLatitude(raw.latitude != null ? String(raw.latitude) : "");
          setLongitude(raw.longitude != null ? String(raw.longitude) : "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const latValid = latitude.trim() !== "" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lngValid = longitude.trim() !== "" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  const canSave = !!companyId && latValid && lngValid && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("company_settings")
        .update({
          location: {
            name: name.trim() || null,
            address: address.trim() || null,
            latitude: lat,
            longitude: lng,
          },
        })
        .eq("company_id", companyId!);
      if (error) throw error;
      setSavedAt(Date.now());
    } catch (e) {
      console.error("[company_location save]", safeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const mapUrl =
    latValid && lngValid
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005}%2C${lat - 0.003}%2C${lng + 0.005}%2C${lat + 0.003}&layer=mapnik&marker=${lat}%2C${lng}`
      : null;

  return (
    <section
      id="company-location"
      className="rounded-lg border border-border bg-card p-5 scroll-mt-20"
    >
      <div className="flex items-center gap-2 mb-1">
        <MapPin className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Localização da empresa</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Usada pelo botão <span className="font-semibold">Localização</span> no chat. Apenas latitude
        e longitude são obrigatórias.
      </p>

      {loading ? (
        <div className="py-6 flex items-center text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Carregando…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Ex.: Loja Centro"
              className="input"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
              Endereço
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={240}
              placeholder="Rua, número, bairro, cidade"
              className="input"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={locating}
              className="h-9 px-3 inline-flex items-center gap-2 rounded-md border border-border hover:bg-accent disabled:opacity-40 text-xs font-medium"
            >
              {locating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Crosshair className="h-3.5 w-3.5" />
              )}
              Usar minha localização atual
            </button>
            {geoError && (
              <span className="text-xs text-destructive inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {geoError}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Latitude *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="-23.5505"
                className={cn("input font-mono", latitude && !latValid && "border-destructive")}
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                Longitude *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-46.6333"
                className={cn("input font-mono", longitude && !lngValid && "border-destructive")}
              />
            </div>
          </div>

          {mapUrl && (
            <div className="rounded-md overflow-hidden border border-border">
              <iframe
                src={mapUrl}
                title="Pré-visualização do mapa"
                className="w-full h-44 block"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            {savedAt && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> salvo
              </span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 text-sm font-medium"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
