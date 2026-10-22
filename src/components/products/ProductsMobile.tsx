// Catálogo no celular — o formato de uma loja de aplicativo:
//
//   1. Topo enxuto: "Produtos" em letra grande e o "+" redondo.
//   2. Busca e categorias presas no topo enquanto a lista rola.
//   3. Navegando ("Todas", sem busca): ofertas em destaque numa faixa larga e
//      uma faixa deslizante por categoria, cada uma com "Ver tudo".
//   4. Filtrando (categoria, ofertas ou busca): grade de duas colunas.
//
// Tocar num produto abre o painel com fotos, ficha e as ações.
import type { CSSProperties } from "react";
import { ChevronRight, Percent, Plus, Search, X } from "lucide-react";
import type { Product } from "@/data/products";
import { ProductCard, ProductCover, PriceTag } from "./ProductCard";
import { ActiveQuick, EmptyCatalog, NoResults, type CatalogViewProps } from "./ProductsCatalog";
import { categoryHue, categoryLabel, discountPercent, hasPromo, isFiltering } from "./product-view";

export function ProductsMobile(props: CatalogViewProps) {
  const {
    products,
    visible,
    groups,
    categoryCounts,
    query,
    onQuery,
    category,
    onCategory,
    quick,
    onQuick,
    canEdit,
    onCreate,
    actionsFor,
  } = props;
  const browsing = !isFiltering(props) && groups.length > 0;
  const promos = products.filter(hasPromo);

  return (
    <div className="lume-quotes lume-products lpm">
      <header className="lpm-head">
        <div className="min-w-0">
          <p className="lp-mono">Lume · Catálogo</p>
          <h1 className="lpm-title">
            Produtos
            <span>{products.length}</span>
          </h1>
        </div>
        {canEdit && (
          <button type="button" className="lpm-round" aria-label="Novo produto" onClick={onCreate}>
            <Plus aria-hidden="true" />
          </button>
        )}
      </header>

      {products.length === 0 ? (
        <div className="lpm-pad">
          <EmptyCatalog canEdit={canEdit} onCreate={onCreate} />
        </div>
      ) : (
        <>
          <div className="lpm-sticky">
            <div className="lq-search-box lpm-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="Pesquisar produtos"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Buscar produto, medida, modelo…"
                enterKeyHint="search"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Limpar pesquisa"
                  onClick={() => onQuery("")}
                  className="lpm-clear"
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="lpm-chips" role="tablist" aria-label="Categorias">
              <Chip
                selected={category === null && quick === "todos"}
                onClick={() => {
                  onCategory(null);
                  onQuick("todos");
                }}
              >
                Todas
              </Chip>
              {promos.length > 0 && (
                <Chip
                  selected={quick === "promo"}
                  tone="promo"
                  onClick={() => onQuick(quick === "promo" ? "todos" : "promo")}
                >
                  <Percent aria-hidden="true" />
                  Ofertas
                </Chip>
              )}
              {categoryCounts.map(({ category: item, count }) => (
                <Chip
                  key={item}
                  selected={category === item}
                  hue={categoryHue(item)}
                  onClick={() => onCategory(category === item ? null : item)}
                >
                  {categoryLabel(item)}
                  <small>{count}</small>
                </Chip>
              ))}
            </div>
          </div>

          <div className="lpm-pad">
            {!query.trim() && props.audit}

            {browsing ? (
              <>
                {promos.length > 0 && (
                  <section className="lpm-section" aria-label="Ofertas">
                    <SectionHead
                      title="Ofertas"
                      count={promos.length}
                      onMore={() => onQuick("promo")}
                    />
                    <div className="lpm-rail lpm-rail-wide">
                      {promos.map((product) => (
                        <FeatureCard
                          key={product.id}
                          product={product}
                          onOpen={actionsFor(product).onOpen}
                        />
                      ))}
                    </div>
                  </section>
                )}
                {groups.map(([groupCategory, items]) => (
                  <section key={groupCategory} className="lpm-section">
                    <SectionHead
                      title={categoryLabel(groupCategory)}
                      count={items.length}
                      hue={categoryHue(groupCategory)}
                      onMore={groups.length > 1 ? () => onCategory(groupCategory) : undefined}
                    />
                    <div className={groups.length > 1 ? "lpm-rail" : "lpm-grid"}>
                      {items.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          showCategory={false}
                          actions={{ onOpen: actionsFor(product).onOpen }}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            ) : (
              <>
                <ActiveQuick quick={quick} onQuick={onQuick} />
                {visible.length === 0 ? (
                  <NoResults {...props} />
                ) : (
                  <>
                    <p className="lpm-count">
                      {visible.length} produto{visible.length === 1 ? "" : "s"}
                      {category !== null && ` em ${categoryLabel(category)}`}
                    </p>
                    <div className="lpm-grid">
                      {visible.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          query={query}
                          showCategory={category === null}
                          actions={{ onOpen: actionsFor(product).onOpen }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  hue,
  tone,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  hue?: number;
  tone?: "promo";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-tone={tone}
      onClick={onClick}
      className="lpm-chip"
      style={hue != null ? ({ "--hue": hue } as CSSProperties) : undefined}
    >
      {children}
    </button>
  );
}

function SectionHead({
  title,
  count,
  hue,
  onMore,
}: {
  title: string;
  count: number;
  hue?: number;
  onMore?: () => void;
}) {
  return (
    <div className="lpm-section-head">
      <h2>
        {hue != null && <i style={{ "--hue": hue } as CSSProperties} aria-hidden="true" />}
        {title}
        <small>{count}</small>
      </h2>
      {onMore && (
        <button type="button" onClick={onMore}>
          Ver tudo
          <ChevronRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Destaque largo das ofertas: aura da categoria, desconto e a capa à direita. */
function FeatureCard({ product, onOpen }: { product: Product; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="lpm-feature"
      onClick={onOpen}
      style={{ "--hue": categoryHue(product.category) } as CSSProperties}
    >
      <span className="lpm-feature-copy">
        <span className="lp-badge-off">−{discountPercent(product)}%</span>
        <b>{product.name}</b>
        <PriceTag product={product} />
      </span>
      <span className="lpm-feature-media">
        <ProductCover product={product} thumbWidth={360} />
      </span>
    </button>
  );
}
