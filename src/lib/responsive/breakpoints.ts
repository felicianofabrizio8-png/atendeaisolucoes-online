// Fonte única de verdade dos breakpoints do Atende Aí.
// Mantido como módulo puro (sem React/DOM) para ser testável e reutilizável
// tanto em componentes quanto em helpers de layout.

export const BREAKPOINTS = {
  /** < 768px — telefone, uso com uma mão */
  mobile: 0,
  /** 768px – 1023px — tablet / telefone deitado */
  tablet: 768,
  /** >= 1024px — desktop */
  desktop: 1024,
} as const;

export type DeviceClass = keyof typeof BREAKPOINTS;

/**
 * Classifica uma largura de viewport em uma classe de dispositivo.
 * Função pura — não acessa `window`.
 */
export function classifyWidth(width: number): DeviceClass {
  if (!Number.isFinite(width) || width < 0) return "desktop";
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "mobile";
}

/** `true` quando a interface deve usar padrões mobile-first (nav inferior, cards, drawers full-screen). */
export function isHandheld(device: DeviceClass): boolean {
  return device === "mobile";
}

/**
 * Altura mínima de área de toque (WCAG 2.5.5 / HIG).
 * Usada por utilitários e testes de conformidade.
 */
export const MIN_TAP_TARGET_PX = 44;

/** Altura da barra de navegação inferior no mobile (sem safe-area). */
export const MOBILE_BOTTOM_NAV_PX = 60;
