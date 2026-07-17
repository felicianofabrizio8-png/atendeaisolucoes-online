import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Film } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  RENDER_DURATIONS,
  VIDEO_FORMATS,
  VIDEO_FORMAT_DIMENSIONS,
  type RenderDuration,
  type VideoFormat,
} from "@/lib/render-engine/render.types";
import {
  formatVideoTimeLabel,
  suggestStartSecond,
  validateAudioRange,
} from "@/lib/render-engine/render.validation";
import { createRenderJob } from "@/lib/render-engine/render-job.functions";
import { useServerFn } from "@tanstack/react-start";

interface Props {
  companyId: string;
  onCreated?: () => void;
}

interface ImageOpt {
  id: string;
  title: string | null;
  storage_path: string;
}
interface AudioOpt {
  id: string;
  name: string;
  duration_seconds: number;
  preferred_start_second: number | null;
}

export function VideoRenderForm({ companyId, onCreated }: Props) {
  const [images, setImages] = useState<ImageOpt[]>([]);
  const [audios, setAudios] = useState<AudioOpt[]>([]);
  const [imageId, setImageId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [format, setFormat] = useState<VideoFormat>("story");
  const [duration, setDuration] = useState<RenderDuration>(15);
  const [startSec, setStartSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);

  const create = useServerFn(createRenderJob);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: imgs }, { data: auds }] = await Promise.all([
        supabase
          .from("marketing_media")
          .select("id, title, storage_path")
          .eq("company_id", companyId)
          .eq("media_type", "image")
          .eq("active", true)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("audio_library")
          .select("id, name, duration_seconds, preferred_start_second")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      setImages((imgs ?? []) as unknown as ImageOpt[]);
      setAudios((auds ?? []) as unknown as AudioOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const selectedAudio = useMemo(
    () => audios.find((a) => a.id === audioId) ?? null,
    [audios, audioId],
  );

  // Sugestão automática de trecho quando muda áudio ou duração
  useEffect(() => {
    if (!selectedAudio) return;
    setStartSec(
      suggestStartSecond(
        selectedAudio.preferred_start_second,
        selectedAudio.duration_seconds,
        duration,
      ),
    );
  }, [selectedAudio, duration]);

  // Preview do áudio
  useEffect(() => {
    let cancelled = false;
    setAudioPreviewUrl(null);
    if (!audioId) return;
    (async () => {
      const audio = audios.find((a) => a.id === audioId);
      if (!audio) return;
      const { data: row } = await supabase
        .from("audio_library").select("file_path").eq("id", audioId).maybeSingle();
      if (!row?.file_path || cancelled) return;
      const { data: signed } = await supabase.storage
        .from("audio-library").createSignedUrl(row.file_path, 600);
      if (!cancelled) setAudioPreviewUrl(signed?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [audioId, audios]);

  const rangeError = useMemo(() => {
    if (!selectedAudio) return null;
    return validateAudioRange({
      audio_duration_seconds: selectedAudio.duration_seconds,
      audio_start_second: startSec,
      duration_seconds: duration,
    });
  }, [selectedAudio, startSec, duration]);

  const canSubmit = !!imageId && !!audioId && !rangeError && !submitting;
  const dims = VIDEO_FORMAT_DIMENSIONS[format];

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await create({
        data: {
          image_id: imageId,
          audio_id: audioId,
          video_format: format,
          audio_start_second: startSec,
          duration_seconds: duration,
        },
      });
      toast.success("Job criado. Renderização será iniciada pelo worker.");
      onCreated?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao criar job";
      toast.error(translateError(msg));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Gerar vídeo</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Imagem da biblioteca</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={imageId}
            onChange={(e) => setImageId(e.target.value)}
          >
            <option value="">— Selecione —</option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title ?? i.storage_path.split("/").pop()}
              </option>
            ))}
          </select>
          {images.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Nenhuma imagem ativa. Envie uma imagem na Biblioteca.
            </p>
          )}
        </div>

        <div>
          <Label>Música da biblioteca de áudio</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={audioId}
            onChange={(e) => setAudioId(e.target.value)}
          >
            <option value="">— Selecione —</option>
            {audios.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatVideoTimeLabel(a.duration_seconds)}
              </option>
            ))}
          </select>
          {audios.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Nenhum áudio ativo. Envie um áudio na aba Áudios.
            </p>
          )}
        </div>

        <div>
          <Label>Formato</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={format}
            onChange={(e) => setFormat(e.target.value as VideoFormat)}
          >
            {VIDEO_FORMATS.map((f) => (
              <option key={f} value={f}>
                {VIDEO_FORMAT_DIMENSIONS[f].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {dims.width} × {dims.height}
          </p>
        </div>

        <div>
          <Label>Duração</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as RenderDuration)}
          >
            {RENDER_DURATIONS.map((d) => (
              <option key={d} value={d}>{d} segundos</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <Label>Início do trecho (segundo)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.1}
              max={Math.max(0, (selectedAudio?.duration_seconds ?? 0) - duration)}
              value={startSec}
              onChange={(e) => setStartSec(Math.max(0, Number(e.target.value) || 0))}
              className="max-w-[160px]"
            />
            <span className="text-xs text-muted-foreground">
              {selectedAudio
                ? `Fim: ${formatVideoTimeLabel(startSec + duration)} de ${formatVideoTimeLabel(selectedAudio.duration_seconds)}`
                : "Selecione um áudio"}
            </span>
          </div>
          {rangeError && (
            <p className="text-xs text-destructive mt-1">{translateError(rangeError)}</p>
          )}
        </div>

        {audioPreviewUrl && (
          <div className="md:col-span-2">
            <Label>Ouvir</Label>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={audioPreviewUrl} controls className="w-full" />
          </div>
        )}
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        <div>
          <strong>Resumo:</strong> {dims.label} · {duration}s ·
          trecho {formatVideoTimeLabel(startSec)}–{formatVideoTimeLabel(startSec + duration)}
        </div>
        <div className="mt-1">
          Este MVP renderiza a imagem estática com áudio. Nenhum texto, logo ou animação é adicionado.
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onSubmit} disabled={!canSubmit} size="lg">
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Film className="h-4 w-4 mr-1" />
          )}
          Gerar vídeo
        </Button>
      </div>
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case "audio_slice_exceeds_duration":
      return "O trecho ultrapassa a duração do áudio.";
    case "audio_start_negative":
      return "Início não pode ser negativo.";
    case "audio_duration_invalid":
      return "Áudio sem duração válida.";
    case "duration_non_positive":
      return "Duração inválida.";
    case "too_many_active_jobs":
      return "Você já tem o máximo de jobs ativos. Aguarde concluir.";
    case "image_inactive":
    case "image_wrong_type":
    case "image_not_found":
      return "Imagem indisponível.";
    case "audio_inactive":
    case "audio_not_found":
      return "Áudio indisponível.";
    case "image_cross_tenant":
    case "audio_cross_tenant":
      return "Recurso não pertence à sua empresa.";
    default:
      return code;
  }
}
