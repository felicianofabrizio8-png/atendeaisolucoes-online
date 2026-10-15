// ============================================================================
// linkVideoToMarketingCampaign — extraído da rota render.complete p/ testes.
//
// Fase M3: um único job master pode estar registrado em `feed_render_job_id`
// E `story_render_job_id` da MESMA (ou diferente) linha de marketing_contents.
// Esta função varre AMBAS as colunas e grava o mesmo `video_id` em cada linha
// encontrada, permitindo que Feed e Story compartilhem o mesmo MP4.
//
// O vídeo do job que a linha referencia AGORA é sempre o que vale: quando o
// usuário edita e gera de novo, a linha passa a apontar para o job novo e, ao
// concluir, o vídeo novo substitui o anterior. (Antes, um `*_video_id` já
// preenchido nunca era trocado, e o conteúdo continuava publicando o vídeo
// antigo.) Um job antigo que conclua atrasado não sobrescreve nada: nenhuma
// linha aponta mais para ele. Repetir a chamada com o mesmo vídeo não altera
// nada (idempotente).
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface LinkResult {
  feedUpdated: string[]; // ids de marketing_contents que receberam feed_video_id
  storyUpdated: string[]; // ids que receberam story_video_id
}

export async function linkVideoToMarketingCampaign(
  admin: Admin,
  jobId: string,
  videoId: string,
): Promise<LinkResult> {
  const out: LinkResult = { feedUpdated: [], storyUpdated: [] };

  const { data: feedRows } = await admin
    .from("marketing_contents")
    .select("id, feed_video_id")
    .eq("feed_render_job_id", jobId);
  for (const r of (feedRows ?? []) as Array<{ id: string; feed_video_id: string | null }>) {
    if (r.feed_video_id !== videoId) {
      await admin
        .from("marketing_contents")
        .update({ feed_video_id: videoId })
        .eq("id", r.id)
        .eq("feed_render_job_id", jobId);
      out.feedUpdated.push(r.id);
    }
  }

  const { data: storyRows } = await admin
    .from("marketing_contents")
    .select("id, story_video_id")
    .eq("story_render_job_id", jobId);
  for (const r of (storyRows ?? []) as Array<{ id: string; story_video_id: string | null }>) {
    if (r.story_video_id !== videoId) {
      await admin
        .from("marketing_contents")
        .update({ story_video_id: videoId })
        .eq("id", r.id)
        .eq("story_render_job_id", jobId);
      out.storyUpdated.push(r.id);
    }
  }

  return out;
}
