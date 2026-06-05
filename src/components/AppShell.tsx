import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Calendar,
  FileText,
  Package,
  BarChart3,
  Settings,
  Sparkles,
  Megaphone,
  LogOut,
  LogIn,
  Menu,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useEffect, useState } from "react";
import { loadRemote, setRepoMode, subscribeRepo, getConversations } from "@/data/leadRepo";
import { loadProductsRemote, setProductsMode } from "@/data/products";
import { loadQuotesRemote, setQuotesMode } from "@/data/quotes";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBridge } from "@/components/NotificationBridge";

type NavItem = {
  to: "/" | "/inbox" | "/agenda" | "/orcamentos" | "/produtos" | "/relatorios" | "/configuracoes" | "/ia" | "/campanhas";
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
};

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Caixa de atendimento", icon: MessageSquare },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText },
  { to: "/campanhas", label: "Campanhas", icon: Megaphone },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/ia", label: "IA de Atendimento", icon: Sparkles },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, company, signOut } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);

  // Contador de não-lidas agregadas — usado no item "Caixa de atendimento".
  useEffect(() => {
    const recompute = () => {
      const total = getConversations().reduce((s, c) => s + (c.unread || 0), 0);
      setUnreadTotal(total);
    };
    recompute();
    return subscribeRepo(recompute);
  }, []);

  // Detecta modo demo do localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDemoMode(window.localStorage.getItem("atendeai.demo") === "1");
  }, [user]);

  // Fecha o menu mobile ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Quando logar, carrega dados reais e desativa demo. Quando deslogar/demo, volta pro mock.
  useEffect(() => {
    if (user && profile) {
      window.localStorage.removeItem("atendeai.demo");
      setDemoMode(false);
      loadRemote(profile.company_id).catch((e) => console.error("loadRemote failed", e));
      loadProductsRemote(profile.company_id).catch((e) =>
        console.error("loadProductsRemote failed", e),
      );
      loadQuotesRemote(profile.company_id).catch((e) =>
        console.error("loadQuotesRemote failed", e),
      );
    } else {
      setRepoMode("demo");
      setProductsMode("demo");
      setQuotesMode("demo");
    }
  }, [user, profile]);

  // /login não usa o shell.
  // /login e o callback OAuth Meta não usam o shell (callback roda em popup).
  if (location.pathname === "/login" || location.pathname.startsWith("/auth/")) {
    return <Outlet />;
  }

  const initials = (profile?.display_name ?? user?.email ?? "DM")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const handleSignOut = async () => {
    await signOut();
    window.localStorage.removeItem("atendeai.demo");
    navigate({ to: "/login" });
  };

  const enableDemo = () => {
    window.localStorage.setItem("atendeai.demo", "1");
    setDemoMode(true);
  };

  const NavList = (
    <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
      {nav.map((item) => {
        const Icon = item.icon;
        const active =
          item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
        const dynamicBadge = item.to === "/inbox" && unreadTotal > 0 ? unreadTotal : item.badge;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors",
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
            {dynamicBadge ? (
              <span className="rounded bg-[var(--status-urgent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--status-urgent-foreground)]">
                {dynamicBadge > 99 ? "99+" : dynamicBadge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const FooterPanel = (
    <div className="border-t border-sidebar-border p-3">
      {user ? (
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
            {initials || "U"}
          </div>
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {profile?.display_name ?? user.email?.split("@")[0]}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {company?.name ?? "Carregando…"}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            title="Sair"
            className="p-1.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
              DM
            </div>
            <div className="leading-tight min-w-0 flex-1">
              <div className="text-sm font-medium truncate">Visitante</div>
              <div className="text-[11px] text-muted-foreground truncate">Modo demo</div>
            </div>
          </div>
          <button
            onClick={() => navigate({ to: "/login" })}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
          >
            <LogIn className="h-3.5 w-3.5" />
            Entrar / Criar conta
          </button>
          {!demoMode && (
            <button
              onClick={enableDemo}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Continuar como demo
            </button>
          )}
        </div>
      )}
    </div>
  );

  const Brand = (
    <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
      <img
        src="/icon-192.png"
        alt="Atende Ai!"
        className="h-8 w-8 drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]"
      />
      <div className="leading-tight flex-1 min-w-0">
        <div className="text-sm font-semibold">Atende Ai!</div>
        <div className="text-[10px] text-muted-foreground">Vendas que não esperam</div>
      </div>
      <ThemeToggle />
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-background text-foreground">

      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        {Brand}
        {demoMode && !user && (
          <div className="mx-2 mt-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
            <div className="font-semibold">Modo demo</div>
            <div className="text-primary/70">Dados de exemplo locais</div>
          </div>
        )}
        {NavList}
        {FooterPanel}
      </aside>

      <main className="flex-1 min-w-0 min-h-0 h-full flex flex-col">
        {/* Topbar mobile */}
        <div className="md:hidden h-12 px-3 border-b border-border flex items-center gap-2 bg-sidebar shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Abrir menu"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 flex flex-col bg-sidebar">
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              {Brand}
              {NavList}
              {FooterPanel}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img
              src="/icon-192.png"
              alt="Atende Ai!"
              className="h-7 w-7 shrink-0 drop-shadow-[0_0_8px_rgba(34,211,238,0.35)]"
            />
            <span className="text-sm font-semibold truncate">Atende Ai!</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-auto">
          <Outlet />
        </div>

      </main>
    </div>
  );
}
