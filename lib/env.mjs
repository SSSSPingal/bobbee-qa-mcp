// Envs éphémères Bobbee seulement (mp-1234.feature.bobbee.co), branchés sur le pool Cognito dev (valeurs publiques de vue/src/env.ts).
export const POOL = { region: 'eu-west-3', userPoolId: 'eu-west-3_yhCfYCf1G', clientId: 'ijom0tgri9eug74n2ioado4be' };

const EPHEMERAL_RE = /^mp-\d{1,6}$/;

export function checkEnv(env) {
  const name = String(env ?? '').trim().toLowerCase();
  if (!EPHEMERAL_RE.test(name)) throw new Error(`env invalide : ${env} (éphémère seulement, ex. mp-1234)`);
  return name;
}

export const graphqlUrl = (env) => `https://${checkEnv(env)}.feature.bobbee.co/api/graphql`;
