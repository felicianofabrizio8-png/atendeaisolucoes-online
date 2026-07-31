// ============================================================================
// SPRINT 5 · FASE 5.2.2 — Retorno de foco ao fechar o sheet de detalhes.
//
// Defeito observado na validação real: após fechar o painel de detalhes no
// mobile, o `document.activeElement` ficava no `<body>`. O gatilho é um botão
// controlado (não um `SheetTrigger`), então o Radix não tem para onde
// restaurar. `ConversationDetailsSheet` expõe `onCloseFocus` justamente para
// que a rota decida o alvo: composer (quando veio de uma sugestão do Coach)
// ou o próprio gatilho (fechamento comum).
//
// Escopo: apenas o contrato de foco do componente. Nenhuma regra de negócio.
// ============================================================================
// @vitest-environment jsdom

import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { ConversationDetailsSheet } from "@/components/inbox/ConversationDetailsSheet";

afterEach(cleanup);

/** Réplica mínima da fiação de foco usada na rota da conversa. */
function Harness({ fromCoach = false }: { fromCoach?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusComposerOnCloseRef = useRef(false);

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Detalhes
      </button>
      <textarea ref={composerRef} aria-label="Mensagem" />
      <ConversationDetailsSheet
        open={open}
        onOpenChange={setOpen}
        title="Detalhes do lead"
        onCloseFocus={() => {
          const wantsComposer = focusComposerOnCloseRef.current;
          focusComposerOnCloseRef.current = false;
          const target = wantsComposer ? composerRef.current : triggerRef.current;
          if (!target) return false;
          target.focus({ preventScroll: true });
          return true;
        }}
      >
        <button
          type="button"
          onClick={() => {
            focusComposerOnCloseRef.current = fromCoach;
            setOpen(false);
          }}
        >
          Usar sugestão
        </button>
      </ConversationDetailsSheet>
    </div>
  );
}

describe("ConversationDetailsSheet — retorno de foco", () => {
  it("devolve o foco ao gatilho em um fechamento comum", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Detalhes" }));
    expect(await screen.findByTestId("conversation-details-sheet")).toBeTruthy();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Detalhes" }));
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("devolve o foco ao composer quando o fechamento veio de uma sugestão do Coach", async () => {
    const user = userEvent.setup();
    render(<Harness fromCoach />);

    await user.click(screen.getByRole("button", { name: "Detalhes" }));
    await user.click(await screen.findByRole("button", { name: "Usar sugestão" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Mensagem"));
    });
  });
});
