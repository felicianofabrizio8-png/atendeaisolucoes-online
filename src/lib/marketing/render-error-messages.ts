// Dicionário de mensagens amigáveis para códigos de erro do render/worker.
// Usado por toasts e pela barra de progresso quando um job falha.

const MAP: Record<string, string> = {
  // Fonte de imagem
  source_image_not_found: "A imagem selecionada não foi encontrada. Escolha outra.",
  image_cross_tenant: "A imagem selecionada não pertence à sua empresa.",
  image_inactive: "A imagem selecionada foi desativada. Escolha outra.",
  image_wrong_type: "O arquivo selecionado não é uma imagem válida.",
  source_product_not_found: "O produto selecionado não foi encontrado.",
  product_cross_tenant: "A imagem de produto não pertence à sua empresa.",
  product_inactive: "O produto selecionado está desativado.",
  product_image_not_owned: "Esta imagem de produto não está mais disponível.",
  product_image_path_invalid: "Caminho da imagem de produto inválido.",
  product_image_cross_tenant_path: "A imagem de produto pertence a outra empresa.",
  source_product_image_incomplete: "Dados incompletos da imagem de produto.",

  // Fonte de áudio
  source_audio_not_found: "O áudio selecionado não foi encontrado.",
  audio_cross_tenant: "O áudio selecionado não pertence à sua empresa.",
  audio_inactive: "O áudio selecionado foi desativado.",
  audio_range_out_of_bounds: "O trecho de áudio escolhido excede a duração da música.",
  audio_offset_invalid: "O início do áudio é inválido.",
  audio_duration_invalid: "A duração do vídeo é inválida.",

  // Assinatura de URL / storage
  image_sign_failed: "Não foi possível preparar a imagem para renderização.",
  audio_sign_failed: "Não foi possível preparar o áudio para renderização.",
  upload_sign_failed: "Não foi possível preparar o envio do vídeo final.",

  // Worker / FFmpeg
  ffmpeg_timeout: "A renderização demorou demais e foi interrompida. Tente novamente.",
  render_output_missing_audio: "O vídeo foi gerado sem áudio audível. Tente outro trecho.",
  render_dimensions_mismatch: "As dimensões do vídeo não bateram com o formato.",
  render_duration_mismatch: "A duração do vídeo ficou diferente do esperado.",
  render_codec_invalid: "O vídeo foi gerado em um formato inválido.",
  download_http_403: "Um dos arquivos de origem expirou. Reenfileire o vídeo.",
  download_http_404: "Um dos arquivos de origem não foi encontrado.",

  // Validações de contrato
  audio_slice_exceeds_duration: "O trecho de áudio ultrapassa a duração da música.",
  duration_seconds_not_allowed: "Duração de vídeo não permitida.",
  campaign_missing_primary_audio: "A campanha está sem áudio principal.",
  campaign_missing_primary_image: "A campanha está sem imagem principal.",
  campaign_role_not_found: "Não encontramos o formato solicitado da campanha.",
  ai_missing_feed_or_story: "A IA não gerou textos para Feed e Story.",
  image_not_found: "Imagem não encontrada.",
  product_not_found: "Produto não encontrado.",
  audio_not_found: "Áudio não encontrado.",

  // Genéricos
  unauthorized: "Sessão expirada. Faça login novamente.",
  internal_error: "Falha interna. Tente novamente em instantes.",
  invalid_payload: "Dados enviados são inválidos. Revise e tente de novo.",
};

/** Traduz `code` → mensagem PT-BR. Se desconhecido, devolve fallback amigável. */
export function friendlyRenderError(codeOrMessage: string | null | undefined): string {
  if (!codeOrMessage) return "Não foi possível concluir a operação.";
  const key = codeOrMessage.trim().split(":")[0]?.slice(0, 80) ?? "";
  return (
    MAP[key] ??
    // Fallback: se o worker enviou algo humanamente legível já, mostra.
    (codeOrMessage.length <= 140
      ? codeOrMessage
      : "Ocorreu um erro na renderização do vídeo.")
  );
}
