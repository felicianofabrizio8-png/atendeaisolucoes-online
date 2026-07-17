import { useState } from "react";
import { VideoRenderForm } from "./VideoRenderForm";
import { VideoRenderJobs } from "./VideoRenderJobs";

interface Props {
  companyId: string;
}

export function VideoRenderPanel({ companyId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-4">
      <VideoRenderForm companyId={companyId} onCreated={() => setRefreshKey((k) => k + 1)} />
      <VideoRenderJobs companyId={companyId} refreshKey={refreshKey} />
      <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>MVP:</strong> imagem estática + áudio. Um worker externo (Node + FFmpeg em container)
        processa a fila e faz upload do MP4. Enquanto o worker não estiver ativo, os jobs
        permanecerão em "Na fila".
      </div>
    </div>
  );
}
