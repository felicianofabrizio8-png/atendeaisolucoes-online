// Aba TEXTO — edição de título/sub/CTA + botões "Gerar nova sugestão IA" e
// "Restaurar texto original". Toda alteração atualiza o preview do editor.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";

const HEADLINE_MAX = 80;
const SUB_MAX = 120;
const CTA_MAX = 60;

interface Props {
  headline: string;
  subheadline: string;
  cta: string;
  onHeadline: (v: string) => void;
  onSubheadline: (v: string) => void;
  onCta: (v: string) => void;
  onRegenerate: () => void;
  onRestore: () => void;
  regenerating: boolean;
  disabled?: boolean;
}

export function TabTexto({
  headline,
  subheadline,
  cta,
  onHeadline,
  onSubheadline,
  onCta,
  onRegenerate,
  onRestore,
  regenerating,
  disabled,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="ov-headline">Título</Label>
          <span className="text-[10px] text-muted-foreground">
            {headline.length}/{HEADLINE_MAX}
          </span>
        </div>
        <Input
          id="ov-headline"
          value={headline}
          maxLength={HEADLINE_MAX}
          onChange={(e) => onHeadline(e.target.value)}
          disabled={disabled}
          placeholder="Ex.: Seu verão começa aqui"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="ov-sub">Subtítulo</Label>
          <span className="text-[10px] text-muted-foreground">
            {subheadline.length}/{SUB_MAX}
          </span>
        </div>
        <Textarea
          id="ov-sub"
          value={subheadline}
          maxLength={SUB_MAX}
          rows={2}
          onChange={(e) => onSubheadline(e.target.value)}
          disabled={disabled}
          placeholder="Ex.: Piscinas com qualidade e instalação rápida"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="ov-cta">Chamada (CTA)</Label>
          <span className="text-[10px] text-muted-foreground">
            {cta.length}/{CTA_MAX}
          </span>
        </div>
        <Input
          id="ov-cta"
          value={cta}
          maxLength={CTA_MAX}
          onChange={(e) => onCta(e.target.value)}
          disabled={disabled}
          placeholder="Ex.: Fale conosco"
        />
      </div>
      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={regenerating || disabled}
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          Gerar nova sugestão IA
        </Button>
        <Button variant="ghost" size="sm" onClick={onRestore} disabled={regenerating || disabled}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Restaurar original
        </Button>
      </div>
    </div>
  );
}
