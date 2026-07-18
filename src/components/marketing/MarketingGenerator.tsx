// Marketing IA — entry point da geração.
// Fase C.1: o fluxo padrão agora é o de Campanha (Feed 4:5 + Story 9:16
// vinculados por campaign_id, com renderização opcional de vídeos).
// O componente antigo de 4 formatos ficou obsoleto; permanece o mesmo
// símbolo público `MarketingGenerator` para não quebrar imports existentes.

import { MarketingCampaignGenerator } from "./campaign/MarketingCampaignGenerator";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
  onGenerated?: (contents: MarketingContentRow[]) => void;
}

export function MarketingGenerator(props: Props) {
  return <MarketingCampaignGenerator {...props} />;
}
