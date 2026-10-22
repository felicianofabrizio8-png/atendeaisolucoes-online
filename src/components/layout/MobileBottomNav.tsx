import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { LayoutGrid, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Esconde a navegação inferior enquanto `active` for true — para telas em
 * que o rodapé pertence a outra coisa (o composer de um chat aberto). A barra
 * desce animada e o conteúdo recupera o espaço. Contador por referência: duas
 * telas pedindo ao mesmo tempo não se atropelam.
 */
let hideRequests = 0;
export function useHideMobileNav(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    hideRequests += 1;
    document.documentElement.dataset.mobileNav = "hidden";
    return () => {
      hideRequests -= 1;
      if (hideRequests === 0) delete document.documentElement.dataset.mobileNav;
    };
  }, [active]);
}

/** Destino da barra — escolhido pela pessoa (ver `@/lib/mobile-dock`). */
export type BottomNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

interface Props {
  /** Atalhos na ordem escolhida (já filtrados pela permissão). */
  items: BottomNavItem[];
  /** Não-lidas agregadas — exibidas sobre o ícone do Chat. */
  unreadTotal?: number;
  /** Abre o menu completo. */
  onOpenMenu: () => void;
  /** Se o menu completo está aberto — a bolha vai para o botão Menu. */
  menuOpen?: boolean;
}

/**
 * Cada tela é um pedaço de código separado, baixado só no primeiro toque —
 * era isso que dava o atraso. Com o app ocioso, baixa de antemão as telas da
 * barra (uma por vez, para não disputar a rede com os dados da tela atual).
 * Respeita a economia de dados do aparelho.
 */
function usePreloadDockRoutes(paths: string[]) {
  const router = useRouter();
  const key = paths.join("|");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    let cancelled = false;
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(cb, { timeout: 2500 });
      } else {
        setTimeout(cb, 600);
      }
    };
    const queue = key.split("|").filter(Boolean);
    const next = () => {
      const to = queue.shift();
      if (!to || cancelled) return;
      router
        // Destinos vêm da lista de navegação do app (rotas que existem).
        .preloadRoute({ to: to as "/" })
        .catch(() => undefined)
        .finally(() => !cancelled && idle(next));
    };
    // Espera a tela atual assentar antes de começar.
    const start = window.setTimeout(() => idle(next), 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [router, key]);
}

const isActive = (pathname: string, to: string) =>
  to === "/" ? pathname === "/" : pathname.startsWith(to);

/**
 * Navegação inferior flutuante — só existe no mobile (< md).
 *
 * Uma cápsula solta da borda, com uma bolha sólida que cobre ícone e nome do
 * destino ativo. A bolha é UM elemento só, movido por `transform` (compositor,
 * sem layout nem repaint). Ela não espera a rota carregar: o toque já define
 * o destino (`pending`) e a bolha sai na hora; quando a URL muda, o estado
 * real assume. A cada troca ela estica um pouco no meio do caminho (keyframe
 * reiniciado pela `key`), o que dá a sensação de movimento líquido.
 *
 * Rotas que não estão na barra acendem o botão Menu: o usuário sempre sabe
 * onde está, mesmo dentro de uma página do menu completo.
 */
export function MobileBottomNav({ items, unreadTotal = 0, onOpenMenu, menuOpen = false }: Props) {
  const location = useLocation();
  const [pending, setPending] = useState<number | null>(null);

  usePreloadDockRoutes(items.map((item) => item.to));
  const menuIndex = items.length;
  const slots = items.length + 1;

  // A URL mudou: a navegação chegou, o estado real assume.
  useEffect(() => setPending(null), [location.pathname]);

  const routeIndex = items.findIndex((item) => isActive(location.pathname, item.to));
  const current = menuOpen ? menuIndex : (pending ?? (routeIndex === -1 ? menuIndex : routeIndex));

  return (
    <nav
      aria-label="Navegação principal"
      data-testid="mobile-bottom-nav"
      className="mobile-dock md:hidden"
    >
      <ul
        className="mobile-dock-bar"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {/* Trilho da bolha: tem a largura de uma coluna e anda de coluna em
            coluna. translateX em % é relativo à própria largura = 1 coluna. */}
        <span
          aria-hidden
          className="mobile-dock-track"
          style={{
            width: `calc((100% - 12px) / ${slots})`,
            transform: `translate3d(${current * 100}%, 0, 0)`,
          }}
        >
          <span key={current} className="mobile-dock-bubble" />
        </span>

        {items.map((item, index) => {
          const Icon = item.icon;
          const active = index === current;
          const badge = item.to === "/atendimento" || item.to === "/inbox" ? unreadTotal : 0;
          return (
            <li key={item.to} className="relative min-w-0">
              <Link
                to={item.to as "/"}
                aria-current={isActive(location.pathname, item.to) ? "page" : undefined}
                onPointerDown={() => setPending(index)}
                onClick={() => setPending(index)}
                data-active={active || undefined}
                className="mobile-dock-item"
              >
                <span className="mobile-dock-icon">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge > 0 ? (
                    <span className="mobile-dock-badge">{badge > 99 ? "99+" : badge}</span>
                  ) : null}
                </span>
                <span className="mobile-dock-label">{item.label}</span>
              </Link>
            </li>
          );
        })}

        <li className="relative min-w-0">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Abrir menu completo"
            aria-expanded={menuOpen}
            data-active={current === menuIndex || undefined}
            className="mobile-dock-item w-full"
          >
            <span className="mobile-dock-icon">
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="mobile-dock-label">Menu</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
