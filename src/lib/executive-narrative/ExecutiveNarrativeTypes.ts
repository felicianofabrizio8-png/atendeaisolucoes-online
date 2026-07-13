// Tipos da narrativa executiva gerada por IA.
// 100% READ-ONLY: apenas formato de resposta produzido a partir do snapshot.

export interface ExecutiveNarrative {
  greeting: string;
  summary: string;
  priorities: string[];
  opportunities: string[];
  risks: string[];
  nextAction: string;
  generatedAt: string;
  snapshotGeneratedAt: string;
  model: string;
}
