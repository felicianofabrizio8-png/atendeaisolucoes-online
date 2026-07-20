// Aba LOGO — tamanho, âncora, margens (sliders).

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { Anchor, Align, LogoLayout } from "@/lib/marketing/video-editor/layout.types";

interface Props {
  value: LogoLayout;
  onChange: (v: LogoLayout) => void;
}

const V_OPTIONS: Anchor[] = ["top", "center", "bottom"];
const H_OPTIONS: Align[] = ["left", "center", "right"];

function AnchorPicker<T extends string>({
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
          className={`px-3 py-1 text-xs ${
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

export function TabLogo({ value, onChange }: Props) {
  const patch = (p: Partial<LogoLayout>) => onChange({ ...value, ...p });

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between mb-1">
          <Label>Tamanho da logo</Label>
          <span className="text-xs text-muted-foreground">{value.scale.toFixed(2)}x</span>
        </div>
        <Slider
          min={0.4}
          max={2}
          step={0.05}
          value={[value.scale]}
          onValueChange={([v]) => patch({ scale: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block">Posição vertical</Label>
          <AnchorPicker
            options={V_OPTIONS}
            value={value.vAnchor}
            onChange={(v) => patch({ vAnchor: v })}
            labels={{ top: "Topo", center: "Meio", bottom: "Base" }}
          />
        </div>
        <div>
          <Label className="mb-1 block">Posição horizontal</Label>
          <AnchorPicker
            options={H_OPTIONS}
            value={value.hAnchor}
            onChange={(v) => patch({ hAnchor: v })}
            labels={{ left: "Esq.", center: "Centro", right: "Dir." }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between mb-1">
            <Label>Margem superior</Label>
            <span className="text-xs text-muted-foreground">{value.marginTop}%</span>
          </div>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[value.marginTop]}
            onValueChange={([v]) => patch({ marginTop: v })}
          />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <Label>Margem inferior</Label>
            <span className="text-xs text-muted-foreground">{value.marginBottom}%</span>
          </div>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[value.marginBottom]}
            onValueChange={([v]) => patch({ marginBottom: v })}
          />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <Label>Margem esquerda</Label>
            <span className="text-xs text-muted-foreground">{value.marginLeft}%</span>
          </div>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[value.marginLeft]}
            onValueChange={([v]) => patch({ marginLeft: v })}
          />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <Label>Margem direita</Label>
            <span className="text-xs text-muted-foreground">{value.marginRight}%</span>
          </div>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[value.marginRight]}
            onValueChange={([v]) => patch({ marginRight: v })}
          />
        </div>
      </div>
    </div>
  );
}
