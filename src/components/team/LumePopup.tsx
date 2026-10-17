import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import "@/components/orcamentos/quotes.css";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Popup preto com brilho roxo — o mesmo desenho do formulário de Orçamentos, com a
 * entrada suave do Marketing IA (fade + leve subida). Sem movimento para quem pediu.
 */
export function LumePopup({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open || !onClose) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="lume-popup"
          className="lq-black-backdrop"
          style={{ animation: "none" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(event) => event.stopPropagation()}
            className="lq-black lq-panel flex w-full flex-col"
            style={{
              maxWidth: size === "sm" ? 440 : size === "lg" ? 640 : 540,
              maxHeight: "min(820px, calc(100dvh - 32px))",
            }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
          >
            <span className="lq-panel-glow" aria-hidden="true" />
            <div className="lq-form-head pb-4">
              <div className="lq-form-title">
                <div>
                  <h2>{title}</h2>
                  {description && <p>{description}</p>}
                </div>
                {onClose && (
                  <button type="button" onClick={onClose} aria-label="Fechar" className="lq-close">
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
            {children && <div className="lq-form-body">{children}</div>}
            {footer && <div className="lq-form-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
