// Painel do produto — a "página do app": galeria deslizante, preço, ficha
// técnica e as ações (orçamento, editar, duplicar, excluir). No celular ocupa
// a tela inteira e a ação principal fica presa embaixo.
import { useRef, useState, type CSSProperties } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, Copy, FileText, Package, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { Product } from "@/data/products";
import { formatBRL } from "@/data/mock";
import { ProductCover, PriceTag } from "./ProductCard";
import {
  attributeFacts,
  categoryHue,
  categoryLabel,
  discountPercent,
  mainFacts,
  variantLabels,
} from "./product-view";

export function ProductDetailSheet({
  product,
  onClose,
  onQuote,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  product: Product;
  onClose: () => void;
  onQuote?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const photos = product.images?.length ?? 0;
  const [active, setActive] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const facts = mainFacts(product);
  const attributes = attributeFacts(product);
  const variants = variantLabels(product);
  const included = product.includedItems ?? [];
  const off = discountPercent(product);

  const goTo = (index: number) => {
    setActive(index);
    const rail = railRef.current;
    rail?.scrollTo?.({ left: index * rail.clientWidth, behavior: "smooth" });
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="lp-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="lq-black lp-sheet"
          style={{ "--hue": categoryHue(product.category) } as CSSProperties}
        >
          <span className="lq-panel-glow" aria-hidden="true" />
          <div className="lp-sheet-top">
            <DialogPrimitive.Close aria-label="Voltar ao catálogo" className="lp-sheet-back">
              <ArrowLeft aria-hidden="true" />
            </DialogPrimitive.Close>
            <DialogPrimitive.Close aria-label="Fechar" className="lq-close lp-sheet-x">
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="lp-sheet-scroll">
            <div className="lp-sheet-grid">
              {/* ── Galeria ── */}
              <section className="lp-gallery" aria-label="Fotos do produto">
                <div
                  ref={railRef}
                  className="lp-gallery-rail"
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    const index = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
                    if (index !== active) setActive(index);
                  }}
                >
                  {photos === 0 ? (
                    <div className="lp-gallery-slide">
                      <ProductCover product={product} />
                    </div>
                  ) : (
                    product.images!.map((url, index) => (
                      <div key={url + index} className="lp-gallery-slide">
                        <ProductCover
                          product={product}
                          index={index}
                          thumbWidth={960}
                          priority={index === 0}
                        />
                      </div>
                    ))
                  )}
                </div>
                {off > 0 && <span className="lp-badge-off lp-badge-lg">−{off}%</span>}
                {photos > 1 && (
                  <>
                    <div className="lp-dots" aria-hidden="true">
                      {product.images!.map((url, index) => (
                        <i key={url + index} data-on={index === active || undefined} />
                      ))}
                    </div>
                    <div className="lp-thumbs">
                      {product.images!.map((url, index) => (
                        <button
                          type="button"
                          key={url + index}
                          aria-label={`Ver foto ${index + 1}`}
                          aria-current={index === active || undefined}
                          onClick={() => goTo(index)}
                        >
                          <ProductCover product={product} index={index} thumbWidth={160} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* ── Informações ── */}
              <section className="lp-info">
                <p className="lp-eyebrow">
                  <i aria-hidden="true" />
                  {categoryLabel(product.category)}
                </p>
                <DialogPrimitive.Title className="lp-info-title">
                  {product.name}
                </DialogPrimitive.Title>
                <PriceTag product={product} size="lg" />
                {off > 0 && (
                  <p className="lp-save">
                    Economia de {formatBRL(product.price - product.promoPrice!)} no preço
                    promocional
                  </p>
                )}

                {product.description && <p className="lp-desc">{product.description}</p>}

                {facts.length > 0 && (
                  <dl className="lp-facts">
                    {facts.map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {variants.length > 0 && (
                  <div className="lp-block">
                    <h3>Variações</h3>
                    <div className="lp-pills">
                      {variants.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                )}

                {attributes.length > 0 && (
                  <div className="lp-block">
                    <h3>
                      <Sparkles aria-hidden="true" />
                      Características que a IA usa
                    </h3>
                    <dl className="lp-attr">
                      {attributes.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {included.length > 0 && (
                  <div className="lp-block">
                    <h3>
                      <Package aria-hidden="true" />
                      Itens inclusos
                    </h3>
                    <ul className="lp-included">
                      {included.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {product.notes && (
                  <div className="lp-block">
                    <h3>Observações</h3>
                    <p className="lp-desc">{product.notes}</p>
                  </div>
                )}
              </section>
            </div>
          </div>

          {(onQuote || onEdit || onDuplicate || onDelete) && (
            <footer className="lp-sheet-foot">
              {onDelete && (
                <button
                  type="button"
                  className="lq-icon"
                  data-danger
                  aria-label="Excluir"
                  title="Excluir"
                  onClick={onDelete}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
              {onDuplicate && (
                <button
                  type="button"
                  className="lq-icon"
                  aria-label="Duplicar"
                  title="Duplicar"
                  onClick={onDuplicate}
                >
                  <Copy aria-hidden="true" />
                </button>
              )}
              <span className="lp-spacer" />
              {onEdit && (
                <button type="button" className="lq-secondary" onClick={onEdit}>
                  <Pencil aria-hidden="true" />
                  Editar
                </button>
              )}
              {onQuote && (
                <button type="button" className="lq-primary" onClick={onQuote}>
                  <FileText aria-hidden="true" />
                  Criar orçamento
                </button>
              )}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
