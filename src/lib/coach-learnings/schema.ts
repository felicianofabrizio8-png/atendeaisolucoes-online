// Coach Learnings — client-safe schemas & types.
import { z } from "zod";

export const COACH_LEARNING_CATEGORIES = [
  "objection",
  "product_positioning",
  "pricing",
  "qualification",
  "closing",
  "followup",
  "tone",
  "process",
  "other",
] as const;

export type CoachLearningCategory = (typeof COACH_LEARNING_CATEGORIES)[number];

export const COACH_LEARNING_STATUSES = ["active", "paused", "archived"] as const;
export type CoachLearningStatus = (typeof COACH_LEARNING_STATUSES)[number];

export const CoachLearningDraftSchema = z.object({
  category: z.enum(COACH_LEARNING_CATEGORIES),
  product_ref: z.string().max(120).nullable().optional(),
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(2000),
  rule_structured: z.string().min(3).max(2000),
  positive_example: z.string().max(2000).nullable().optional(),
  negative_example: z.string().max(2000).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  confidence: z.number().min(0).max(1).default(0.7),
});

export type CoachLearningDraft = z.infer<typeof CoachLearningDraftSchema>;

export interface CoachLearningRow {
  id: string;
  company_id: string;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: CoachLearningStatus;
  confidence: number;
  usage_count: number;
  last_used_at: string | null;
  taught_by: string | null;
  source_conversation_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CoachLearningVersionRow {
  id: string;
  learning_id: string;
  version: number;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: string;
  confidence: number;
  edited_by: string | null;
  created_at: string;
}

export const TEACH_MODE_PROMPT_VERSION = "coach-teach-mode@2026-07-22.1";
