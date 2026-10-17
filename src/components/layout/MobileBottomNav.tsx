import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, MessagesSquare, Megaphone, Calendar, LayoutGrid } from "lucide-react";
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

type BottomNavItem = {
  to: "/" | "/atendimento" | "/marketing" | "/agenda";
  label: string;
  icon: typeof LayoutDashboard;
};

const ITEMS: BottomNavItem[] = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/atendimento", label: "Chat", icon: MessagesSquare },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/agenda", label: "Agenda", icon: Calendar },
];

interface Props {
  /** Não-lidas agregadas — exibidas sobre o ícone do Chat. */
  unreadTotal?: number;
  /** Abre o menu completo. */
  onOpenMenu: () => void;
  /** Se o menu completo está aberto — a bolha vai para o botão Menu. */
  menuOpen?: boolean;
  /** Mesma regra de acesso da sidebar (inclui o modo demo). */
  canOpen: (path: string) => boolean;
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
export function MobileBottomNav({ unreadTotal = 0, onOpenMenu, menuOpen = false, canOpen }: Props) {
  const location = useLocation();
  const [pending, setPending] = useState<number | null>(null);

  const items = ITEMS.filter((item) => canOpen(item.to));
  const menuIndex = items.length;
  const slots = items.length + 1;

  // A URL mudou: a navegação chegou, o estado real assume.
  useEffect(() => setPending(null), [location.pathname]);

  const routeIndex = items.findIndex((item) => isActive(location.pathname, item.to));
  const current = menuOpen ? menuIndex : (pending ?? (routeIndex === -1 ? menuIndex : routeIndex));

  return (
    <nav aria-label="Navegação principal" data-testid="mobile-bottom-nav" className="mobile-dock md:hidden">
      <ul className="mobile-dock-bar" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
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
          const badge = item.to === "/atendimento" ? unreadTotal : 0;
          return (
            <li key={item.to} className="relative min-w-0">
              <Link
                to={item.to}
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
