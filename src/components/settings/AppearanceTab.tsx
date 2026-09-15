import { useEffect, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCENT_OPTIONS,
  FONT_OPTIONS,
  THEME_OPTIONS,
  fontFamilyValue,
  getAppearance,
  getServerAppearance,
  googleFontsHref,
  setAccent,
  setFont,
  setTheme,
  subscribeAppearance,
  type ThemeMode,
} from "@/lib/appearance";
import { SettingsTabHeader } from "./settings-ui";

// Cores fixas da miniatura de cada tema (independem do tema ativo).
const THEME_PREVIEW: Record<
  ThemeMode,
  { bg: string; sidebar: string; card: string; border: string; line: string }
> = {
  black: {
    bg: "oklch(0 0 0)",
    sidebar: "oklch(0.07 0 0)",
    card: "oklch(0.14 0 0)",
    border: "oklch(0.26 0 0)",
    line: "oklch(0.40 0 0)",
  },
  dark: {
    bg: "oklch(0.18 0 0)",
    sidebar: "oklch(0.16 0 0)",
    card: "oklch(0.22 0 0)",
    border: "oklch(0.30 0 0)",
    line: "oklch(0.45 0 0)",
  },
  light: {
    bg: "oklch(0.985 0.003 250)",
    sidebar: "oklch(0.97 0.005 250)",
    card: "oklch(0.995 0.002 250)",
    border: "oklch(0.90 0.008 250)",
    line: "oklch(0.82 0.008 250)",
  },
};

const PREVIEW_FONTS_LINK_ID = "atendeai-font-previews";

/** Carrega todas as fontes da lista para que cada opção apareça na própria fonte. */
function usePreviewFonts() {
  useEffect(() => {
    if (document.getElementById(PREVIEW_FONTS_LINK_ID)) return;
    const href = googleFontsHref(FONT_OPTIONS.map((o) => o.value));
    if (!href) return;
    const link = document.createElement("link");
    link.id = PREVIEW_FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, []);
}

export function AppearanceTab() {
  const { theme, accent, font } = useSyncExternalStore(
    subscribeAppearance,
    getAppearance,
    getServerAppearance,
  );
  usePreviewFonts();

  return (
    <>
      <SettingsTabHeader title="Aparência" description="Tema, cor de destaque e fonte do painel" />

      <div className="space-y-8">
        <section>
          <h3 className="text-sm font-semibold mb-1">Tema</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Escolha as cores de fundo e das superfícies.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {THEME_OPTIONS.map((opt) => {
              const active = theme === opt.value;
              const p = THEME_PREVIEW[opt.value];
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-lg border p-2 text-left transition-colors",
                    active
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  <div
                    className="h-20 rounded-md overflow-hidden flex"
                    style={{ background: p.bg, border: `1px solid ${p.border}` }}
                  >
                    <div
                      className="w-1/4 h-full"
                      style={{ background: p.sidebar, borderRight: `1px solid ${p.border}` }}
                    />
                    <div className="flex-1 p-2 space-y-1.5">
                      <div
                        className="h-7 rounded p-1.5 space-y-1"
                        style={{ background: p.card, border: `1px solid ${p.border}` }}
                      >
                        <div className="h-1 w-3/4 rounded-full" style={{ background: p.line }} />
                        <div className="h-1 w-1/2 rounded-full" style={{ background: p.line }} />
                      </div>
                      <div className="h-2.5 w-10 rounded-sm bg-primary" />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full border grid place-items-center shrink-0",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pt-6 border-t border-border">
          <h3 className="text-sm font-semibold mb-1">Cor de destaque</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Usada nos botões, links e detalhes do painel.
          </p>

          <div className="flex flex-wrap gap-4">
            {ACCENT_OPTIONS.map((opt) => {
              const active = accent === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccent(opt.value)}
                  aria-pressed={active}
                  aria-label={opt.label}
                  title={opt.label}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span
                    className={cn(
                      "h-10 w-10 rounded-full grid place-items-center text-white transition-transform group-hover:scale-105",
                      active && "ring-2 ring-offset-2 ring-offset-background ring-foreground/70",
                    )}
                    style={{ background: opt.swatch }}
                  >
                    {active && <Check className="h-4 w-4" />}
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      active ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Prévia
            </span>
            <button
              type="button"
              className="text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5"
            >
              Botão principal
            </button>
            <span className="text-xs font-medium text-primary">Link de exemplo →</span>
          </div>
        </section>

        <section className="pt-6 border-t border-border">
          <h3 className="text-sm font-semibold mb-1">Fonte</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Tipografia usada em todo o painel.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {FONT_OPTIONS.map((opt) => {
              const active = font === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFont(opt.value)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors flex items-center gap-2",
                    active
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground/50",
                  )}
                  style={{ fontFamily: fontFamilyValue(opt.value) }}
                >
                  <span className="text-lg leading-none w-7 shrink-0">Aa</span>
                  <span className="text-xs font-medium truncate flex-1">{opt.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
