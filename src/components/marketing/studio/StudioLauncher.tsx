// Entrada do Estúdio Criativo na área "Criar": começar um carrossel ou uma
// arte, e reabrir os rascunhos da empresa.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GalleryHorizontalEnd, Image as ImageIcon, Loader2, Wand2 } from "lucide-react";
import { apiListContents, apiListStudioSources, apiProposeStudioCarousel } from "@/data/marketingRepo";
import { toast } from "sonner";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import { documentFromContentRow, studioKindOf } from "@/lib/marketing/studio/content-mapping";
import { STUDIO_KINDS, newDocument, normalizeDocument, type StudioKind } from "@/lib/marketing/studio/document";
import { CAROUSEL_RECIPES, buildCarousel, getRecipe } from "@/lib/marketing/studio/carousel-recipes";
import { Chip, ChipRow } from "../ui/MarketingUi";
import type { SceneFormat } from "@/lib/marketing/video-editor/scenes/registry";
import { FORMAT_LABELS } from "./CreativeStudio";
import { StudioDialog, type StudioSession } from "./StudioDialog";

interface Props {
  companyId: string;
}

const STARTS: Array<{ kind: StudioKind; format: SceneFormat; title: string; hint: string; icon: typeof ImageIcon }> = [
  { kind: "carousel", format: "portrait", title: "Carrossel 4:5", hint: "Várias páginas no feed, formato vertical.", icon: GalleryHorizontalEnd },
  { kind: "carousel", format: "square", title: "Carrossel 1:1", hint: "Várias páginas no feed, formato quadrado.", icon: GalleryHorizontalEnd },
  { kind: "art", format: "portrait", title: "Arte para o feed", hint: "Uma imagem 4:5 (ou 1:1) com a sua marca.", icon: ImageIcon },
  { kind: "art", format: "story", title: "Arte para Story", hint: "Uma imagem 9:16 em tela cheia.", icon: ImageIcon },
];

export function StudioLauncher({ companyId }: Props) {
  const [session, setSession] = useState<StudioSession | null>(null);
  const [drafts, setDrafts] = useState<MarketingContentRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [recipeId, setRecipeId] = useState<string>(CAROUSEL_RECIPES[0].id);
  const recipe = getRecipe(recipeId);

  // Proposta a partir do cadastro (produto e/ou promoção da empresa).
  const [sources, setSources] = useState<{ products: Array<{ id: string; name: string }>; promotions: Array<{ id: string; title: string }> } | null>(null);
  const [productId, setProductId] = useState("");
  const [promotionId, setPromotionId] = useState("");
  const [proposing, setProposing] = useState(false);
  useEffect(() => {
    apiListStudioSources()
      .then(setSources)
      .catch(() => setSources({ products: [], promotions: [] }));
  }, []);

  async function propose() {
    setProposing(true);
    try {
      const res = await apiProposeStudioCarousel({ product_id: productId || null, promotion_id: promotionId || null, recipe: recipeId, format: "portrait" });
      const document = normalizeDocument(res.document);
      if (!document) throw new Error("invalid");
      setSession({ key: `proposal-${Date.now()}`, document });
      toast.info(
        res.used.has_price
          ? "Proposta montada com os dados do cadastro. Revise os textos antes de concluir."
          : "Proposta montada com os dados do cadastro. Não há preço cadastrado, então nenhum preço foi incluído.",
      );
    } catch {
      toast.error("Não foi possível montar a proposta. Verifique o produto ou a promoção e tente de novo.");
    } finally {
      setProposing(false);
    }
  }

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const rows = await apiListContents();
      setDrafts(rows.filter((row) => studioKindOf(row) && row.status !== "archived"));
    } catch {
      setFailed(true);
      setDrafts([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function start(kind: StudioKind, format: SceneFormat) {
    const document = kind === "carousel" ? buildCarousel({ recipe, format }) : newDocument(kind, recipe.steps[0].template, format);
    setSession({ key: `new-${Date.now()}`, document });
  }
  function open(row: MarketingContentRow) {
    const document = documentFromContentRow(row);
    if (document) setSession({ key: `${row.id}-${Date.now()}`, document, contentId: row.id, caption: row.body ?? "" });
  }

  return (
    <div className="space-y-5" data-testid="studio-launcher">
      <div>
        <h2 className="text-base font-semibold">Estúdio criativo</h2>
        <p className="text-sm text-muted-foreground">Monte carrosséis e artes com os mesmos modelos, cores e logo dos seus vídeos.</p>
      </div>

      <div className="space-y-1">
        <ChipRow label="Finalidade">
          {CAROUSEL_RECIPES.map((r) => (
            <Chip key={r.id} active={r.id === recipeId} onClick={() => setRecipeId(r.id)}>
              {r.label}
            </Chip>
          ))}
        </ChipRow>
        <p className="text-xs text-muted-foreground">
          {recipe.description} O carrossel já nasce com cinco páginas: impacto, apresentação, benefício, diferencial e chamada.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STARTS.map(({ kind, format, title, hint, icon: Icon }) => (
          <button
            key={`${kind}-${format}`}
            type="button"
            onClick={() => start(kind, format)}
            className="rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-sm"
          >
            <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden />
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{hint}</div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-4" data-testid="studio-proposal">
        <h3 className="text-sm font-semibold">Carrossel a partir do seu cadastro</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Monta as páginas com o nome, a descrição, as fotos e o preço que já estão cadastrados. Nada é inventado: sem preço no cadastro, não aparece preço.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[180px] flex-1 text-xs">
            <span className="mb-1 block font-medium">Produto</span>
            <select aria-label="Produto" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!sources}>
              <option value="">{sources ? "Nenhum" : "Carregando…"}</option>
              {sources?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 text-xs">
            <span className="mb-1 block font-medium">Promoção</span>
            <select aria-label="Promoção" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={promotionId} onChange={(e) => setPromotionId(e.target.value)} disabled={!sources}>
              <option value="">{sources ? "Nenhuma" : "Carregando…"}</option>
              {sources?.promotions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => void propose()} disabled={proposing || (!productId && !promotionId)}>
            {proposing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Montar proposta
          </Button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Seus rascunhos do estúdio</h3>
        {drafts === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os rascunhos.{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => void load()}>
              Tentar novamente
            </Button>
          </p>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum carrossel ou arte salvo ainda.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {drafts.map((row) => {
              const doc = documentFromContentRow(row);
              if (!doc) return null;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.title || STUDIO_KINDS[doc.kind]}</div>
                    <div className="text-xs text-muted-foreground">
                      {STUDIO_KINDS[doc.kind]} · {FORMAT_LABELS[doc.format]}
                      {doc.kind === "carousel" ? ` · ${doc.pages.length} páginas` : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => open(row)}>
                    Abrir
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <StudioDialog companyId={companyId} session={session} onClose={() => setSession(null)} onSaved={() => void load()} />
    </div>
  );
}
