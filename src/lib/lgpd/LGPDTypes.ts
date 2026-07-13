// ============================================================================
// LGPD — tipos preparatórios (Fase 1: apenas contratos, sem execução real).
// ============================================================================

export interface LGPDExportRequest {
  companyId: string;
  requestedBy: string;
  dryRun?: boolean;
}

export interface LGPDDeleteRequest {
  companyId: string;
  requestedBy: string;
  reason?: string;
  dryRun?: boolean;
}

export interface LGPDAnonymizeRequest {
  companyId: string;
  leadId: string;
  requestedBy: string;
  dryRun?: boolean;
}

export interface LGPDRetentionRun {
  companyId?: string;
  dryRun?: boolean;
}

export interface LGPDDryRunReport {
  companyId: string;
  action: "export" | "delete" | "anonymize" | "retention";
  wouldTouch: Record<string, number>;
  notes: string[];
}
