import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  apiListPromotions,
  apiGenerateContent,
} from "@/data/marketingRepo";
import type {
  MarketingPromotionRow,
  MarketingContentRow,
} from "@/lib/marketing/marketing.types";
import { MarketingLibrary } from "./MarketingLibrary";
import type { MediaSelection } from "@/lib/marketing/media-selection";
import { sameSelection, selectionKey } from "@/lib/marketing/media-selection";

interface Props {
  companyId: string;
  onGenerated?: (contents: MarketingContentRow[]) => void;
}

export function MarketingGenerator({ companyId, onGenerated }: Props) {
  const [promotions, setPromotions] = useState<MarketingPromotionRow[]>([]);
  const [promotionId, setPromotionId] = useState<string>("");
  const [tone, setTone] = useState<"amigável" | "profissional" | "descontraído" | "urgente">("amigável");
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");
  const [selection, setSelection] = useState<MediaSelection[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<MarketingContentRow[]>([]);

  useEffect(() => {
    void apiListPromotions().then(setPromotions).catch(() => {});
  }, [companyId]);

  const marketingIds = useMemo(
    () => selection.filter((s) => s.origin === "marketing").map((s) => (s as { id: string }).id),
    [selection],
  );
  const productSelections = useMemo(
    () => selection.filter((s): s is Extract<MediaSelection, { origin: "product" }> => s.origin === "product"),
    [selection],
  );

  async function generate() {
    setGenerating (true);
    try {
      const productHint = productSelections.length
        ? `Referências visuais de produtos: ${Array.from(
            new Set(productSelections.map((p) => p.productName)),
          ).join(", ")}.`
        : "";
      const extraFinal = [extra.trim(), productHint].filter(Boolean).join("\n");
      const contents = await apiGenerateContent({
        promotion_id: promotionId || null,
        media_ids: marketingIds,
        tone,
        audience: audience.trim() || null,
        extra_instructions: extra.trim() || null,
      });
      setLastResult(contents);
      toast.success("4 conteúdos gerados como rascunho. Revise em Aprovação.");
      onGenerated?.(contents);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar conteúdo.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Promoção (opcional)</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={promotionId}
              onChange={(e) => setPromotionId(e.target.value)}
            >
              <option value="">— Sem promoção específica —</option>
              {promotions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tom da comunicação</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value as typeof tone)}
            >
              <option value="amigável">Amigável</option>
              <option value="profissional">Profissional</option>
              <option value="descontraído">Descontraído</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Público-alvo</Label>
            <Input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Ex.: famílias com crianças, moradores da região"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Instruções extras (opcional)</Label>
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={2}
              placeholder="Ex.: destacar entrega grátis; mencionar 10 anos de mercado"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold">
          Mídias associadas (opcional) —
          <span className="text-muted-foreground font-normal ml-1">
            {selectedMedia.length} selecionada(s)
          </span>
        </div>
        <MarketingLibrary
          companyId={companyId}
          selectable
          selectedIds={selectedMedia}
          onToggleSelect={(id) =>
            setSelectedMedia((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={generate} disabled={generating} size="lg">
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          Gerar Story, Feed, Reel e WhatsApp
        </Button>
      </div>

      {lastResult.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="text-sm font-semibold">Últimos rascunhos gerados</div>
          <ul className="text-sm space-y-1">
            {lastResult.map((c) => (
              <li key={c.id} className="text-muted-foreground">
                <span className="uppercase text-[10px] font-semibold text-foreground mr-2">
                  {c.format}
                </span>
                {c.title ?? c.body.slice(0, 80)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Aprove ou edite na aba <strong>Aprovação</strong> antes de agendar.
          </p>
        </div>
      )}
    </div>
  );
}
