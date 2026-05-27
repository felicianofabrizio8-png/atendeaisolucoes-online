import { Outlet, Link, createRootRoute, HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { Loader2 } from "lucide-react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ir para o dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Atende Ai! — Vendas que não esperam" },
      { name: "description", content: "Novo" },
      { name: "author", content: "Atende Ai!" },
      { property: "og:title", content: "Atende Ai! — Vendas que não esperam" },
      { property: "og:description", content: "Novo" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Atende Ai! — Vendas que não esperam" },
      { name: "twitter:description", content: "Novo" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/db9ac163-1d32-450f-9454-de821e1b38e5/id-preview-0f87882e--23e14a46-10ac-4695-adc6-36e0ab29fd20.lovable.app-1777171867510.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/db9ac163-1d32-450f-9454-de821e1b38e5/id-preview-0f87882e--23e14a46-10ac-4695-adc6-36e0ab29fd20.lovable.app-1777171867510.png" },
      { name: "theme-color", content: "#0f172a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Atende Ai!" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('atendeai.theme');if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();`,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

const PUBLIC_ROUTES = ["/login", "/privacy", "/reset-password", "/auth/meta/callback"];

function AuthGate() {
  const { loading, user } = useAuth();
  const location = useLocation();
  const isPublicRoute = PUBLIC_ROUTES.some(
    (p) => location.pathname === p || location.pathname.startsWith(p + "/"),
  );
  const demo =
    typeof window !== "undefined" && window.localStorage.getItem("atendeai.demo") === "1";

  if (isPublicRoute) {
    return <Outlet />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user && !demo) {
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <AppShell />;
}

export { Outlet };
