// ============================================================================
// Painéis do estúdio do Vídeo IA: modelos, cores, mídia, vídeo e propriedades.
// Todo controle aqui altera `VideoLayout` (ou a sequência de imagens / duração)
// — os mesmos dados que a prévia desenha e que o Render Engine recebe.
// ============================================================================

import { memo, useEffect, useRef, useState } from "react";
import { validateLogoFile } from "@/lib/brand-center/brand-logo-upload";
import { ArrowDown, ArrowUp, Check, ImageIcon, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type {
  Align,
  Anchor,
  ColorMode,
  FontId,
  ScenePalette,
  TemplateId,
  TextLayout,
  TransitionId,
  VideoLayout,
} from "@/lib/marketing/video-editor/layout.types";
import type { ColorRole, SceneDefinition, ScenePurpose } from "@/lib/marketing/video-editor/scene.types";
import {
  FONTS,
  FONT_IDS,
  SCENE_PURPOSES,
  type ImageFraming,
  SCENE_LIST,
  TRANSITIONS,
} from "@/lib/marketing/video-editor/scenes/registry";
import { THEME_PRESETS } from "@/lib/marketing/video-editor/theme-presets";
import { RENDER_DURATIONS } from "@/lib/render-engine/render.types";
import type { FocalPointInput } from "@/data/marketingRepo";
import type { MediaLoadError } from "@/lib/marketing/campaign-media";
import { SceneRenderer, type ScenePart } from "./SceneRenderer";
import { TabLogo } from "./tabs/TabLogo";

// ------------------------------ Peças comuns --------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === value}
          onClick={() => onChange(id)}
          className={`px-2.5 py-1 text-xs ${
            id === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground">{format(value)}</span>
      </div>
      <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function PanelTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-sm font-semibold">{children}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ------------------------------ Modelos -------------------------------------

interface TemplatePanelProps {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
  /** Paleta que cada miniatura deve mostrar (a mesma que será aplicada). */
  paletteFor: (scene: SceneDefinition) => ScenePalette;
  imageUrl: string | null;
  focalPoint: FocalPointInput | null;
  logoUrl: string | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
}

const GRID_GAP = 6;
const GRID_LABEL_H = 15;
const GRID_MIN_CELL = 46;
const GRID_MAX_CELL = 132;
const GRID_SCROLL_CELL = 64;

/**
 * Colunas e largura das miniaturas para caber `count` modelos na área
 * disponível SEM rolagem, usando a maior miniatura possível. Se nem a menor
 * miniatura legível couber (painel baixo, ex.: celular), devolve uma grade
 * confortável e a lista rola.
 */
export function fitTemplateGrid(width: number, height: number, count: number): { columns: number; cell: number; fits: boolean } {
  const cellFor = (columns: number) => Math.min(GRID_MAX_CELL, Math.floor((width - GRID_GAP * (columns - 1)) / columns));
  if (width > 0 && height > 0 && count > 0) {
    for (let columns = 1; columns <= count; columns++) {
      const cell = cellFor(columns);
      if (cell < GRID_MIN_CELL) break;
      const rows = Math.ceil(count / columns);
      const total = rows * ((cell * 16) / 9 + GRID_LABEL_H) + GRID_GAP * (rows - 1);
      if (total <= height) return { columns, cell, fits: true };
    }
  }
  const columns = Math.max(2, Math.floor((Math.max(width, 0) + GRID_GAP) / (GRID_SCROLL_CELL + GRID_GAP)) || 4);
  return { columns, cell: width > 0 ? Math.max(GRID_MIN_CELL, cellFor(columns)) : GRID_SCROLL_CELL, fits: false };
}

export const TemplatePanel = memo(function TemplatePanel({
  value,
  onChange,
  paletteFor,
  imageUrl,
  focalPoint,
  logoUrl,
  headline,
  subheadline,
  cta,
}: TemplatePanelProps) {
  // Modelos organizados pela finalidade comercial (um modelo pode servir a mais de uma).
  const [category, setCategory] = useState<ScenePurpose | "all">("all");
  const scenes = category === "all" ? SCENE_LIST : SCENE_LIST.filter((s) => s.purposes.includes(category));
  const categories: Array<readonly [ScenePurpose | "all", string]> = [
    ["all", `Todos (${SCENE_LIST.length})`],
    ...(Object.entries(SCENE_PURPOSES) as Array<[ScenePurpose, string]>),
  ];

  // Mede a área livre do painel para escolher o tamanho das miniaturas.
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const grid = fitTemplateGrid(area.width, area.height, scenes.length);
  const current = SCENE_LIST.find((s) => s.id === value);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 space-y-1.5">
        <Segmented label="Finalidade do vídeo" options={categories} value={category} onChange={setCategory} />
        {current && (
          <p className="truncate text-xs text-muted-foreground">
            <b className="text-foreground">{current.label}</b> · {current.description}
          </p>
        )}
      </div>
      <div ref={areaRef} className="min-h-0 flex-1" data-fits={grid.fits}>
        <div
          className="grid justify-center"
          style={{ gridTemplateColumns: `repeat(${grid.columns}, ${grid.cell}px)`, gap: GRID_GAP }}
          data-testid="template-grid"
        >
          {scenes.map((scene) => {
            const active = value === scene.id;
            return (
              <button
                key={scene.id}
                type="button"
                aria-pressed={active}
                title={`${scene.label} — ${scene.description}`}
                onClick={() => onChange(scene.id)}
                className={`relative min-w-0 rounded-md text-left outline-offset-1 transition ${
                  active ? "outline outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-primary/60"
                }`}
              >
                {active && (
                  <span className="absolute right-0.5 top-0.5 z-30 grid h-3.5 w-3.5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
                <SceneRenderer
                  compact
                  imageUrl={imageUrl}
                  focalPoint={focalPoint}
                  logoUrl={logoUrl}
                  headline={headline || "Título do vídeo"}
                  subheadline={subheadline}
                  cta={cta}
                  layout={{ ...scene.defaultLayout, colors: paletteFor(scene) }}
                />
                <div className="truncate text-center text-[10px] font-medium" style={{ lineHeight: `${GRID_LABEL_H}px` }}>
                  {scene.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ------------------------------ Cores ---------------------------------------

const ROLE_LABEL: Record<ColorRole, string> = {
  background: "Painel / fundo",
  overlay: "Sombra sobre a foto",
  accent: "Destaque",
  text: "Texto",
  cta: "Botão",
  ctaText: "Texto do botão",
};

interface ColorsPanelProps {
  mode: ColorMode;
  palette: ScenePalette;
  roles: ColorRole[];
  hasBrand: boolean;
  onMode: (mode: "brand" | "template") => void;
  onTheme: (themeId: string) => void;
  onColor: (role: ColorRole, value: string) => void;
}

export function ColorsPanel({ mode, palette, roles, hasBrand, onMode, onTheme, onColor }: ColorsPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <PanelTitle hint="As cores valem para a prévia e para o vídeo gerado.">Origem das cores</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mode === "brand" ? "default" : "outline"} disabled={!hasBrand} onClick={() => onMode("brand")}>
            Cores da marca
          </Button>
          <Button size="sm" variant={mode === "template" ? "default" : "outline"} onClick={() => onMode("template")}>
            Cores do modelo
          </Button>
        </div>
        {!hasBrand && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sua empresa ainda não publicou cores no Brand Center; por isso o modelo usa as cores dele.
          </p>
        )}
      </div>

      <div>
        <PanelTitle>Paletas prontas</PanelTitle>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTheme(t.id)}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:border-primary/60"
            >
              <span className="flex shrink-0 overflow-hidden rounded-full border">
                <span className="h-4 w-3" style={{ background: t.colors.primary }} />
                <span className="h-4 w-3" style={{ background: t.colors.accent }} />
              </span>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <PanelTitle hint={mode === "custom" ? "Paleta personalizada." : undefined}>Ajuste fino</PanelTitle>
        <div className="space-y-2">
          {roles.map((role) => (
            <label key={role} className="flex items-center justify-between gap-3 text-sm">
              <span>{ROLE_LABEL[role]}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{palette[role]}</span>
                <input
                  type="color"
                  aria-label={ROLE_LABEL[role]}
                  value={palette[role].toLowerCase()}
                  onChange={(e) => onColor(role, e.target.value.toUpperCase())}
                  className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5"
                />
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Se o texto ficar ilegível sobre o fundo escolhido, ele é trocado por preto ou branco — igual ao vídeo.
        </p>
      </div>
    </div>
  );
}

// ------------------------------ Mídia ---------------------------------------

export interface StudioScene {
  key: string;
  url: string | null;
  focalPoint: FocalPointInput | null;
  loadError?: MediaLoadError | null;
}

interface MediaPanelProps {
  scenes: StudioScene[];
  selectedIndex: number;
  /** Sem isto, a sequência não é editável neste fluxo. */
  editable: boolean;
  secondsPerScene: number;
  /** Enquadramento efetivo da cena selecionada (já com o padrão do modelo). */
  framing: ImageFraming;
  /** O modelo pinta a sobra com a cor dele (ex.: produto em fundo chapado). */
  onFraming: (patch: Partial<ImageFraming> | null) => void;
  onSelect: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
}

const FITS = [
  ["contain", "Imagem inteira"],
  ["cover", "Preencher"],
] as const;
const FILLS = [
  ["blur", "Desfoque da foto"],
  ["color", "Cor do modelo"],
] as const;

export function MediaPanel({ scenes, selectedIndex, editable, secondsPerScene, framing, onFraming, onSelect, onMove, onRemove }: MediaPanelProps) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="space-y-3">
      <PanelTitle hint={`Cada imagem é uma cena. O tempo é dividido igualmente: ${secondsPerScene.toFixed(1)} s por cena.`}>
        Cenas do vídeo
      </PanelTitle>
      <ul className="space-y-2">
        {scenes.map((scene, i) => (
          <li
            key={scene.key}
            className={`flex items-center gap-2 rounded-md border p-1.5 ${i === selectedIndex ? "border-primary bg-primary/5" : ""}`}
          >
            <button type="button" onClick={() => onSelect(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`Ver cena ${i + 1}`}>
              {scene.url ? (
                <img src={scene.url} alt="" className="h-12 w-9 shrink-0 rounded bg-muted object-contain" loading="lazy" />
              ) : (
                <span className="grid h-12 w-9 shrink-0 place-items-center rounded bg-muted">
                  <ImageIcon className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">Cena {i + 1}</span>
                {i === 0 && <span className="block text-[11px] text-muted-foreground">Capa da campanha</span>}
                {!scene.url && <span className="block text-[11px] text-destructive">Imagem não carregada</span>}
              </span>
            </button>
            {editable && (
              <div className="flex shrink-0 items-center">
                {/* A primeira imagem é a capa da campanha e fica fixa na posição 1. */}
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Mover cena ${i + 1} para antes`} disabled={i <= 1} onClick={() => onMove(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Mover cena ${i + 1} para depois`} disabled={i === 0 || i === scenes.length - 1} onClick={() => onMove(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remover cena ${i + 1}`} disabled={i === 0} onClick={() => onRemove(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t pt-3">
        <PanelTitle hint="Vale para a cena selecionada. O padrão mostra a imagem inteira, sem cortar o produto.">
          Enquadramento da cena {selectedIndex + 1}
        </PanelTitle>
        {editable ? (
          <>
            <Segmented label="Enquadramento" options={FITS} value={framing.fit} onChange={(fit) => onFraming({ fit })} />
            <SliderField label="Zoom" value={framing.zoom} min={1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(zoom) => onFraming({ zoom })} />
            <SliderField label="Posição horizontal" value={framing.x} min={0} max={1} step={0.01} format={pct} onChange={(x) => onFraming({ x })} />
            <SliderField label="Posição vertical" value={framing.y} min={0} max={1} step={0.01} format={pct} onChange={(y) => onFraming({ y })} />
            <div>
              <Label className="mb-1 block">Área que a imagem não cobre</Label>
              <Segmented label="Preenchimento" options={FILLS} value={framing.fill} onChange={(fill) => onFraming({ fill })} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => onFraming(null)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Voltar ao padrão do modelo
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Este vídeo usa a imagem escolhida na criação, inteira e centralizada na área do modelo.</p>
        )}
      </div>

      {editable && (
        <p className="text-xs text-muted-foreground">
          A capa fica sempre em primeiro. Para incluir outras imagens, crie a publicação novamente escolhendo as fotos.
        </p>
      )}
    </div>
  );
}

// ------------------------------ Vídeo ---------------------------------------

interface VideoPanelProps {
  duration: number;
  onDuration: (seconds: number) => void;
  transition: TransitionId;
  onTransition: (t: TransitionId) => void;
  sceneCount: number;
}

export function VideoPanel({ duration, onDuration, transition, onTransition, sceneCount }: VideoPanelProps) {
  const multi = sceneCount > 1;
  return (
    <div className="space-y-4">
      <div>
        <PanelTitle hint="A música precisa ter pelo menos essa duração a partir do ponto escolhido.">Duração</PanelTitle>
        <Segmented
          label="Duração do vídeo"
          options={RENDER_DURATIONS.map((d) => [String(d), `${d} s`] as const)}
          value={String(duration)}
          onChange={(v) => onDuration(Number(v))}
        />
      </div>
      <div>
        <PanelTitle hint={multi ? "Aplicada entre todas as cenas." : "Só existe transição quando o vídeo tem mais de uma imagem."}>
          Transição entre cenas
        </PanelTitle>
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(TRANSITIONS) as Array<[TransitionId, string]>).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={transition === id ? "default" : "outline"}
              disabled={!multi}
              aria-pressed={transition === id}
              onClick={() => onTransition(id)}
              className="justify-start"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------ Propriedades --------------------------------

const PART_LABEL: Record<ScenePart, string> = { title: "Título", subtitle: "Subtítulo", cta: "Chamada", logo: "Logo" };
const ANCHOR_LABEL: Record<Anchor, string> = { top: "Topo", center: "Meio", bottom: "Base" };
const ALIGNS: ReadonlyArray<readonly [Align, string]> = [
  ["left", "Esq."],
  ["center", "Centro"],
  ["right", "Dir."],
];

export interface LogoManager {
  url: string | null;
  /** Administrador da empresa: pode trocar/remover a logo do cadastro. */
  canManage: boolean;
  saving: boolean;
  error: string | null;
  /** A marca está publicada (sem isso o vídeo sai sem logo). */
  published: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

interface PropertiesPanelProps {
  scene: SceneDefinition;
  layout: VideoLayout;
  selected: ScenePart;
  onSelect: (part: ScenePart) => void;
  onChange: (layout: VideoLayout) => void;
  onAnchor: (anchor: Anchor) => void;
  logo: LogoManager;
}

export function PropertiesPanel({ scene, layout, selected, onSelect, onChange, onAnchor, logo }: PropertiesPanelProps) {
  const parts = (Object.entries(PART_LABEL) as Array<[ScenePart, string]>).map(([id, label]) => [id, label] as const);
  return (
    <div className="space-y-4">
      <Segmented label="Elemento" options={parts} value={selected} onChange={onSelect} />

      {selected === "logo" ? (
        <LogoProperties layout={layout} onChange={onChange} logo={logo} />
      ) : (
        <TextProperties
          key={selected}
          value={layout[selected]}
          defaultFont={scene.text[selected].font}
          showSpacing={selected === "title"}
          onChange={(v) => onChange({ ...layout, [selected]: v })}
        />
      )}

      {selected !== "logo" && (
        <div className="space-y-3 border-t pt-3">
          <PanelTitle hint="Título, subtítulo e chamada andam juntos. Também dá para arrastar o texto na prévia.">
            Posição do texto
          </PanelTitle>
          <Segmented
            label="Posição vertical"
            options={scene.anchors.map((a) => [a, ANCHOR_LABEL[a]] as const)}
            value={layout.title.vAnchor}
            onChange={onAnchor}
          />
          <SliderField
            label="Deslocar na vertical"
            value={layout.offsetY ?? 0}
            min={-40}
            max={40}
            step={0.5}
            format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
            onChange={(v) => onChange({ ...layout, offsetY: v })}
          />
          <SliderField
            label="Deslocar na horizontal"
            value={layout.offsetX ?? 0}
            min={-30}
            max={30}
            step={0.5}
            format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
            onChange={(v) => onChange({ ...layout, offsetX: v })}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!layout.offsetX && !layout.offsetY}
            onClick={() => onChange({ ...layout, offsetX: 0, offsetY: 0 })}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Voltar à posição do modelo
          </Button>
        </div>
      )}
    </div>
  );
}

/** Logo: arquivo da empresa (cadastro de marca) + como ela aparece NESTE vídeo. */
function LogoProperties({ layout, onChange, logo }: { layout: VideoLayout; onChange: (layout: VideoLayout) => void; logo: LogoManager }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const visible = layout.logo.visible !== false;
  const patch = (p: Partial<VideoLayout["logo"]>) => onChange({ ...layout, logo: { ...layout.logo, ...p } });

  function pick(file: File | undefined) {
    if (!file) return;
    const invalid = validateLogoFile(file);
    setFileError(invalid);
    if (!invalid) logo.onUpload(file);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PanelTitle hint="A logo é a do cadastro de marca da empresa e vale para todos os vídeos.">Logo da empresa</PanelTitle>
        <div className="flex items-center gap-3">
          {/* Fundo quadriculado: deixa visível a transparência do arquivo. */}
          <div
            className="grid h-14 w-24 shrink-0 place-items-center rounded-md border"
            style={{ background: "repeating-conic-gradient(#d4d4d8 0% 25%, #f4f4f5 0% 50%) 50% / 12px 12px" }}
          >
            {logo.url ? <img src={logo.url} alt="Logo atual" className="max-h-12 max-w-[5.25rem] object-contain" /> : <span className="text-[11px] text-zinc-600">sem logo</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Button size="sm" variant="outline" disabled={!logo.canManage || logo.saving} onClick={() => fileRef.current?.click()}>
              {logo.saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
              {logo.url ? "Trocar logo" : "Carregar logo"}
            </Button>
            {logo.url && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={!logo.canManage || logo.saving}
                onClick={() => {
                  if (window.confirm("Remover a logo do cadastro da empresa? Ela deixa de aparecer em todos os vídeos novos.")) logo.onRemove();
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover do cadastro
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Arquivo da logo"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {(fileError || logo.error) && <p role="alert" className="text-xs text-destructive">{fileError ?? logo.error}</p>}
        {!logo.canManage && <p className="text-xs text-muted-foreground">Só administradores da empresa podem trocar ou remover a logo.</p>}
        {!logo.published && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            A marca da empresa ainda não foi publicada em Configurações → Identidade visual. Enquanto isso, o vídeo é gerado sem a logo e sem o modelo.
          </p>
        )}
        <p className="text-xs text-muted-foreground">PNG ou WebP com fundo transparente ficam melhores; a transparência é mantida.</p>
      </div>

      <div className="space-y-3 border-t pt-3">
        <PanelTitle>Neste vídeo</PanelTitle>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={visible} onChange={(e) => patch({ visible: e.target.checked })} />
          Mostrar a logo sobre o vídeo
        </label>
        {visible && (
          <>
            <SliderField
              label="Opacidade"
              value={layout.logo.opacity ?? 1}
              min={0.2}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => patch({ opacity })}
            />
            <TabLogo value={layout.logo} onChange={(next) => onChange({ ...layout, logo: next })} />
          </>
        )}
      </div>
    </div>
  );
}

function TextProperties({
  value,
  defaultFont,
  showSpacing,
  onChange,
}: {
  value: TextLayout;
  defaultFont: FontId;
  showSpacing: boolean;
  onChange: (v: TextLayout) => void;
}) {
  const patch = (p: Partial<TextLayout>) => onChange({ ...value, ...p });
  const font = value.font ?? defaultFont;
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="studio-font" className="mb-1 block">
          Fonte
        </Label>
        <select
          id="studio-font"
          value={font}
          onChange={(e) => {
            const next = e.target.value as FontId;
            // Voltar à fonte do modelo remove a troca, em vez de fixá-la.
            const { font: _drop, ...rest } = value;
            onChange(next === defaultFont ? rest : { ...rest, font: next });
          }}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          style={{ fontFamily: `"${FONTS[font].family}"`, fontWeight: FONTS[font].weight }}
        >
          {FONT_IDS.map((id) => (
            <option key={id} value={id}>
              {FONTS[id].label}
              {id === defaultFont ? " (do modelo)" : ""}
            </option>
          ))}
        </select>
      </div>
      <SliderField label="Tamanho" value={value.scale} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => patch({ scale: v })} />
      <div>
        <Label className="mb-1 block">Alinhamento</Label>
        <Segmented label="Alinhamento" options={ALIGNS} value={value.align} onChange={(align) => patch({ align })} />
      </div>
      {showSpacing && (
        <SliderField
          label="Espaço abaixo do título"
          value={value.spacing ?? 0}
          min={0}
          max={12}
          step={0.5}
          format={(v) => `${v.toFixed(1)}%`}
          onChange={(v) => patch({ spacing: v })}
        />
      )}
    </div>
  );
}
