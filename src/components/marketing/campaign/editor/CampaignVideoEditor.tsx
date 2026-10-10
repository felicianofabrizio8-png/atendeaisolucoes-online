// ============================================================================
// CampaignVideoEditor — estúdio do Vídeo IA.
//
// Layout de estúdio que cabe na altura disponível (o pai define a altura; só
// os painéis internos rolam):
//   - esquerda: ferramentas (modelos, texto, cores, mídia, vídeo);
//   - centro:   prévia 9:16, com seleção e arraste direto dos elementos;
//   - direita:  propriedades do elemento selecionado;
//   - base:     timeline compacta com as cenas e a reprodução.
//
// Tudo que se edita aqui vira `VideoLayout` + textos + sequência de imagens +
// duração — exatamente o que `approveCampaignAndRender` persiste e o Render
// Engine consome. A prévia é desenhada pelo mesmo compositor do worker.
//
// A identidade visual vem do Brand Center da empresa logada (logo e cores);
// nada é fixo por cliente.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clapperboard, GalleryHorizontalEnd, Images, LayoutTemplate, Loader2, Palette, RotateCcw, SlidersHorizontal, Type } from "lucide-react";
import { toast } from "sonner";
import {
  apiApproveCampaignAndRender,
  apiRegenerateCampaignTexts,
  campaignMediaDeps,
  type FocalPointInput,
} from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import type {
  Anchor,
  ColorMode,
  ScenePalette,
  TemplateId,
  TransitionId,
  VideoLayout,
} from "@/lib/marketing/video-editor/layout.types";
import { DEFAULT_TEMPLATE } from "@/lib/marketing/video-editor/layout.types";
import type { ColorRole, SceneDefinition } from "@/lib/marketing/video-editor/scene.types";
import {
  DEFAULT_TRANSITION,
  OUTRO_SECONDS,
  getScene,
  normalizeFraming,
  normalizeLayout,
  outroSecondsOf,
  sceneDurations,
  transitionSeconds,
  type ImageFraming,
} from "@/lib/marketing/video-editor/scenes/registry";
import { brandPalette, fitPaletteToScene, themePalette, usedColorRoles } from "@/lib/marketing/video-editor/palette";
import { useBrandLogo } from "@/hooks/useBrandLogo";
import { MEDIA_ERROR_MESSAGE, resolveCampaignMedia, type MediaLoadError, type MediaResolverDeps } from "@/lib/marketing/campaign-media";
import { MAX_CAMPAIGN_IMAGES } from "@/lib/render-engine/render.types";
import { documentFromVideo, imageKey, toCarousel, type PageImageRef, type StudioDocument } from "@/lib/marketing/studio/document";
import { StudioMediaPicker } from "../../studio/StudioMediaPicker";
import { useImageLoadStatus } from "./useImageLoadStatus";
import { SceneRenderer, type SceneImageLayer, type ScenePart } from "./SceneRenderer";
import { TabTexto } from "./tabs/TabTexto";
import { ColorsPanel, MediaPanel, PropertiesPanel, TemplatePanel, VideoPanel, type LogoManager, type StudioScene } from "./StudioPanels";
import { StudioTimeline } from "./StudioTimeline";

export interface CampaignEditorImage {
  key: string;
  origin: "marketing" | "product";
  mediaId?: string;
  productId?: string;
  imagePath?: string;
  previewUrl: string | null;
  focalPoint: FocalPointInput | null;
  /** Por que a prévia desta imagem não pôde ser obtida (null = sem erro). */
  loadError?: MediaLoadError | null;
}

interface Props {
  campaignId: string;
  contents: MarketingContentRow[];
  previewImageUrl: string | null;
  /** Se fornecido, sobrescreve a logo do Brand Center. Default: usa hook. */
  logoUrl?: string | null;
  focalPoint?: FocalPointInput | null;
  imageSequence?: CampaignEditorImage[];
  onImageSequenceChange?: (items: CampaignEditorImage[]) => void;
  /** Pede um novo link para a imagem (quem abriu o editor sabe de onde ela vem). */
  onRetryImage?: (key: string) => Promise<void> | void;
  onApproved: (jobId: string) => void;
  onContentsUpdated?: (contents: MarketingContentRow[]) => void;
  /**
   * Empresa logada. Com ela (e uma sequência editável) o estúdio permite
   * adicionar e trocar imagens pelo acervo, sem recriar a publicação.
   */
  companyId?: string;
  /** Só para testes e para a página de validação visual. */
  mediaDeps?: MediaResolverDeps;
  /**
   * Abre um carrossel com as mesmas fotos, textos, modelo e cores deste vídeo.
   * O vídeo não é alterado.
   */
  onCreateCarousel?: (document: StudioDocument) => void;
}

const DEFAULT_DURATION = 15;

/** Reescala os tempos para que a cena `index` dure `seconds` e a soma continue `total`. */
export function retimeScene(durations: number[], index: number, seconds: number, total: number): number[] {
  const others = total - durations[index];
  const room = total - seconds;
  if (!(others > 0) || !(room > 0)) return durations;
  return durations.map((d, i) => Math.round((i === index ? seconds : (d / others) * room) * 10) / 10);
}

type Tool = "templates" | "text" | "colors" | "media" | "video" | "props";

/**
 * Layout salvo do conteúdo, já normalizado. `colorsResolved` indica que as
 * cores já estão definidas (salvas ou por tema da campanha) — senão o editor
 * aplica as cores da marca assim que o Brand Center responder.
 */
function readSavedLayout(row: MarketingContentRow | null | undefined): { layout: VideoLayout; colorsResolved: boolean } {
  const anyRow = row as unknown as {
    video_layout?: unknown;
    video_template?: string | null;
    ai_prompt?: unknown;
  } | null;
  const scene = getScene(anyRow?.video_template ?? DEFAULT_TEMPLATE);
  const layout = normalizeLayout(anyRow?.video_layout ?? scene.defaultLayout, scene);
  if (layout.colors) return { layout, colorsResolved: true };
  const prompt = anyRow?.ai_prompt;
  const themeId = prompt && typeof prompt === "object" ? (prompt as { theme?: unknown }).theme : null;
  const fromTheme = themePalette(typeof themeId === "string" ? themeId : null, scene);
  if (fromTheme) return { layout: { ...layout, colors: fromTheme, colorMode: "theme" }, colorsResolved: true };
  return { layout: { ...layout, colors: scene.palette, colorMode: "template" }, colorsResolved: false };
}

/** Estilos da imagem que sai e da que entra, para um progresso 0..1. */
function transitionStyles(type: TransitionId, p: number): { out: CSSProperties; into: CSSProperties } {
  switch (type) {
    case "fadeblack":
      return { out: { opacity: Math.max(0, 1 - 2 * p) }, into: { opacity: Math.max(0, 2 * p - 1) } };
    case "slideleft":
      return { out: { transform: `translateX(${-p * 100}%)` }, into: { transform: `translateX(${(1 - p) * 100}%)` } };
    case "slideup":
      return { out: { transform: `translateY(${-p * 100}%)` }, into: { transform: `translateY(${(1 - p) * 100}%)` } };
    case "wipeleft":
      return { out: {}, into: { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` } };
    case "circleopen":
      return { out: {}, into: { clipPath: `circle(${p * 75}% at 50% 50%)` } };
    default:
      return { out: {}, into: { opacity: p } };
  }
}

export function CampaignVideoEditor({
  campaignId,
  contents,
  previewImageUrl,
  logoUrl: logoUrlOverride,
  focalPoint,
  imageSequence = [],
  onImageSequenceChange,
  onRetryImage,
  onApproved,
  onContentsUpdated,
  companyId,
  mediaDeps = campaignMediaDeps,
  onCreateCarousel,
}: Props) {
  const feedRow = useMemo(
    () => contents.find((c) => c.campaign_role === "feed") ?? contents[0] ?? null,
    [contents],
  );

  const [headline, setHeadline] = useState(feedRow?.overlay_headline ?? "");
  const [subheadline, setSubheadline] = useState(feedRow?.overlay_subheadline ?? "");
  const [cta, setCta] = useState(feedRow?.overlay_cta ?? "");

  const saved = useMemo(() => readSavedLayout(feedRow), [feedRow]);
  const [layout, setLayout] = useState<VideoLayout>(saved.layout);
  const colorsResolved = useRef(saved.colorsResolved);
  const scene = getScene(layout.template);

  const savedDuration = Number(feedRow?.duration_seconds ?? DEFAULT_DURATION) || DEFAULT_DURATION;
  const [duration, setDuration] = useState(savedDuration);

  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [tool, setTool] = useState<Tool>("templates");
  const [selected, setSelected] = useState<ScenePart>("title");
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  // Logo e cores da marca da empresa logada (Brand Center).
  const brandLogo = useBrandLogo();
  const effectiveLogoUrl = logoUrlOverride !== undefined ? logoUrlOverride : brandLogo.logoUrl;
  const brandColors = brandLogo.brandColors;

  useEffect(() => {
    if (!feedRow) return;
    setHeadline(feedRow.overlay_headline ?? "");
    setSubheadline(feedRow.overlay_subheadline ?? "");
    setCta(feedRow.overlay_cta ?? "");
  }, [feedRow]);

  // Conteúdo sem cores definidas abre com a identidade da empresa.
  useEffect(() => {
    if (colorsResolved.current || !brandColors) return;
    colorsResolved.current = true;
    setLayout((cur) => {
      const colors = brandPalette(brandColors, getScene(cur.template));
      return colors ? { ...cur, colors, colorMode: "brand" } : cur;
    });
  }, [brandColors]);

  // ------------------------------ Cenas (imagens) ---------------------------
  const scenes: StudioScene[] = useMemo(
    () =>
      imageSequence.length > 0
        ? imageSequence.map((item, index) => ({
            key: item.key,
            // A primeira cena é a imagem principal; `previewImageUrl` é o mesmo arquivo.
            url: item.previewUrl ?? (index === 0 ? previewImageUrl : null),
            focalPoint: item.focalPoint,
            loadError: item.loadError ?? null,
          }))
        : [{ key: "single", url: previewImageUrl, focalPoint: focalPoint ?? null, loadError: null }],
    [imageSequence, previewImageUrl, focalPoint],
  );
  const sequenceEditable = imageSequence.length > 0 && !!onImageSequenceChange;
  const currentIndex = Math.min(sceneIndex, scenes.length - 1);
  // Tempo de cada cena: a mesma conta do worker (iguais, se nada foi definido).
  const durations = useMemo(() => sceneDurations(duration, scenes.length, layout.sceneSeconds), [duration, scenes.length, layout.sceneSeconds]);
  const starts = useMemo(() => durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0)), [durations]);
  const customTimes = Array.isArray(layout.sceneSeconds) && layout.sceneSeconds.length === scenes.length;
  const sceneAt = useCallback(
    (t: number) => {
      let index = 0;
      for (let i = 0; i < starts.length; i++) if (t >= starts[i]) index = i;
      return index;
    },
    [starts],
  );
  /** Aplica a mesma mudança da sequência de imagens aos tempos definidos. */
  function editTimes(change: (seconds: number[]) => number[]) {
    setLayout((cur) => {
      if (!Array.isArray(cur.sceneSeconds) || cur.sceneSeconds.length !== imageSequence.length) {
        const { sceneSeconds: _drop, ...rest } = cur;
        return rest;
      }
      return { ...cur, sceneSeconds: change([...cur.sceneSeconds]) };
    });
  }

  // Situação da imagem em exibição: link ausente, carregando, erro ou pronta.
  const [imageAttempt, setImageAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const stageScene = scenes[currentIndex];
  const imageStatus = useImageLoadStatus(stageScene.url, imageAttempt);
  const stageError: MediaLoadError | null = !stageScene.url
    ? stageScene.loadError ?? "not_found"
    : imageStatus === "timeout"
      ? "timeout"
      : imageStatus === "error"
        ? "image_failed"
        : null;
  const stageLoading = retrying || (!!stageScene.url && imageStatus === "loading");

  async function retryImage() {
    setRetrying(true);
    try {
      // Novo link (o anterior pode ter expirado) e nova tentativa de abrir a imagem.
      await onRetryImage?.(stageScene.key);
    } finally {
      setRetrying(false);
      setImageAttempt((n) => n + 1);
    }
  }

  // A primeira cena é a capa; mover outra para o início troca a capa.
  function moveScene(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= imageSequence.length) return;
    const next = [...imageSequence];
    [next[index], next[target]] = [next[target], next[index]];
    onImageSequenceChange?.(next);
    // O tempo acompanha a cena.
    editTimes((s) => {
      [s[index], s[target]] = [s[target], s[index]];
      return s;
    });
    setSceneIndex(target);
  }
  function removeScene(index: number) {
    // O vídeo precisa de pelo menos uma imagem.
    if (imageSequence.length < 2) return;
    onImageSequenceChange?.(imageSequence.filter((_, i) => i !== index));
    editTimes((s) => s.filter((_, i) => i !== index));
    setSceneIndex((cur) => Math.max(0, Math.min(cur, imageSequence.length - 2)));
  }

  // Adicionar / trocar imagem pelo acervo da empresa.
  const canPickMedia = sequenceEditable && !!companyId;
  const canAddScene = canPickMedia && imageSequence.length < MAX_CAMPAIGN_IMAGES;
  const [picking, setPicking] = useState<{ mode: "add" } | { mode: "replace"; index: number } | null>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const latestSequence = useRef(imageSequence);
  latestSequence.current = imageSequence;

  async function handlePick(image: PageImageRef) {
    const target = picking;
    setPicking(null);
    if (!target || !onImageSequenceChange) return;
    setPickBusy(true);
    try {
      // A mesma imagem pode aparecer em duas cenas: a chave precisa ser única.
      const base = imageKey(image);
      const taken = new Set(latestSequence.current.map((item) => item.key));
      let key = base;
      for (let n = 2; taken.has(key); n++) key = `${base}#${n}`;
      const resolved = await resolveCampaignMedia(
        [image.origin === "marketing" ? { key, origin: image.origin, mediaId: image.mediaId } : { key, origin: image.origin, imagePath: image.imagePath }],
        mediaDeps,
      );
      const item: CampaignEditorImage = {
        key,
        origin: image.origin,
        ...(image.origin === "marketing" ? { mediaId: image.mediaId } : { productId: image.productId, imagePath: image.imagePath }),
        previewUrl: resolved[key]?.previewUrl ?? null,
        loadError: resolved[key]?.error ?? null,
        // Imagem nova começa no enquadramento padrão (inteira).
        focalPoint: null,
      };
      const current = latestSequence.current;
      if (target.mode === "add") {
        if (current.length >= MAX_CAMPAIGN_IMAGES) return;
        onImageSequenceChange([...current, item]);
        // A cena nova entra com o tempo médio das que já existem.
        editTimes((s) => [...s, Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10]);
        setPlaying(false);
        setSceneIndex(current.length);
      } else {
        onImageSequenceChange(current.map((existing, i) => (i === target.index ? item : existing)));
      }
    } finally {
      setPickBusy(false);
    }
  }

  // ------------------------------ Reprodução --------------------------------
  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - time * 1000;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const t = (now - startedAt) / 1000;
      if (t >= duration) {
        setPlaying(false);
        setTime(0);
        return;
      }
      // ~30 quadros por segundo bastam para a prévia.
      if (now - last > 32) {
        last = now;
        setTime(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `time` só define o ponto de partida ao iniciar a reprodução.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  function selectScene(index: number) {
    setPlaying(false);
    setSceneIndex(index);
    setTime(starts[index] ?? 0);
  }

  const transition = layout.transition ?? DEFAULT_TRANSITION;
  const imageLayers: SceneImageLayer[] = useMemo(() => {
    // Mesma conta do worker: a transição ocupa o fim de cada cena.
    const xfade = transitionSeconds(durations);
    const index = playing ? sceneAt(time) : currentIndex;
    const next = playing && index + 1 < scenes.length ? scenes[index + 1] : null;
    const start = (starts[index + 1] ?? duration) - xfade;
    const progress = next && time >= start ? Math.min(1, (time - start) / xfade) : 0;
    const styles = transitionStyles(transition, progress);
    const layer = (sc: StudioScene, style: CSSProperties, key: string): SceneImageLayer => ({ key, url: sc.url, focalPoint: sc.focalPoint, style });
    const out = [layer(scenes[index], progress > 0 ? styles.out : {}, `out-${scenes[index].key}`)];
    if (next && progress > 0) out.push(layer(next, styles.into, `in-${next.key}`));
    return out;
  }, [scenes, durations, starts, duration, sceneAt, playing, time, currentIndex, transition]);

  // ------------------------------ Enquadramento -----------------------------
  // Sem nada salvo, vale o padrão seguro do modelo: imagem inteira ("conter").
  const framingDefaults = useMemo(() => ({ fit: "contain" as const, fill: scene.image.fill }), [scene.image.fill]);
  const stageFraming: ImageFraming = normalizeFraming(scenes[currentIndex].focalPoint, framingDefaults);

  function updateFraming(patch: Partial<ImageFraming> | null) {
    const target = imageSequence[currentIndex];
    if (!target || !onImageSequenceChange) return;
    // null = voltar ao padrão do modelo (nada salvo).
    const next = patch === null ? null : { ...normalizeFraming(target.focalPoint, framingDefaults), ...patch };
    onImageSequenceChange(imageSequence.map((item) => (item.key === target.key ? { ...item, focalPoint: next } : item)));
  }

  // ------------------------------ Textos ------------------------------------
  const originalHeadline = feedRow?.overlay_original_headline ?? headline;
  const originalSub = feedRow?.overlay_original_subheadline ?? subheadline;
  const originalCta = feedRow?.overlay_original_cta ?? cta;

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await apiRegenerateCampaignTexts({ campaign_id: campaignId });
      const fresh = (res.contents ?? []) as MarketingContentRow[];
      onContentsUpdated?.(fresh);
      toast.success("Nova sugestão de texto gerada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar nova sugestão.");
    } finally {
      setRegenerating(false);
    }
  }

  function handleRestore() {
    setHeadline(originalHeadline ?? "");
    setSubheadline(originalSub ?? "");
    setCta(originalCta ?? "");
    toast.info("Sugestão original restaurada.");
  }

  // ------------------------------ Modelo e cores ----------------------------
  const paletteFor = useCallback(
    (target: SceneDefinition): ScenePalette => {
      if (layout.colorMode === "brand") return brandPalette(brandColors, target) ?? target.palette;
      if (layout.colorMode === "template" || !layout.colors) return target.palette;
      return fitPaletteToScene(layout.colors, target);
    },
    [layout.colorMode, layout.colors, brandColors],
  );

  const handleTemplateChange = useCallback(
    (id: TemplateId) => {
      const next = getScene(id);
      colorsResolved.current = true;
      setLayout((cur) => ({
        ...next.defaultLayout,
        template: id,
        colors: paletteFor(next),
        colorMode: cur.colorMode,
        transition: cur.transition,
      }));
      toast.info(`Modelo “${next.label}” aplicado.`);
    },
    [paletteFor],
  );

  function setColors(colors: ScenePalette, colorMode: ColorMode) {
    colorsResolved.current = true;
    setLayout((cur) => ({ ...cur, colors, colorMode }));
  }
  const palette = fitPaletteToScene(layout.colors ?? scene.palette, scene);

  function handleAnchor(anchor: Anchor) {
    setLayout((cur) => {
      // Texto e logo na mesma borda se sobrepõem: a logo vai para a borda oposta.
      const collides = anchor !== "center" && cur.logo.vAnchor === anchor;
      return {
        ...cur,
        title: { ...cur.title, vAnchor: anchor },
        subtitle: { ...cur.subtitle, vAnchor: anchor },
        cta: { ...cur.cta, vAnchor: anchor },
        offsetY: 0,
        logo: collides ? { ...cur.logo, vAnchor: anchor === "top" ? "bottom" : "top" } : cur.logo,
      };
    });
  }

  // Deslocamento do texto no início do arraste; o gesto informa o delta total.
  const dragBase = useRef<{ x: number; y: number } | null>(null);
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const handleDragText = useCallback((dx: number, dy: number, phase: "move" | "end") => {
    const base = (dragBase.current ??= { x: latestLayout.current.offsetX ?? 0, y: latestLayout.current.offsetY ?? 0 });
    if (phase === "end") dragBase.current = null;
    const clamp = (v: number) => Math.round(Math.max(-50, Math.min(50, v)) * 2) / 2;
    setLayout((cur) => ({ ...cur, offsetX: clamp(base.x + dx), offsetY: clamp(base.y + dy) }));
  }, []);

  const handleSelect = useCallback((part: ScenePart) => {
    setSelected(part);
    // No celular as propriedades ficam em uma aba; no desktop, na coluna direita.
    if (typeof window !== "undefined" && !window.matchMedia?.("(min-width: 1024px)").matches) setTool("props");
  }, []);

  // ------------------------------ Gerar vídeo -------------------------------
  async function handleApprove() {
    if (!headline.trim()) {
      toast.error("O título é obrigatório.");
      setTool("text");
      return;
    }
    setApproving(true);
    try {
      const res = await apiApproveCampaignAndRender({
        campaign_id: campaignId,
        headline: headline.trim(),
        subheadline: subheadline.trim() ? subheadline.trim() : null,
        cta: cta.trim() ? cta.trim() : null,
        layout: { ...layout, colors: palette } as unknown as Record<string, unknown>,
        template: layout.template,
        images: imageSequence.length > 0 ? imageSequence.map((item) => item.origin === "marketing" ? { origin: "marketing" as const, media_id: item.mediaId!, focal_point: normalizeFraming(item.focalPoint, framingDefaults) } : { origin: "product" as const, product_id: item.productId!, image_path: item.imagePath!, focal_point: normalizeFraming(item.focalPoint, framingDefaults) }) : undefined,
        // Só envia a duração quando o usuário mudou — evita revalidar o áudio à toa.
        ...(duration !== savedDuration ? { duration_seconds: duration } : {}),
      });
      toast.success("Aprovado! Iniciando renderização…");
      onApproved(res.job_id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao aprovar.";
      toast.error(
        message.startsWith("campaign_image_sequence_invalid") || message === "campaign_image_sequence_persist_failed"
          ? "Não foi possível salvar o enquadramento das imagens. Revise a campanha e tente novamente."
          : message === "audio_slice_exceeds_duration"
            ? "A música escolhida é mais curta que essa duração. Escolha uma duração menor."
            : message,
      );
      if (message === "audio_slice_exceeds_duration") setTool("video");
    } finally {
      setApproving(false);
    }
  }

  function handleCreateCarousel() {
    if (!onCreateCarousel) return;
    const video = documentFromVideo({
      layout: { ...layout, colors: palette },
      text: { headline: headline.trim(), subheadline: subheadline.trim(), cta: cta.trim() },
      scenes: imageSequence.flatMap((item) => {
        const image: PageImageRef | null =
          item.origin === "marketing" && item.mediaId
            ? { origin: "marketing", mediaId: item.mediaId }
            : item.origin === "product" && item.productId && item.imagePath
              ? { origin: "product", productId: item.productId, imagePath: item.imagePath }
              : null;
        return image ? [{ image, framing: item.focalPoint ? normalizeFraming(item.focalPoint, framingDefaults) : null }] : [];
      }),
    });
    onCreateCarousel(toCarousel(video));
  }

  // A logo é a do cadastro de marca da empresa: trocar/remover aqui altera o
  // cadastro (o servidor exige administrador), e é dele que o vídeo a lê.
  const logoManager: LogoManager = {
    url: effectiveLogoUrl,
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

  const properties = (
    <PropertiesPanel
      scene={scene}
      layout={layout}
      selected={selected}
      onSelect={setSelected}
      onChange={setLayout}
      onAnchor={handleAnchor}
      logo={logoManager}
      image={{ sceneNumber: currentIndex + 1, editable: sequenceEditable, framing: stageFraming, onFraming: updateFraming }}
    />
  );

  const tools: Array<{ id: Tool; label: string; icon: typeof Type; mobileOnly?: boolean }> = [
    { id: "templates", label: "Modelos", icon: LayoutTemplate },
    { id: "text", label: "Texto", icon: Type },
    { id: "colors", label: "Cores", icon: Palette },
    { id: "media", label: "Mídia", icon: Images },
    { id: "video", label: "Vídeo", icon: Clapperboard },
    { id: "props", label: "Ajustes", icon: SlidersHorizontal, mobileOnly: true },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="video-studio">
      {/* Cabeçalho */}
      <div data-studio-header className="flex shrink-0 items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Estúdio de vídeo</div>
          <div className="hidden truncate text-xs text-muted-foreground sm:block">
            Modelo <b>{scene.label}</b> · o vídeo só é criado ao clicar em Gerar vídeo.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs" title="Mostrar a área segura">
            <input type="checkbox" aria-label="Área segura" checked={showSafeArea} onChange={(e) => setShowSafeArea(e.target.checked)} className="accent-primary" />
            <span className="hidden sm:inline">Área segura</span>
          </label>
          {onCreateCarousel && imageSequence.length > 0 && (
            <Button variant="outline" onClick={handleCreateCarousel} disabled={approving} aria-label="Criar carrossel" title="Abre um carrossel com as mesmas fotos, textos e cores. O vídeo não muda.">
              <GalleryHorizontalEnd className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Criar carrossel</span>
            </Button>
          )}
          <Button onClick={handleApprove} disabled={approving || regenerating || !headline.trim()}>
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Gerar vídeo
          </Button>
        </div>
      </div>

      {/* Corpo: ferramentas · prévia · propriedades */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,50%)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,1.15fr)_minmax(250px,0.9fr)_minmax(290px,1fr)] lg:grid-rows-1">
        <Tabs
          value={tool}
          onValueChange={(v) => setTool(v as Tool)}
          className="order-2 flex min-h-0 min-w-0 flex-col border-t lg:order-1 lg:border-r lg:border-t-0"
        >
          <TabsList className="h-auto w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none border-b bg-transparent p-1">
            {tools.map(({ id, label, icon: Icon, mobileOnly }) => (
              <TabsTrigger key={id} value={id} className={`flex-1 flex-col gap-0.5 px-1.5 py-1.5 text-[11px] ${mobileOnly ? "lg:hidden" : ""}`}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
            <TabsContent value="templates" className="mt-0 min-h-0 flex-1">
              <TemplatePanel
                value={layout.template}
                onChange={handleTemplateChange}
                paletteFor={paletteFor}
                imageUrl={scenes[0].url}
                focalPoint={scenes[0].focalPoint}
                logoUrl={effectiveLogoUrl}
                headline={headline}
                subheadline={subheadline || null}
                cta={cta || null}
              />
            </TabsContent>
            <TabsContent value="text" className="mt-0">
              <TabTexto
                headline={headline}
                subheadline={subheadline}
                cta={cta}
                onHeadline={setHeadline}
                onSubheadline={setSubheadline}
                onCta={setCta}
                onRegenerate={handleRegenerate}
                onRestore={handleRestore}
                regenerating={regenerating}
                disabled={approving}
              />
            </TabsContent>
            <TabsContent value="colors" className="mt-0">
              <ColorsPanel
                mode={layout.colorMode ?? "template"}
                palette={palette}
                roles={usedColorRoles(scene)}
                hasBrand={!!brandPalette(brandColors, scene)}
                onMode={(mode) => setColors(mode === "brand" ? brandPalette(brandColors, scene) ?? scene.palette : scene.palette, mode)}
                onTheme={(id) => {
                  const next = themePalette(id, scene);
                  if (next) setColors(next, "theme");
                }}
                onColor={(role: ColorRole, value) => setColors({ ...palette, [role]: value }, "custom")}
              />
            </TabsContent>
            <TabsContent value="media" className="mt-0">
              <MediaPanel
                scenes={scenes}
                selectedIndex={currentIndex}
                editable={sequenceEditable}
                secondsPerScene={customTimes ? null : duration / scenes.length}
                onSelect={selectScene}
                onMove={moveScene}
                onRemove={removeScene}
                onAdd={canAddScene ? () => setPicking({ mode: "add" }) : undefined}
                onReplace={canPickMedia ? (index) => setPicking({ mode: "replace", index }) : undefined}
                busy={pickBusy}
                maxScenes={MAX_CAMPAIGN_IMAGES}
              />
            </TabsContent>
            <TabsContent value="video" className="mt-0">
              <VideoPanel
                duration={duration}
                onDuration={(d) => {
                  setPlaying(false);
                  setTime(0);
                  setDuration(d);
                }}
                transition={transition}
                onTransition={(t) => setLayout((cur) => ({ ...cur, transition: t }))}
                sceneCount={scenes.length}
                sceneSeconds={durations}
                customTimes={customTimes}
                onSceneSeconds={(index, seconds) => {
                  setPlaying(false);
                  setLayout((cur) => ({ ...cur, sceneSeconds: retimeScene(sceneDurations(duration, scenes.length, cur.sceneSeconds), index, seconds, duration) }));
                }}
                onEqualTimes={() =>
                  setLayout((cur) => {
                    const { sceneSeconds: _drop, ...rest } = cur;
                    return rest;
                  })
                }
                outro={{
                  // Sem marca publicada nem logo, o vídeo não tem tela final.
                  available: !!(brandColors || effectiveLogoUrl),
                  enabled: layout.outro?.enabled !== false,
                  seconds: layout.outro?.seconds ?? OUTRO_SECONDS.default,
                }}
                onOutro={(patch) =>
                  setLayout((cur) => ({ ...cur, outro: { enabled: cur.outro?.enabled !== false, seconds: cur.outro?.seconds ?? OUTRO_SECONDS.default, ...patch } }))
                }
              />
            </TabsContent>
            <TabsContent value="props" className="mt-0 lg:hidden">
              {properties}
            </TabsContent>
          </div>
        </Tabs>

        {/* Prévia 9:16 — ocupa a altura disponível, sem rolagem */}
        <div className="order-1 min-h-0 min-w-0 bg-gradient-to-br from-muted/30 to-muted/60 p-2 lg:order-2">
          <div className="grid h-full w-full place-items-center" style={{ containerType: "size" }}>
            <div className="relative" style={{ width: "min(100cqw, calc(100cqh * 9 / 16))" }}>
              <SceneRenderer
                imageUrl={scenes[currentIndex].url}
                focalPoint={scenes[currentIndex].focalPoint}
                imageLayers={imageLayers}
                logoUrl={effectiveLogoUrl}
                onRequestLogoUpload={brandLogo.canManage ? logoManager.onUpload : undefined}
                headline={headline}
                subheadline={subheadline || null}
                cta={cta || null}
                layout={layout}
                showSafeArea={showSafeArea}
                fill
                selected={selected}
                onSelect={handleSelect}
                onDragText={handleDragText}
              />
              {!playing && (stageLoading || stageError) && (
                <div
                  className="pointer-events-none absolute inset-x-0 top-[38%] z-[28] flex justify-center px-3"
                  role={stageError && !stageLoading ? "alert" : "status"}
                >
                  <div className="pointer-events-auto max-w-[92%] rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-white shadow-lg">
                    {stageLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando imagem…
                      </span>
                    ) : (
                      <>
                        <p>{MEDIA_ERROR_MESSAGE[stageError!]}</p>
                        {stageError !== "not_found" && (
                          <Button size="sm" variant="secondary" className="mt-2 h-7" onClick={() => void retryImage()}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Tentar novamente
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Propriedades do elemento selecionado (desktop) */}
        <aside className="order-3 hidden min-h-0 min-w-0 flex-col border-l lg:flex" aria-label="Propriedades">
          <div className="shrink-0 border-b px-3 py-2 text-sm font-semibold">Propriedades</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{properties}</div>
        </aside>
      </div>

      <StudioTimeline
        scenes={scenes}
        duration={duration}
        time={time}
        playing={playing}
        durations={durations}
        selectedIndex={playing ? sceneAt(time) : currentIndex}
        transition={transition}
        outroSeconds={brandColors || effectiveLogoUrl ? outroSecondsOf(layout) : 0}
        onTogglePlay={() => setPlaying((cur) => !cur)}
        onSelectScene={selectScene}
      />

      {canPickMedia && (
        <StudioMediaPicker
          open={!!picking}
          companyId={companyId!}
          title={picking?.mode === "replace" ? `Trocar a imagem da cena ${picking.index + 1}` : "Adicionar uma cena"}
          onClose={() => setPicking(null)}
          onPick={(image) => void handlePick(image)}
        />
      )}
    </div>
  );
}
