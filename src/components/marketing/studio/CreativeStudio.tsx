// ============================================================================
// CreativeStudio — Carrossel e Arte no mesmo estúdio do vídeo.
//
// Mesmo desenho de tela (ferramentas · prévia · propriedades), mesmos painéis
// e o mesmo compositor de cenas do vídeo. O que muda é a base: em vez da
// timeline, uma faixa de páginas — cada página com foto, textos e modelo.
//
// O estado inteiro é um `StudioDocument` (ver lib/marketing/studio/document),
// salvo em `marketing_contents.design`. Identidade visual: logo e cores do
// cadastro de marca da empresa logada; nada é fixo por cliente.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImagePlus, Images, LayoutTemplate, Loader2, Palette, RotateCcw, Save, SlidersHorizontal, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { apiSaveStudioContent, campaignMediaDeps } from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import type { Anchor, TemplateId, VideoLayout } from "@/lib/marketing/video-editor/layout.types";
import type { ColorRole, SceneDefinition } from "@/lib/marketing/video-editor/scene.types";
import { SCENE_FORMATS, getScene, normalizeFraming, type ImageFraming, type SceneFormat } from "@/lib/marketing/video-editor/scenes/registry";
import { brandPalette, fitPaletteToScene, usedColorRoles } from "@/lib/marketing/video-editor/palette";
import { MEDIA_ERROR_MESSAGE, type MediaLoadError, type MediaResolverDeps } from "@/lib/marketing/campaign-media";
import {
  KIND_FORMATS,
  PAGE_ROLES,
  STUDIO_KINDS,
  addPage,
  canAddPage,
  canRemovePage,
  documentImages,
  duplicatePage,
  movePage,
  removePage,
  setFormat,
  updateAllPages,
  updatePage,
  type PageImageRef,
  type PageRole,
  type StudioDocument,
  type StudioPage,
} from "@/lib/marketing/studio/document";
import { applyAnchor, applyColors, applyTemplate, dragOffset, paletteForScene, type ColorChoice } from "@/lib/marketing/studio/layout-ops";
import { useBrandLogo } from "@/hooks/useBrandLogo";
import { SceneRenderer, type ScenePart } from "../campaign/editor/SceneRenderer";
import { useImageLoadStatus } from "../campaign/editor/useImageLoadStatus";
import { TabTexto } from "../campaign/editor/tabs/TabTexto";
import { ColorsPanel, PropertiesPanel, Segmented, TemplatePanel, type LogoManager } from "../campaign/editor/StudioPanels";
import { PageStrip } from "./PageStrip";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { useStudioImages } from "./useStudioImages";

export const FORMAT_LABELS: Record<SceneFormat, string> = { portrait: "4:5", square: "1:1", story: "9:16" };

type Tool = "templates" | "text" | "colors" | "media" | "props";

interface Props {
  companyId: string;
  initial: StudioDocument;
  /** Conteúdo já salvo que está sendo editado (ausente = novo). */
  contentId?: string | null;
  initialCaption?: string;
  onSaved?: (row: MarketingContentRow) => void;
  /** Só para testes e para a página de validação visual. */
  mediaDeps?: MediaResolverDeps;
  logoUrl?: string | null;
}

export function CreativeStudio({ companyId, initial, contentId: initialContentId = null, initialCaption = "", onSaved, mediaDeps = campaignMediaDeps, logoUrl: logoUrlOverride }: Props) {
  const [doc, setDoc] = useState<StudioDocument>(initial);
  const [pageId, setPageId] = useState(initial.pages[0].id);
  const [contentId, setContentId] = useState<string | null>(initialContentId);
  const [caption, setCaption] = useState(initialCaption);
  const [tool, setTool] = useState<Tool>("templates");
  const [selected, setSelected] = useState<ScenePart>("title");
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(!initialContentId);
  const [picking, setPicking] = useState(false);

  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  const pageIndex = doc.pages.indexOf(page);
  const scene = getScene(page.layout.template);
  const layout = page.layout;

  const change = useCallback((next: (cur: StudioDocument) => StudioDocument) => {
    setDoc(next);
    setDirty(true);
  }, []);
  const changePage = useCallback((patch: (p: StudioPage) => StudioPage) => change((cur) => updatePage(cur, pageId, patch)), [change, pageId]);
  const setLayout = useCallback((next: VideoLayout) => changePage((p) => ({ ...p, layout: next })), [changePage]);

  // ------------------------------ Marca -------------------------------------
  const brandLogo = useBrandLogo();
  const logoUrl = logoUrlOverride !== undefined ? logoUrlOverride : brandLogo.logoUrl;
  const brandColors = brandLogo.brandColors;

  // Documento novo (sem cores definidas) abre com a identidade da empresa.
  const colorsResolved = useRef(initial.pages.some((p) => !!p.layout.colors));
  useEffect(() => {
    if (colorsResolved.current || !brandColors) return;
    colorsResolved.current = true;
    setDoc((cur) => updateAllPages(cur, (p) => ({ ...p, layout: applyColors(p.layout, { mode: "brand" }, brandColors) })));
  }, [brandColors]);

  const logoManager: LogoManager = {
    url: logoUrl,
    canManage: brandLogo.canManage,
    saving: brandLogo.saving,
    error: brandLogo.error,
    published: brandLogo.brandPublished,
    onUpload: (file) => {
      void brandLogo.saveLogo(file).then((ok) => ok && toast.success("Logo da empresa atualizada."));
    },
    onRemove: () => {
      void brandLogo.removeLogo().then((ok) => ok && toast.success("Logo removida do cadastro da empresa."));
    },
  };

  // ------------------------------ Imagens -----------------------------------
  const imageRefs = useMemo(() => documentImages(doc), [doc]);
  const images = useStudioImages(imageRefs, mediaDeps);
  const urlFor = useCallback((p: StudioPage) => images.get(p.image)?.previewUrl ?? null, [images]);

  const stageUrl = urlFor(page);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const imageStatus = useImageLoadStatus(stageUrl, imageAttempt);
  const resolvedStage = images.get(page.image);
  const stageError: MediaLoadError | null = !page.image
    ? null
    : !stageUrl
      ? resolvedStage?.error ?? null
      : imageStatus === "timeout"
        ? "timeout"
        : imageStatus === "error"
          ? "image_failed"
          : null;
  const stageLoading = !!page.image && (retrying || images.loading(page.image) || (!!stageUrl && imageStatus === "loading"));

  async function retryImage() {
    if (!page.image) return;
    setRetrying(true);
    try {
      await images.retry(page.image);
    } finally {
      setRetrying(false);
      setImageAttempt((n) => n + 1);
    }
  }

  function pickImage(image: PageImageRef) {
    changePage((p) => ({ ...p, image: { ...image, framing: null } }));
    setPicking(false);
  }

  const framingDefaults = useMemo(() => ({ fit: "contain" as const, fill: scene.image.fill }), [scene.image.fill]);
  const framing: ImageFraming = normalizeFraming(page.image?.framing ?? null, framingDefaults);
  function updateFraming(patch: Partial<ImageFraming> | null) {
    changePage((p) => (p.image ? { ...p, image: { ...p.image, framing: patch === null ? null : { ...normalizeFraming(p.image.framing, framingDefaults), ...patch } } } : p));
  }

  // ------------------------------ Modelo, cores e texto ---------------------
  const paletteFor = useCallback((target: SceneDefinition) => paletteForScene(layout, brandColors, target), [layout, brandColors]);
  const handleTemplate = useCallback(
    (id: TemplateId) => {
      const next = getScene(id);
      colorsResolved.current = true;
      changePage((p) => ({ ...p, layout: applyTemplate(p.layout, next, brandColors) }));
    },
    [changePage, brandColors],
  );
  function templateToAll() {
    change((cur) => updateAllPages(cur, (p) => (p.id === page.id ? p : { ...p, layout: applyTemplate(p.layout, scene, brandColors) })));
    toast.info(`Modelo “${scene.label}” aplicado a todas as páginas.`);
  }
  // As cores valem para o conteúdo inteiro: um carrossel precisa parecer uma peça só.
  function setColors(choice: ColorChoice) {
    colorsResolved.current = true;
    change((cur) => updateAllPages(cur, (p) => ({ ...p, layout: applyColors(p.layout, choice, brandColors) })));
  }
  const palette = fitPaletteToScene(layout.colors ?? scene.palette, scene);

  const setText = (key: "headline" | "subheadline" | "cta") => (value: string) => changePage((p) => ({ ...p, text: { ...p.text, [key]: value } }));

  const dragBase = useRef<{ x: number; y: number } | null>(null);
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const handleDragText = useCallback(
    (dx: number, dy: number, phase: "move" | "end") => {
      const base = (dragBase.current ??= { x: latestLayout.current.offsetX ?? 0, y: latestLayout.current.offsetY ?? 0 });
      if (phase === "end") dragBase.current = null;
      changePage((p) => ({ ...p, layout: { ...p.layout, ...dragOffset(base, dx, dy) } }));
    },
    [changePage],
  );

  const handleSelect = useCallback((part: ScenePart) => {
    setSelected(part);
    if (typeof window !== "undefined" && !window.matchMedia?.("(min-width: 1024px)").matches) setTool("props");
  }, []);

  // ------------------------------ Páginas -----------------------------------
  const multi = doc.kind === "carousel";
  function selectAfter(next: StudioDocument, preferId?: string) {
    const id = preferId && next.pages.some((p) => p.id === preferId) ? preferId : next.pages[Math.min(pageIndex, next.pages.length - 1)].id;
    setPageId(id);
  }
  function handleAdd() {
    const next = addPage(doc, page.id);
    change(() => next);
    selectAfter(next, next.pages[pageIndex + 1]?.id);
  }
  function handleDuplicate(id: string) {
    const next = duplicatePage(doc, id);
    change(() => next);
    selectAfter(next, next.pages[doc.pages.findIndex((p) => p.id === id) + 1]?.id);
  }
  function handleRemove(id: string) {
    const next = removePage(doc, id);
    change(() => next);
    selectAfter(next);
  }

  // ------------------------------ Salvar ------------------------------------
  async function handleSave(): Promise<MarketingContentRow | null> {
    setSaving(true);
    try {
      const row = await apiSaveStudioContent({ id: contentId ?? undefined, document: doc, caption });
      setContentId(row.id);
      setDirty(false);
      toast.success("Rascunho salvo.");
      onSaved?.(row);
      return row;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        message === "studio_migration_pending"
          ? "O banco de dados ainda não foi atualizado para o Estúdio Criativo. Peça ao administrador para aplicar a atualização."
          : message === "studio_image_not_owned"
            ? "Uma das imagens não pertence mais ao acervo da empresa. Troque a imagem e tente de novo."
            : "Não foi possível salvar. Tente novamente.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  const properties = (
    <PropertiesPanel
      scene={scene}
      layout={layout}
      selected={selected}
      onSelect={setSelected}
      onChange={setLayout}
      onAnchor={(anchor: Anchor) => changePage((p) => ({ ...p, layout: applyAnchor(p.layout, anchor) }))}
      logo={logoManager}
      image={{
        sceneNumber: pageIndex + 1,
        noun: "página",
        editable: !!page.image,
        lockedHint: "Esta página ainda não tem imagem. Escolha uma na aba Mídia.",
        framing,
        onFraming: updateFraming,
      }}
    />
  );

  const tools: Array<{ id: Tool; label: string; icon: typeof Type; mobileOnly?: boolean }> = [
    { id: "templates", label: "Modelos", icon: LayoutTemplate },
    { id: "text", label: "Texto", icon: Type },
    { id: "colors", label: "Cores", icon: Palette },
    { id: "media", label: "Mídia", icon: Images },
    { id: "props", label: "Ajustes", icon: SlidersHorizontal, mobileOnly: true },
  ];
  const size = SCENE_FORMATS[doc.format];
  const formats = KIND_FORMATS[doc.kind].map((f) => [f, FORMAT_LABELS[f]] as const);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="creative-studio" data-kind={doc.kind}>
      <div data-studio-header className="flex shrink-0 items-center justify-between gap-x-3 border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            <span className="hidden sm:inline">Estúdio criativo · </span>
            {STUDIO_KINDS[doc.kind]}
          </div>
          <div className="hidden truncate text-xs text-muted-foreground sm:block">
            {multi ? `${doc.pages.length} páginas · ` : ""}modelo <b>{scene.label}</b>
            {dirty ? " · alterações não salvas" : " · salvo"}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Segmented label="Formato" options={formats} value={doc.format} onChange={(f) => change((cur) => setFormat(cur, f))} />
          <label className="hidden cursor-pointer select-none items-center gap-2 text-xs md:flex" title="Mostrar a área segura">
            <input type="checkbox" aria-label="Área segura" checked={showSafeArea} onChange={(e) => setShowSafeArea(e.target.checked)} className="accent-primary" />
            Área segura
          </label>
          <Button onClick={() => void handleSave()} disabled={saving || !dirty} variant="outline">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,50%)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,1.15fr)_minmax(250px,0.9fr)_minmax(290px,1fr)] lg:grid-rows-1">
        <Tabs value={tool} onValueChange={(v) => setTool(v as Tool)} className="order-2 flex min-h-0 min-w-0 flex-col border-t lg:order-1 lg:border-r lg:border-t-0">
          <TabsList className="h-auto w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none border-b bg-transparent p-1">
            {tools.map(({ id, label, icon: Icon, mobileOnly }) => (
              <TabsTrigger key={id} value={id} className={`flex-1 flex-col gap-0.5 px-1.5 py-1.5 text-[11px] ${mobileOnly ? "lg:hidden" : ""}`}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
            <TabsContent value="templates" className="mt-0 flex min-h-0 flex-1 flex-col gap-2">
              {multi && (
                <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>O modelo vale para a página {pageIndex + 1}.</span>
                  <Button size="sm" variant="ghost" className="h-7" onClick={templateToAll}>
                    Aplicar a todas
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <TemplatePanel
                  format={doc.format}
                  value={layout.template}
                  onChange={handleTemplate}
                  paletteFor={paletteFor}
                  imageUrl={stageUrl}
                  focalPoint={page.image ? framing : null}
                  logoUrl={logoUrl}
                  headline={page.text.headline}
                  subheadline={page.text.subheadline || null}
                  cta={page.text.cta || null}
                />
              </div>
            </TabsContent>
            <TabsContent value="text" className="mt-0 space-y-4">
              {multi && (
                <div>
                  <Label className="mb-1 block">Papel da página {pageIndex + 1}</Label>
                  <Segmented
                    label="Papel da página"
                    options={(Object.keys(PAGE_ROLES) as PageRole[]).map((r) => [r, PAGE_ROLES[r]] as const)}
                    value={page.role}
                    onChange={(role) => changePage((p) => ({ ...p, role }))}
                  />
                </div>
              )}
              <TabTexto
                headline={page.text.headline}
                subheadline={page.text.subheadline}
                cta={page.text.cta}
                onHeadline={setText("headline")}
                onSubheadline={setText("subheadline")}
                onCta={setText("cta")}
              />
              <div className="border-t pt-3">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="studio-caption">Legenda do post</Label>
                  <span className="text-[10px] text-muted-foreground">{caption.length}/2200</span>
                </div>
                <Textarea
                  id="studio-caption"
                  rows={4}
                  maxLength={2200}
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Texto que acompanha a publicação."
                />
              </div>
            </TabsContent>
            <TabsContent value="colors" className="mt-0">
              {multi && <p className="mb-2 text-xs text-muted-foreground">As cores valem para todas as páginas.</p>}
              <ColorsPanel
                mode={layout.colorMode ?? "template"}
                palette={palette}
                roles={usedColorRoles(scene)}
                hasBrand={!!brandPalette(brandColors, scene)}
                onMode={(mode) => setColors({ mode: mode === "brand" ? "brand" : "template" })}
                onTheme={(themeId) => setColors({ mode: "theme", themeId })}
                onColor={(role: ColorRole, value) => setColors({ mode: "custom", palette: { ...palette, [role]: value } })}
              />
            </TabsContent>
            <TabsContent value="media" className="mt-0 space-y-3">
              <div>
                <div className="text-sm font-semibold">Imagem da página {pageIndex + 1}</div>
                <p className="text-xs text-muted-foreground">Envie um arquivo ou escolha no acervo e nos produtos da empresa.</p>
              </div>
              <div className="flex items-center gap-3 rounded-md border p-2">
                {stageUrl ? (
                  <img src={stageUrl} alt="" className="h-16 w-16 shrink-0 rounded bg-muted object-contain" />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
                    <ImagePlus className="h-5 w-5" />
                  </span>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPicking(true)}>
                    <ImagePlus className="mr-1 h-4 w-4" /> {page.image ? "Trocar imagem" : "Escolher imagem"}
                  </Button>
                  {page.image && (
                    <Button size="sm" variant="ghost" onClick={() => changePage((p) => ({ ...p, image: null }))}>
                      <Trash2 className="mr-1 h-4 w-4" /> Remover
                    </Button>
                  )}
                </div>
              </div>
              {page.image && <p className="text-xs text-muted-foreground">Para ajustar o enquadramento, toque na foto da prévia.</p>}
            </TabsContent>
            <TabsContent value="props" className="mt-0 lg:hidden">
              {properties}
            </TabsContent>
          </div>
        </Tabs>

        <div className="order-1 min-h-0 min-w-0 bg-gradient-to-br from-muted/30 to-muted/60 p-2 lg:order-2">
          <div className="grid h-full w-full place-items-center" style={{ containerType: "size" }}>
            <div className="relative" style={{ width: `min(100cqw, calc(100cqh * ${size.width} / ${size.height}))` }}>
              <SceneRenderer
                format={doc.format}
                imageUrl={stageUrl}
                focalPoint={page.image ? framing : null}
                logoUrl={logoUrl}
                onRequestLogoUpload={brandLogo.canManage ? logoManager.onUpload : undefined}
                headline={page.text.headline}
                subheadline={page.text.subheadline || null}
                cta={page.text.cta || null}
                layout={layout}
                showSafeArea={showSafeArea}
                fill
                selected={selected}
                onSelect={handleSelect}
                onDragText={handleDragText}
              />
              {!page.image && (
                <div className="absolute inset-x-0 top-[30%] z-[28] flex justify-center px-3">
                  <Button size="sm" variant="secondary" className="shadow-lg" onClick={() => setPicking(true)}>
                    <ImagePlus className="mr-1 h-4 w-4" /> Escolher imagem
                  </Button>
                </div>
              )}
              {page.image && (stageLoading || stageError) && (
                <div className="pointer-events-none absolute inset-x-0 top-[38%] z-[28] flex justify-center px-3" role={stageError && !stageLoading ? "alert" : "status"}>
                  <div className="pointer-events-auto max-w-[92%] rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-white shadow-lg">
                    {stageLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando imagem…
                      </span>
                    ) : (
                      <>
                        <p>{MEDIA_ERROR_MESSAGE[stageError!]}</p>
                        <div className="mt-2 flex justify-center gap-2">
                          {stageError !== "not_found" && (
                            <Button size="sm" variant="secondary" className="h-7" onClick={() => void retryImage()}>
                              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Tentar novamente
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" className="h-7" onClick={() => setPicking(true)}>
                            Trocar imagem
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="order-3 hidden min-h-0 min-w-0 flex-col border-l lg:flex" aria-label="Propriedades">
          <div className="shrink-0 border-b px-3 py-2 text-sm font-semibold">Propriedades</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{properties}</div>
        </aside>
      </div>

      {/* Arte tem uma página só: a faixa não teria função. */}
      {multi && (
      <PageStrip
        pages={doc.pages}
        format={doc.format}
        selectedId={page.id}
        logoUrl={logoUrl}
        urlFor={urlFor}
        onSelect={setPageId}
        onAdd={multi && canAddPage(doc) ? handleAdd : undefined}
        onDuplicate={multi && canAddPage(doc) ? handleDuplicate : undefined}
        onRemove={multi && canRemovePage(doc) ? handleRemove : undefined}
        onMove={
          multi
            ? (id, delta) => {
                change((cur) => movePage(cur, id, delta));
              }
            : undefined
        }
      />
      )}

      <StudioMediaPicker open={picking} companyId={companyId} title={`Imagem da página ${pageIndex + 1}`} onClose={() => setPicking(false)} onPick={pickImage} />
    </div>
  );
}
