import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  FileText,
  Package,
  BarChart3,
  Settings,
  Sparkles,
} from "lucide-react";

type NavItem = {
  to: "/" | "/inbox" | "/agenda" | "/orcamentos" | "/produtos" | "/relatorios" | "/configuracoes";
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
};

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Caixa de atendimento", icon: MessageSquare, badge: 3 },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Atende Ai!</div>
            <div className="text-[10px] text-muted-foreground">Vendas que não esperam</div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="rounded bg-[var(--status-urgent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--status-urgent-foreground)]">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
              VC
            </div>
            <div className="leading-tight min-w-0">
              <div className="text-sm font-medium truncate">Você</div>
              <div className="text-[11px] text-muted-foreground truncate">Vendedor • Empresa Demo</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
