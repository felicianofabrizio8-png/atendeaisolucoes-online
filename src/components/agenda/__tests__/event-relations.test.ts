import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ops: [] as Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }>,
  fail: null as null | string,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const record = { table, op: "", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      const builder: Record<string, unknown> = {};
      builder.delete = () => {
        record.op = "delete";
        db.ops.push(record);
        return builder;
      };
      builder.insert = (payload: unknown) => {
        record.op = "insert";
        record.payload = payload;
        db.ops.push(record);
        return builder;
      };
      for (const method of ["eq", "in"])
        builder[method] = (column: string, value: unknown) => {
          record.filters.push([`${method}:${column}`, value]);
          return builder;
        };
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: db.fail && record.table === db.fail ? { message: "x" } : null }).then(
          resolve,
        );
      return builder;
    },
  },
}));
import { emptyForm, saveEventRelations } from "../event-form";

beforeEach(() => {
  db.ops = [];
  db.fail = null;
});

const members = [
  { id: "u2", name: "Bruno" },
  { id: "u3", name: "Carla" },
];

describe("tags e participantes ao salvar", () => {
  it("mexe só no que mudou e nunca em tag pessoal de outra pessoa", async () => {
    const form = {
      ...emptyForm(),
      title: "x",
      scope: "equipe" as const,
      // t-alheia veio do evento (tag pessoal do funcionário) e continua no formulário.
      tagIds: ["t-empresa", "t-alheia", "t-nova"],
      participantIds: ["u2", "u3"],
    };
    await saveEventRelations("e1", form, "c1", members, {
      previous: { tagIds: ["t-empresa", "t-alheia", "t-velha"], participantIds: ["u2", "u9"] },
      editableTagIds: new Set(["t-empresa", "t-nova", "t-velha"]),
    });
    const tagDelete = db.ops.find((op) => op.table === "agenda_event_tags" && op.op === "delete")!;
    expect(tagDelete.filters).toContainEqual(["in:tag_id", ["t-velha"]]);
    const tagInsert = db.ops.find((op) => op.table === "agenda_event_tags" && op.op === "insert")!;
    expect((tagInsert.payload as Array<{ tag_id: string }>).map((row) => row.tag_id)).toEqual(["t-nova"]);
    const peopleDelete = db.ops.find((op) => op.table === "agenda_event_participants" && op.op === "delete")!;
    expect(peopleDelete.filters).toContainEqual(["in:user_id", ["u9"]]);
    expect(peopleDelete.filters).toContainEqual(["eq:role", "participante"]);
    const peopleInsert = db.ops.find((op) => op.table === "agenda_event_participants" && op.op === "insert")!;
    expect((peopleInsert.payload as Array<{ user_id: string }>).map((row) => row.user_id)).toEqual(["u3"]);
  });

  it("sem mudança, não toca em nada; compromisso pessoal não mexe em participantes", async () => {
    const form = { ...emptyForm(), title: "x", scope: "pessoal" as const, tagIds: ["t1"], participantIds: [] };
    await saveEventRelations("e1", form, "c1", members, {
      previous: { tagIds: ["t1"], participantIds: ["u2"] },
      editableTagIds: new Set(["t1"]),
    });
    expect(db.ops).toEqual([]);
  });

  it("erro do banco vira exceção (para a tela avisar)", async () => {
    db.fail = "agenda_event_tags";
    const form = { ...emptyForm(), title: "x", tagIds: ["t1"] };
    await expect(
      saveEventRelations("e1", form, "c1", members, {
        previous: { tagIds: [], participantIds: [] },
        editableTagIds: new Set(["t1"]),
      }),
    ).rejects.toThrow();
  });
});
