// Entrada do Estúdio Criativo na área "Criar": começar um carrossel ou uma
// arte, e reabrir os rascunhos da empresa.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GalleryHorizontalEnd, Image as ImageIcon, Loader2 } from "lucide-react";
import { apiListContents } from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import { documentFromContentRow, studioKindOf } from "@/lib/marketing/studio/content-mapping";
import { STUDIO_KINDS, newDocument, type StudioKind } from "@/lib/marketing/studio/document";
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
