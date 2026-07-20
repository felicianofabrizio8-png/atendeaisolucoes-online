// Aba TEXTOS — tamanho/posição/alinhamento por campo.

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type {
  Align,
  Anchor,
  TextLayout,
  VideoLayout,
} from "@/lib/marketing/video-editor/layout.types";

interface Props {
  layout: VideoLayout;
  onChange: (v: VideoLayout) => void;
}

const V_OPTIONS: Anchor[] = ["top", "center", "bottom"];
const H_OPTIONS: Align[] = ["left", "center", "right"];

function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`px-2.5 py-1 text-xs ${
            o === value
              ? "bg-primary text-primary-foreground"
              : "bg-background hover:bg-muted"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function FieldEditor({
  label,
  value,
  onChange,
  showSpacing,
  showVertical,
}: {
  label: string;
  value: TextLayout;
  onChange: (v: TextLayout) => void;
  showSpacing?: boolean;
  showVertical?: boolean;
}) {
  const patch = (p: Partial<TextLayout>) => onChange({ ...value, ...p });
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="text-sm font-semibold">{label}</div>
      <div>
        <div className="flex justify-between mb-1">
          <Label>Tamanho</Label>
          <span className="text-xs text-muted-foreground">{value.scale.toFixed(2)}x</span>
        </div>
        <Slider
          min={0.5}
          max={2}
          step={0.05}
          value={[value.scale]}
          onValueChange={([v]) => patch({ scale: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {showVertical && (
          <div>
            <Label className="mb-1 block">Posição</Label>
            <Segmented
              options={V_OPTIONS}
              value={value.vAnchor}
              onChange={(v) => patch({ vAnchor: v })}
              labels={{ top: "Topo", center: "Meio", bottom: "Base" }}
            />
          </div>
        )}
        <div>
          <Label className="mb-1 block">Alinhamento</Label>
          <Segmented
            options={H_OPTIONS}
            value={value.align}
            onChange={(v) => patch({ align: v })}
            labels={{ left: "Esq.", center: "Centro", right: "Dir." }}
          />
        </div>
      </div>
      {showSpacing && (
        <div>
          <div className="flex justify-between mb-1">
            <Label>Espaçamento</Label>
            <span className="text-xs text-muted-foreground">{value.spacing ?? 0}%</span>
          </div>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[value.spacing ?? 0]}
            onValueChange={([v]) => patch({ spacing: v })}
          />
        </div>
      )}
    </div>
  );
}

export function TabTextos({ layout, onChange }: Props) {
  return (
    <div className="space-y-3">
      <FieldEditor
        label="Título"
        value={layout.title}
        onChange={(v) => onChange({ ...layout, title: v })}
        showSpacing
        showVertical
      />
      <FieldEditor
        label="Subtítulo"
        value={layout.subtitle}
        onChange={(v) => onChange({ ...layout, subtitle: v })}
      />
      <FieldEditor
        label="CTA"
        value={layout.cta}
        onChange={(v) => onChange({ ...layout, cta: v })}
      />
    </div>
  );
}
