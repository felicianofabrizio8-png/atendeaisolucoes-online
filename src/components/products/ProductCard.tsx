// Card do catálogo: capa (ou arte com a cor da categoria), nome, categoria e
// preço. Tocar abre o painel do produto; no desktop as ações aparecem sobre a
// capa ao passar o mouse.
import type { CSSProperties, ReactNode } from "react";
import { Copy, FileText, Pencil, Trash2 } from "lucide-react";
import type { Product } from "@/data/products";
import { formatBRL } from "@/data/mock";
import { normalizeSearch } from "@/lib/product-search";
import { SmartImage } from "@/components/SmartImage";
import {
  categoryHue,
  categoryLabel,
  discountPercent,
  displayPrice,
  hasPromo,
  productInitials,
} from "./product-view";
// CSS da tela importado aqui (e não no arquivo da rota): assim ele vai junto
// do código da tela, e não no pacote inicial de todas as páginas.
import "@/components/orcamentos/quotes.css";
import "./products.css";

export interface ProductActions {
  onOpen: () => void;
  onQuote?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/** Capa do produto ou, sem foto, uma aura na cor da categoria com as iniciais. */
export function ProductCover({
  product,
  index = 0,
  thumbWidth = 480,
  priority,
}: {
  product: Product;
  index?: number;
  thumbWidth?: number;
  priority?: boolean;
}) {
  const src = product.images?.[index];
  if (src) {
    return (
      <SmartImage
        src={src}
        alt={product.name}
        wrapperClassName="lp-cover-img"
        aspectRatio="1/1"
        thumbWidth={thumbWidth}
        priority={priority}
      />
    );
  }
  return (
    <div
      className="lp-art"
      style={{ "--hue": categoryHue(product.category) } as CSSProperties}
      aria-hidden="true"
    >
      <i />
      <span>{productInitials(product.name)}</span>
    </div>
  );
}

export function PriceTag({ product, size = "md" }: { product: Product; size?: "md" | "lg" }) {
  const promo = hasPromo(product);
  return (
    <div className="lp-price" data-size={size}>
      <strong>{formatBRL(displayPrice(product))}</strong>
      {promo && <s>{formatBRL(product.price)}</s>}
    </div>
  );
}

function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = normalizeSearch(text).indexOf(normalizeSearch(q));
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="lp-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function ProductCard({
  product,
  query = "",
  showCategory = true,
  actions,
}: {
  product: Product;
  query?: string;
  showCategory?: boolean;
  actions: ProductActions;
}) {
  const off = discountPercent(product);
  const photos = product.images?.length ?? 0;
  return (
    <article
      className="lp-card"
      style={{ "--hue": categoryHue(product.category) } as CSSProperties}
    >
      <button
        type="button"
        className="lp-card-hit"
        onClick={actions.onOpen}
        aria-label={`Abrir ${product.name}`}
      />
      <div className="lp-card-media">
        <ProductCover product={product} />
        {off > 0 && <span className="lp-badge-off">−{off}%</span>}
        {photos > 1 && <span className="lp-badge-photos">{photos} fotos</span>}
        <div className="lp-card-actions">
          {actions.onQuote && (
            <CardAction label="Criar orçamento" onClick={actions.onQuote}>
              <FileText />
            </CardAction>
          )}
          {actions.onEdit && (
            <CardAction label="Editar" onClick={actions.onEdit}>
              <Pencil />
            </CardAction>
          )}
          {actions.onDuplicate && (
            <CardAction label="Duplicar" onClick={actions.onDuplicate}>
              <Copy />
            </CardAction>
          )}
          {actions.onDelete && (
            <CardAction label="Excluir" onClick={actions.onDelete} danger>
              <Trash2 />
            </CardAction>
          )}
        </div>
      </div>
      <div className="lp-card-body">
        {showCategory && <p className="lp-card-cat">{categoryLabel(product.category)}</p>}
        <h3 title={product.name}>{highlightMatch(product.name, query)}</h3>
        <PriceTag product={product} />
      </div>
    </article>
  );
}

function CardAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-danger={danger || undefined}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
