// Seletor de áudio único da campanha. Lê a Biblioteca de Áudio da empresa
// via listAudioLibrary (respeitando RLS). Não reproduz o áudio aqui — apenas
// exibe metadados essenciais (nome, categoria, duração). Reprodução completa
// permanece na área "Áudio" da Biblioteca.
//
// Interação simples: cartão clicável com estado "selecionado" único.

import { useEffect, useState } from "react";
import { Loader2, Music2, Check } from "lucide-react";
import { listAudioLibrary } from "@/lib/audio-library/audio-library-service";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";
import { formatSeconds } from "@/components/marketing/audio-library/audio-ui-helpers";

interface Props {
  selectedId: string | null;
  onSelect: (audio: AudioLibraryRow | null) => void;
}

export function CampaignAudioPicker({ selectedId, onSelect }: Props) {
  const [rows, setRows] = useState<AudioLibraryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAudioLibrary({ activeOnly: true })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar áudios");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando áudios…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        Nenhum áudio cadastrado. Faça upload em <strong>Biblioteca &gt; Áudios</strong>.
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label="Seleção de áudio da campanha"
      className="grid grid-cols-1 md:grid-cols-2 gap-2"
    >
      {rows.map((a) => {
        const sel = a.id === selectedId;
        return (
          <li key={a.id}>
            <button
              type="button"
              role="option"
              aria-selected={sel}
              onClick={() => onSelect(sel ? null : a)}
              className={`w-full text-left rounded-md border p-3 flex items-start gap-3 transition ${
                sel
                  ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="mt-0.5">
                {sel ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Music2 className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {a.category ?? "—"} · {a.mood ?? "—"} · {formatSeconds(Number(a.duration_seconds ?? 0))}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
