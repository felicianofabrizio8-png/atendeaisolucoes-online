// Barra sticky com ação principal ("Gerar campanha"). Desktop = flutuante
// no canto inferior direito; mobile = barra inferior full-width.
//
// Abaixo de `lg` existe a navegação inferior fixa (MobileBottomNav, ~61px).
// A barra fica logo acima dela; colada em `bottom-0` ficaria coberta e o
// botão principal não receberia o toque.

import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

const ABOVE_MOBILE_NAV = "bottom-[calc(3.8125rem+env(safe-area-inset-bottom))]";
const ABOVE_MOBILE_NAV_FLOATING = "md:bottom-[calc(4.8125rem+env(safe-area-inset-bottom))]";

export function CampaignStickyActionBar({ children, className }: Props) {
  return (
    <>
      {/* spacer para conteúdo não ficar coberto */}
      <div aria-hidden className="h-36 md:h-24 lg:h-6" />
      <div
        className={
          `fixed inset-x-0 ${ABOVE_MOBILE_NAV} z-40 border-t bg-background/95 backdrop-blur-sm shadow-lg ` +
          "px-4 py-3 md:px-0 md:py-0 md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none " +
          `md:right-6 ${ABOVE_MOBILE_NAV_FLOATING} lg:bottom-6 md:left-auto md:inset-x-auto ` +
          (className ?? "")
        }
        role="region"
        aria-label="Ações da campanha"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2">
          {children}
        </div>
      </div>
    </>
  );
}
