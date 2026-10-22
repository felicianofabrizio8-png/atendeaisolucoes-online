// Catálogo de produtos no desktop: vitrine de campanha (gradiente líquido e o
// produto em destaque),
// barra de busca/ordem, categorias em abas e os cards agrupados por categoria.
// O estado mora na rota; o celular usa `ProductsMobile` com os mesmos dados.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImageOff,
  Package,
  Percent,
  Plus,
  Search,
  SearchX,
  Sparkles,
  X,
} from "lucide-react";
import type { Product } from "@/data/products";
import { PriceTag, ProductCard, ProductCover, type ProductActions } from "./ProductCard";
import {
  categoryHue,
  categoryLabel,
  discountPercent,
  hasPromo,
  isFiltering,
  SORTS,
  type ProductSort,
  type QuickFilter,
} from "./product-view";

export type { ProductSort, QuickFilter };

export interface CatalogViewProps {
  /** Catálogo inteiro (para números e vitrine). */
  products: Product[];
  /** Depois de busca, filtro rápido, categoria e ordem. */
  visible: Product[];
  /** `visible` agrupado por categoria, na ordem do catálogo. */
  groups: [string, Product[]][];
  /** Categorias com a quantidade de produtos (após busca e filtro rápido). */
  categoryCounts: { category: string; count: number }[];
  query: string;
  onQuery: (query: string) => void;
  category: string | null;
  onCategory: (category: string | null) => void;
  quick: QuickFilter;
  onQuick: (quick: QuickFilter) => void;
  sort: ProductSort;
  onSort: (sort: ProductSort) => void;
  canEdit: boolean;
  canQuote: boolean;
  onCreate: () => void;
  onQuoteAny: () => void;
  actionsFor: (product: Product) => ProductActions;
  /** Painel de qualidade do catálogo (já decide se aparece). */
  audit: ReactNode;
}

export function ProductsDesktop(props: CatalogViewProps) {
  const {
    products,
    visible,
    groups,
    categoryCounts,
    query,
    onQuery,
    category,
    onCategory,
    sort,
    onSort,
  } = props;
  const reduceMotion = useReducedMotion();
  const tabsId = useId();
  const grouped = category === null && !query.trim() && groups.length > 1;

  return (
    <div className="lume-quotes lume-products">
      <div className="lq-shell">
        <ProductsHero {...props} />

        {products.length === 0 ? (
          <EmptyCatalog canEdit={props.canEdit} onCreate={props.onCreate} />
        ) : (
          <>
            {props.audit}

            <div className="lq-toolbar">
              <div className="lq-search">
                <div className="lq-search-box">
                  <Search aria-hidden="true" />
                  <input
                    aria-label="Pesquisar produtos"
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
                    placeholder="Buscar por nome, categoria, modelo ou medida…"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Limpar pesquisa"
                      onClick={() => onQuery("")}
                      className="lq-icon"
                    >
                      <X />
                    </button>
                  )}
                </div>
              </div>
              <label className="lq-sort">
                <span className="sr-only">Ordenar produtos</span>
                <select value={sort} onChange={(e) => onSort(e.target.value as ProductSort)}>
                  {SORTS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" />
              </label>
            </div>

            {categoryCounts.length > 1 && (
              <LayoutGroup id={tabsId}>
                <div className="lq-tabs lp-tabs" role="tablist" aria-label="Categorias">
                  {[null, ...categoryCounts.map((item) => item.category)].map((item) => {
                    const count =
                      item === null
                        ? categoryCounts.reduce((sum, entry) => sum + entry.count, 0)
                        : (categoryCounts.find((entry) => entry.category === item)?.count ?? 0);
                    return (
                      <button
                        key={item ?? "__all"}
                        type="button"
                        role="tab"
                        aria-selected={category === item}
                        onClick={() => onCategory(item)}
                      >
                        {category === item && (
                          <motion.span
                            layoutId="lp-tab"
                            className="lq-tab-indicator"
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : { type: "spring", stiffness: 420, damping: 34 }
                            }
                          />
                        )}
                        {item !== null && (
                          <i
                            data-dot
                            style={
                              { "--dot": `oklch(0.7 0.19 ${categoryHue(item)})` } as CSSProperties
                            }
                          />
                        )}
                        <span>{item === null ? "Todas" : categoryLabel(item)}</span>
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            )}

            <ActiveQuick {...props} />

            {visible.length === 0 ? (
              <NoResults {...props} />
            ) : grouped ? (
              groups.map(([groupCategory, items]) => (
                <section key={groupCategory} className="lp-group">
                  <header className="lp-group-head">
                    <i
                      style={{ "--hue": categoryHue(groupCategory) } as CSSProperties}
                      aria-hidden="true"
                    />
                    <h2>{categoryLabel(groupCategory)}</h2>
                    <span>{items.length}</span>
                    <span className="lp-group-rule" aria-hidden="true" />
                    <button
                      type="button"
                      className="lq-ghost"
                      onClick={() => onCategory(groupCategory)}
                    >
                      Ver só esta
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  </header>
                  <CardGrid items={items} {...props} showCategory={false} />
                </section>
              ))
            ) : (
              <CardGrid items={visible} {...props} showCategory={category === null} />
            )}

            {props.canQuote && !isFiltering(props) && (
              <div className="lp-foot-cta">
                <Sparkles aria-hidden="true" />
                <span>Pronto para vender? Monte uma proposta com estes produtos.</span>
                <button type="button" className="lq-secondary" onClick={props.onQuoteAny}>
                  <FileText aria-hidden="true" />
                  Criar orçamento
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CardGrid({
  items,
  query,
  actionsFor,
  showCategory,
}: CatalogViewProps & { items: Product[]; showCategory: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div layout={!reduceMotion} className="lp-grid">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((product, index) => (
          <motion.div
            key={product.id}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
            transition={{
              duration: 0.4,
              ease: [0.22, 1, 0.36, 1],
              delay: reduceMotion ? 0 : Math.min(index, 10) * 0.03,
            }}
          >
            <ProductCard
              product={product}
              query={query}
              showCategory={showCategory}
              actions={actionsFor(product)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Vitrine em formato de campanha: gradiente líquido (as referências de pôster),
 * título editorial, números que filtram e, à direita, o "Produto em destaque"
 * que passa sozinho como stories — com o desconto em letra grande e as ações.
 */
function ProductsHero({
  products,
  quick,
  onQuick,
  canEdit,
  canQuote,
  onCreate,
  onQuoteAny,
  actionsFor,
}: CatalogViewProps) {
  const promos = products.filter(hasPromo).length;
  const noPhoto = products.filter((product) => !product.images?.length).length;
  const categories = new Set(products.map((product) => product.category.trim())).size;
  // Destaques: promoções com foto primeiro, depois quem tem foto, depois o resto.
  const score = (product: Product) =>
    Number(hasPromo(product)) * 2 + Number(!!product.images?.length);
  const spotlight = [...products].sort((a, b) => score(b) - score(a)).slice(0, 5);

  return (
    <section className="lp-hero" aria-label="Vitrine do catálogo">
      <div className="lp-liquid" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="lp-hero-copy">
        <div className="lp-hero-top">
          <p className="lp-mono">Lume · Vitrine</p>
          <span className="lp-plus" aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
        <h1 className="lp-hero-title">
          <span>Seu catálogo,</span>
          <b>pronto para vender.</b>
        </h1>
        <p className="lp-hero-sub">
          Cada produto com foto, preço e detalhes vira resposta certa no WhatsApp e orçamento em um
          toque — pela sua equipe e pela Lume.
        </p>
        <div className="lp-hero-actions">
          {canEdit && (
            <button type="button" className="lq-primary" onClick={onCreate}>
              <Plus aria-hidden="true" />
              Novo produto
            </button>
          )}
          {canQuote && products.length > 0 && (
            <button type="button" className="lp-glass-btn" onClick={onQuoteAny}>
              <FileText aria-hidden="true" />
              Criar orçamento
            </button>
          )}
        </div>

        {products.length > 0 && (
          <div className="lp-metrics">
            <Metric value={products.length} label="produtos" />
            <Metric value={categories} label={categories === 1 ? "categoria" : "categorias"} />
            <Metric
              value={promos}
              label="em oferta"
              pressed={quick === "promo"}
              onClick={promos ? () => onQuick(quick === "promo" ? "todos" : "promo") : undefined}
            />
            {canEdit && (
              <Metric
                value={noPhoto}
                label="sem foto"
                tone={noPhoto ? "warn" : undefined}
                pressed={quick === "semFoto"}
                onClick={
                  noPhoto ? () => onQuick(quick === "semFoto" ? "todos" : "semFoto") : undefined
                }
              />
            )}
          </div>
        )}
      </div>

      {spotlight.length > 0 && (
        <Spotlight items={spotlight} actionsFor={actionsFor} canQuote={canQuote} />
      )}
    </section>
  );
}

/** Produto em destaque: troca sozinho (barras de stories), pausa ao passar o mouse. */
function Spotlight({
  items,
  actionsFor,
  canQuote,
}: {
  items: Product[];
  actionsFor: (product: Product) => ProductActions;
  canQuote: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex];
  const actions = actionsFor(current);
  const off = discountPercent(current);
  const go = (step: number) => setIndex((i) => (i + step + items.length) % items.length);

  return (
    <div
      className="lp-spot"
      style={{ "--hue": categoryHue(current.category) } as CSSProperties}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={current.id}
          className="lp-spot-media"
          initial={reduceMotion ? false : { opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProductCover product={current} thumbWidth={900} priority />
        </motion.div>
      </AnimatePresence>
      <div className="lp-spot-shade" aria-hidden="true" />

      {items.length > 1 && (
        <div className="lp-spot-bars" aria-hidden="true">
          {items.map((item, i) => (
            <i key={item.id} data-state={i < safeIndex ? "done" : undefined}>
              {i === safeIndex && (
                <b
                  key={`${item.id}-${safeIndex}`}
                  data-paused={paused || undefined}
                  onAnimationEnd={() => go(1)}
                />
              )}
            </i>
          ))}
        </div>
      )}

      <div className="lp-spot-top">
        <span className="lp-spot-chip">
          <Sparkles aria-hidden="true" />
          {off > 0 ? "Oferta em destaque" : "Em destaque"}
        </span>
        {items.length > 1 && (
          <span className="lp-spot-count">
            {String(safeIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
          </span>
        )}
      </div>

      {items.length > 1 && (
        <>
          <button
            type="button"
            className="lp-spot-nav"
            data-side="prev"
            aria-label="Destaque anterior"
            onClick={() => go(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lp-spot-nav"
            data-side="next"
            aria-label="Próximo destaque"
            onClick={() => go(1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </>
      )}

      <motion.div
        key={current.id}
        className="lp-spot-copy"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
        {off > 0 ? (
          <strong className="lp-spot-off">
            −{off}
            <small>%</small>
          </strong>
        ) : (
          <p className="lp-spot-cat">{categoryLabel(current.category)}</p>
        )}
        <h2>{current.name}</h2>
        <PriceTag product={current} size="lg" />
        <div className="lp-spot-actions">
          <button type="button" className="lq-primary" onClick={actions.onOpen}>
            Ver produto
            <ArrowUpRight aria-hidden="true" />
          </button>
          {canQuote && actions.onQuote && (
            <button type="button" className="lp-glass-btn" onClick={actions.onQuote}>
              <FileText aria-hidden="true" />
              Orçar
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Metric({
  value,
  label,
  onClick,
  pressed,
  tone,
}: {
  value: number;
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  tone?: "warn";
}) {
  const body = (
    <>
      <strong>{value}</strong>
      <small>{label}</small>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="lp-metric"
      aria-pressed={pressed}
      data-tone={tone}
      title={pressed ? "Mostrar todos" : `Mostrar só ${label}`}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className="lp-metric" data-tone={tone}>
      {body}
    </div>
  );
}

/** Pílula do filtro rápido ativo (promoção / sem foto), com como desfazer. */
export function ActiveQuick({ quick, onQuick }: Pick<CatalogViewProps, "quick" | "onQuick">) {
  if (quick === "todos") return null;
  return (
    <div className="lp-active">
      <span>
        {quick === "promo" ? <Percent aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
        {quick === "promo" ? "Só produtos em promoção" : "Só produtos sem foto"}
      </span>
      <button type="button" onClick={() => onQuick("todos")} aria-label="Remover filtro">
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export function NoResults({
  query,
  onQuery,
  onCategory,
  onQuick,
}: Pick<CatalogViewProps, "query" | "onQuery" | "onCategory" | "onQuick">) {
  return (
    <div className="lq-no-results lp-no-results" role="status">
      <SearchX aria-hidden="true" className="h-6 w-6" />
      <b>Nenhum produto encontrado</b>
      {query.trim()
        ? `Nada com “${query.trim()}”. Tente outro termo, como “6x3” ou o nome da categoria.`
        : "Nenhum produto neste filtro."}
      <button
        type="button"
        className="lq-secondary"
        onClick={() => {
          onQuery("");
          onCategory(null);
          onQuick("todos");
        }}
      >
        Limpar filtros
      </button>
    </div>
  );
}

export function EmptyCatalog({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <section className="lp-empty">
      <div className="lp-empty-orb" aria-hidden="true">
        <Package />
      </div>
      <h2>Seu catálogo começa aqui</h2>
      <p>
        Cadastre o que você vende. A Lume usa fotos, preços e características para responder
        clientes e montar orçamentos sem inventar nada.
      </p>
      <ol className="lp-empty-steps">
        <li>
          <b>1</b> Foto, nome e preço
        </li>
        <li>
          <b>2</b> Medidas e detalhes
        </li>
        <li>
          <b>3</b> Características para a IA
        </li>
      </ol>
      {canEdit ? (
        <button type="button" className="lq-primary" onClick={onCreate}>
          <Plus aria-hidden="true" />
          Cadastrar primeiro produto
        </button>
      ) : (
        <p className="lp-empty-note">Peça a um gestor para cadastrar os produtos da empresa.</p>
      )}
    </section>
  );
}
