import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Atende Ai" },
      {
        name: "description",
        content:
          "Política de Privacidade do Atende Ai: como coletamos, usamos e protegemos dados do Facebook, Instagram e WhatsApp.",
      },
      { property: "og:title", content: "Política de Privacidade — Atende Ai" },
      {
        property: "og:description",
        content:
          "Como o Atende Ai trata dados do Facebook, Instagram e WhatsApp.",
      },
      { property: "og:url", content: "https://app.atendeaisolucoes.online/privacy" },
    ],
    links: [
      { rel: "canonical", href: "https://app.atendeaisolucoes.online/privacy" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Política de Privacidade</h1>

        <div className="mt-8 space-y-6 text-base leading-relaxed text-muted-foreground">
          <p>
            O <strong className="text-foreground">Atende Ai</strong> respeita sua privacidade.
          </p>
          <p>
            As informações coletadas através do Facebook, Instagram e WhatsApp são utilizadas
            apenas para funcionamento da plataforma, autenticação de usuários e automações
            autorizadas pelo usuário.
          </p>
          <p>Não compartilhamos dados pessoais com terceiros.</p>

          <div>
            <p className="text-foreground">Os dados podem incluir:</p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>Nome</li>
              <li>Foto de perfil</li>
              <li>ID de conta</li>
              <li>Informações de páginas conectadas</li>
              <li>Mensagens autorizadas via WhatsApp</li>
            </ul>
          </div>

          <p>O usuário pode solicitar remoção dos dados a qualquer momento.</p>

          <div>
            <p className="text-foreground">Contato:</p>
            <a
              href="mailto:fabriziorodrigues99@gmail.com"
              className="text-primary underline underline-offset-4"
            >
              fabriziorodrigues99@gmail.com
            </a>
          </div>
        </div>
      </article>
    </main>
  );
}
