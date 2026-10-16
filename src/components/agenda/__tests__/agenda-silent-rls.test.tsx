// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  rows: [
    {
      id: "e1",
      title: "Treino",
      scheduled_at: "2026-10-16T12:00:00Z",
      status: "agendada",
      appointment_type: "retorno_comercial",
    },
  ],
  // RLS filtrou: o UPDATE/DELETE não afeta nenhuma linha e não dá erro.
  affected: [] as unknown[],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../agenda-schema", () => ({ detectAgendaSchema: async () => ({ extended: false, hierarchy: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
    from: () => {
      let op = "select";
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "gte", "lte", "order", "in"]) builder[method] = () => builder;
      builder.select = () => builder;
      builder.update = () => {
        op = "update";
        return builder;
      };
      builder.delete = () => {
        op = "delete";
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: op === "select" ? db.rows : db.affected, error: null }).then(resolve);
      return builder;
    },
  },
}));
import { useAgendaEvents } from "../useAgendaEvents";
import { TimeGridView } from "../AgendaViews";
import { toast } from "sonner";
import type { AgendaEvent } from "../agenda-model";

afterEach(cleanup);
const range = { from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-18T23:59:59Z") };

describe("alteração filtrada pelo banco não vira falso sucesso", () => {
  it("remarcar sem linha afetada desfaz na tela e avisa", async () => {
    const { result } = renderHook(() => useAgendaEvents("c1", range));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    let ok = true;
    await act(async () => {
      ok = await result.current.reschedule("e1", new Date("2026-10-17T12:00:00Z"));
    });
    expect(ok).toBe(false);
    expect(result.current.events[0].scheduled_at).toBe("2026-10-16T12:00:00Z");
    expect(toast.error).toHaveBeenCalled();
  });

  it("excluir sem linha afetada mantém o compromisso", async () => {
    const { result } = renderHook(() => useAgendaEvents("c1", range));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    let ok = true;
    await act(async () => {
      ok = await result.current.remove("e1");
    });
    expect(ok).toBe(false);
    expect(result.current.events).toHaveLength(1);
  });

  it("compromisso que a pessoa não edita não é arrastável", () => {
    const event = { ...db.rows[0], address: null } as unknown as AgendaEvent;
    render(
      <TimeGridView
        days={[new Date("2026-10-16T00:00:00")]}
        events={[event]}
        conflicts={new Set()}
        onOpen={vi.fn()}
        onCreateAt={vi.fn()}
        onMove={vi.fn()}
        canEdit={() => false}
      />,
    );
    expect(screen.getByRole("button", { name: /treino/i })).toHaveAttribute("draggable", "false");
  });
});
