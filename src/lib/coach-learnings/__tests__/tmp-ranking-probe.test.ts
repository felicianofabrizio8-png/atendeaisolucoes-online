import { describe, it } from "vitest";
import fs from "node:fs";
import { retrieveLearnings } from "../retriever";
const rows = JSON.parse(fs.readFileSync("/tmp/rows.json", "utf8"));
describe("probe 4.1 ranking com dados reais", () => {
  it("imprime ranking", () => {
    const res = retrieveLearnings({
      companyId: "3a7e989c-2e1c-425d-8fc6-0feecbeb48fd",
      candidates: rows,
      currentMessage: "Qual o preço da piscina de fibra 6 metros? Tem desconto à vista?",
      recentMessages: ["Boa tarde, quero orçamento"],
    } as never);
    for (const s of res.scored) {
      console.log(JSON.stringify({
        id: s.row?.id?.slice(0,8) ?? (s as never as {learningId:string}).learningId?.slice(0,8),
        score: s.finalScore, rank: s.rank, sel: s.selected ?? s.discardReason,
        reasons: s.matchedReasons, penalties: s.penalties,
        pos: s.row?.positive_feedback_count, neg: s.row?.negative_feedback_count, sr: s.row?.success_rate,
      }));
    }
    console.log("strategy", res.strategy);
  });
});
