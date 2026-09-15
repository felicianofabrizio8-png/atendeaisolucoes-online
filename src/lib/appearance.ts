// Preferências de aparência (tema, cor de destaque e fonte), salvas por
// navegador. APPEARANCE_BOOT_SCRIPT roda inline em __root.tsx antes da
// hidratação para evitar flash; este módulo mantém o estado em sincronia depois.

export type ThemeMode = "black" | "dark" | "light";
export type AccentColor = "cyan" | "blue" | "violet" | "green" | "orange";
export type AppFont =
  | "system"
  | "Inter"
  | "Poppins"
  | "Montserrat"
  | "Roboto"
  | "Open Sans"
  | "Lato"
  | "Playfair Display"
  | "Merriweather";

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: "black", label: "Preto", description: "Preto absoluto com superfícies sutis" },
  { value: "dark", label: "Escuro", description: "Cinza escuro neutro" },
  { value: "light", label: "Claro", description: "Fundo claro e suave" },
];

// `swatch` é só a amostra exibida na tela de Aparência; as cores reais
// aplicadas em cada tema ficam em styles.css ([data-accent]).
export const ACCENT_OPTIONS: Array<{ value: AccentColor; label: string; swatch: string }> = [
  { value: "cyan", label: "Ciano", swatch: "oklch(0.72 0.15 195)" },
  { value: "blue", label: "Azul", swatch: "oklch(0.64 0.16 255)" },
  { value: "violet", label: "Violeta", swatch: "oklch(0.64 0.17 300)" },
  { value: "green", label: "Verde", swatch: "oklch(0.68 0.16 150)" },
  { value: "orange", label: "Laranja", swatch: "oklch(0.72 0.16 55)" },
];

// Mesma allowlist de fontes do Brand Center, carregadas do Google Fonts sob demanda.
export const FONT_OPTIONS: Array<{ value: AppFont; label: string }> = [
  { value: "system", label: "Padrão do sistema" },
  { value: "Inter", label: "Inter" },
  { value: "Poppins", label: "Poppins" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Roboto", label: "Roboto" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Playfair Display", label: "Playfair Display" },
  { value: "Merriweather", label: "Merriweather" },
];

const FALLBACK_STACK = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

// Lato e Merriweather não são fontes variáveis: pesos listados explicitamente.
const FONT_WEIGHTS: Record<Exclude<AppFont, "system">, string> = {
  Inter: "400;500;600;700",
  Poppins: "400;500;600;700",
  Montserrat: "400;500;600;700",
  Roboto: "400;500;700",
  "Open Sans": "400;500;600;700",
  Lato: "400;700",
  "Playfair Display": "400;500;600;700",
  Merriweather: "400;700",
};

export function fontFamilyValue(font: AppFont): string {
  return font === "system" ? FALLBACK_STACK : `"${font}", ${FALLBACK_STACK}`;
}

export function googleFontsHref(fonts: AppFont[]): string | null {
  const families = fonts
    .filter((f): f is Exclude<AppFont, "system"> => f !== "system")
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@${FONT_WEIGHTS[f]}`);
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

const THEME_KEY = "atendeai.theme";
const ACCENT_KEY = "atendeai.accent";
const FONT_KEY = "atendeai.font";
const FONT_LINK_ID = "atendeai-font";

export type Appearance = { theme: ThemeMode; accent: AccentColor; font: AppFont };

const DEFAULT: Appearance = { theme: "dark", accent: "cyan", font: "system" };

function isTheme(v: unknown): v is ThemeMode {
  return THEME_OPTIONS.some((o) => o.value === v);
}

function isAccent(v: unknown): v is AccentColor {
  return ACCENT_OPTIONS.some((o) => o.value === v);
}

function isFont(v: unknown): v is AppFont {
  return FONT_OPTIONS.some((o) => o.value === v);
}

/** Script inline (sem dependências) que aplica as preferências antes do primeiro paint. */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement,s=localStorage;
var t=s.getItem(${JSON.stringify(THEME_KEY)});if(t==='light'||t==='black'){d.classList.add(t);}
var a=s.getItem(${JSON.stringify(ACCENT_KEY)});if(${JSON.stringify(ACCENT_OPTIONS.map((o) => o.value).filter((v) => v !== "cyan"))}.indexOf(a)>=0){d.setAttribute('data-accent',a);}
var f=s.getItem(${JSON.stringify(FONT_KEY)});var fonts=${JSON.stringify(
  Object.fromEntries(
    FONT_OPTIONS.filter((o) => o.value !== "system").map((o) => [
      o.value,
      { family: fontFamilyValue(o.value), href: googleFontsHref([o.value]) },
    ]),
  ),
)};
if(f&&fonts[f]){d.style.setProperty('--app-font-family',fonts[f].family);var l=document.createElement('link');l.id=${JSON.stringify(FONT_LINK_ID)};l.rel='stylesheet';l.href=fonts[f].href;document.head.appendChild(l);}
}catch(e){}})();`;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

let current: Appearance = DEFAULT;
let initialized = false;
const listeners = new Set<() => void>();

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const t = readStorage(THEME_KEY);
  const a = readStorage(ACCENT_KEY);
  const f = readStorage(FONT_KEY);
  current = {
    theme: isTheme(t) ? t : DEFAULT.theme,
    accent: isAccent(a) ? a : DEFAULT.accent,
    font: isFont(f) ? f : DEFAULT.font,
  };
  apply(current);
}

function apply({ theme, accent, font }: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("black", theme === "black");
  if (accent === "cyan") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);

  const href = googleFontsHref([font]);
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (href) {
    if (!link) {
      link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
    root.style.setProperty("--app-font-family", fontFamilyValue(font));
  } else {
    link?.remove();
    root.style.removeProperty("--app-font-family");
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getAppearance(): Appearance {
  ensureInit();
  return current;
}

export function getServerAppearance(): Appearance {
  return DEFAULT;
}

export function subscribeAppearance(listener: () => void) {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(patch: Partial<Appearance>) {
  ensureInit();
  current = { ...current, ...patch };
  apply(current);
  emit();
}

export function setTheme(theme: ThemeMode) {
  writeStorage(THEME_KEY, theme);
  update({ theme });
}

export function setAccent(accent: AccentColor) {
  writeStorage(ACCENT_KEY, accent);
  update({ accent });
}

export function setFont(font: AppFont) {
  writeStorage(FONT_KEY, font);
  update({ font });
}
