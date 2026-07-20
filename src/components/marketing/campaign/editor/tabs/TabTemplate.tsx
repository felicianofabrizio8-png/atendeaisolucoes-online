// Aba TEMPLATE — biblioteca de 8 presets.
// Escolher um template reseta o layout para o preset correspondente.

import { Check } from "lucide-react";
import { TEMPLATE_LIST } from "@/lib/marketing/video-editor/templates";
import type { TemplateId } from "@/lib/marketing/video-editor/layout.types";

interface Props {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
}

export function TabTemplate({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {TEMPLATE_LIST.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`relative text-left rounded-lg border p-3 transition ${
              active
                ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            {active && (
              <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary text-primary-foreground grid place-items-center">
                <Check className="h-3 w-3" />
              </span>
            )}
            <div
              className="h-16 rounded-md mb-2 flex items-end justify-start p-2"
              style={{
                background:
                  "linear-gradient(160deg, hsl(var(--muted)) 0%, hsl(var(--muted-foreground) / 0.15) 100%)",
                fontFamily: t.titleFontFamily,
                fontWeight: t.titleWeight,
                fontSize: 14,
                color: "hsl(var(--foreground))",
              }}
            >
              {t.label}
            </div>
            <div className="text-sm font-semibold">{t.label}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              {t.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
