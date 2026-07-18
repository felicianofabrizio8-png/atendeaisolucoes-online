// Barra sticky com ação principal ("Gerar campanha"). Desktop = flutuante
// no canto inferior direito; mobile = barra inferior full-width.

import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

export function CampaignStickyActionBar({ children, className }: Props) {
  return (
    <>
      {/* spacer para conteúdo não ficar coberto */}
      <div aria-hidden className="h-20 md:h-6" />
      <div
        className={
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm shadow-lg " +
          "px-4 py-3 md:px-0 md:py-0 md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none " +
          "md:right-6 md:bottom-6 md:left-auto md:inset-x-auto " +
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
