import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, MessageSquare, Megaphone, BarChart3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

type BottomNavItem = {
  to: "/" | "/inbox" | "/marketing" | "/relatorios";
  label: string;
  icon: typeof LayoutDashboard;
};

const ITEMS: BottomNavItem[] = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/inbox", label: "Caixa", icon: MessageSquare },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

interface Props {
  /** Não-lidas agregadas — exibidas sobre o ícone da Caixa. */
  unreadTotal?: number;
  /** Abre o menu completo (Sheet lateral). */
  onOpenMenu: () => void;
}

/**
 * Navegação inferior fixa — só existe no mobile (< md).
 * Coloca os 4 destinos mais usados no alcance do polegar e delega o resto
 * ao menu completo, reduzindo a navegação a 1 toque no uso com uma mão.
 */
export function MobileBottomNav({ unreadTotal = 0, onOpenMenu }: Props) {
  const location = useLocation();

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <nav
      aria-label="Navegação principal"
      data-testid="mobile-bottom-nav"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 safe-bottom border-t border-sidebar-border bg-sidebar/95 backdrop-blur"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          const badge = item.to === "/inbox" ? unreadTotal : 0;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-sidebar-foreground/70 active:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="truncate max-w-full">{item.label}</span>
                {badge > 0 ? (
                  <span className="absolute top-1.5 right-[22%] rounded-full bg-[var(--status-urgent)] px-1 text-[9px] font-bold leading-4 text-[var(--status-urgent-foreground)]">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Abrir menu completo"
            className="flex w-full min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium text-sidebar-foreground/70 active:text-sidebar-accent-foreground"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            <span>Menu</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
