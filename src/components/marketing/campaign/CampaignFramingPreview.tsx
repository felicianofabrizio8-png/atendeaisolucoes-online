// Pré-visualização de enquadramento para Feed (4:5) e Story (9:16) a partir
// de uma URL de imagem já resolvida. O comportamento é "cover" — a imagem
// preenche a moldura, cortando bordas quando necessário.
//
// Não faz cropping real; apenas exibe como o worker de render vai enquadrar.
// O worker segue o mesmo "cover" para preencher 1080x1350 (feed) e 1080x1920 (story).

interface Props {
  imageUrl: string | null;
  className?: string;
}

export function CampaignFramingPreview({ imageUrl, className }: Props) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${className ?? ""}`}>
      <FrameBox label="Feed 4:5 (1080×1350)" aspect="4 / 5" imageUrl={imageUrl} />
      <FrameBox label="Story 9:16 (1080×1920)" aspect="9 / 16" imageUrl={imageUrl} />
    </div>
  );
}

function FrameBox({
  label,
  aspect,
  imageUrl,
}: {
  label: string;
  aspect: string;
  imageUrl: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className="relative overflow-hidden rounded-md border bg-muted"
        style={{ aspectRatio: aspect }}
        data-testid={`framing-${aspect.replace(/\s/g, "")}`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Enquadramento ${label}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Selecione uma imagem
          </div>
        )}
      </div>
    </div>
  );
}
