/** Guard exclusivo para o piloto local; não é usado pelas rotas de produção. */
export function isLocalOpenAiPilotCompanyEnabled(
  companyId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.OPENAI_LOCAL_PILOT_ENABLED === "enabled" &&
    Boolean(companyId) &&
    env.OPENAI_LOCAL_PILOT_COMPANY_ID === companyId
  );
}
