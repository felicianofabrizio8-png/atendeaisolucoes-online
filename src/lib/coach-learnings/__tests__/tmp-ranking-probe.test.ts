import { describe, it } from "vitest";
import fs from "node:fs";
import { retrieveLearnings } from "../retriever";
const base = JSON.parse(fs.readFileSync("/tmp/rows.json", "utf8"));
const ctx = {
  companyId: "3a7e989c-2e1c-425d-8fc6-0feecbeb48fd",
  currentMessage: "Qual o preço da piscina de fibra 6 metros? Tem desconto à vista?",
  recentMessages: ["Boa tarde, quero orçamento"],
};
function run(rows: unknown[], label: string) {
  const res = retrieveLearnings({ ...ctx, candidates: rows } as never);
  console.log(label, res.scored.map((s: never) => ({
    id: JSON.stringify(s).slice(0,120),
    score: (s as {finalScore:number}).finalScore,
    rank: (s as {rank:number}).rank,
    pen: (s as {penalties:string[]}).penalties,
    reasons: (s as {matchedReasons:string[]}).matchedReasons,
  })));
}
describe("probe 4.1 sinal histórico", () => {
  it("poor_feedback_history aparece com histórico negativo robusto", () => {
    const rows = JSON.parse(JSON.stringify(base));
    const t = rows.find((r: {id:string}) => r.id.startsWith("d8f6749b"));
    t.positive_feedback_count = 1; t.negative_feedback_count = 12;
    t.feedback_sample_count = 13; t.success_rate = 0.12;
    run(rows, "NEG_HISTORY");
  });
  it("histórico positivo não faz regra irrelevante subir", () => {
    const rows = JSON.parse(JSON.stringify(base));
    const t = rows.find((r: {id:string}) => r.id.startsWith("6f456b2f"));
    t.positive_feedback_count = 40; t.negative_feedback_count = 0;
    t.feedback_sample_count = 40; t.success_rate = 0.98; t.confidence = 0.95;
    run(rows, "POS_IRRELEVANT");
  });
});
