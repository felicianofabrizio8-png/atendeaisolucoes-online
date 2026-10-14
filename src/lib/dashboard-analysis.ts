import { z } from "zod";

export const chartContextSchema = z.object({
  title: z.string().min(1).max(160),
  period: z.string().max(200),
  notes: z.string().max(2000),
  columns: z.array(z.string().max(100)).min(1).max(8),
  rows: z.array(z.array(z.string().max(300)).max(8)).max(180),
});
export type ChartContext = z.infer<typeof chartContextSchema>;
export const chartRequestSchema = z.object({
  context: chartContextSchema,
  question: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(12),
});
