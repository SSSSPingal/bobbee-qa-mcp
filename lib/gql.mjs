// Appels GraphQL vers un env éphémère Bobbee avec le token Cognito de l'utilisateur (ses droits, rien de plus).
import { getAccessToken } from './auth.mjs';
import { graphqlUrl } from './env.mjs';

// headers : en-têtes de contexte Bobbee (X-companyId, X-accountingFirmId, X-subUserId).
export async function gql(env, query, variables = {}, { headers = {}, timeoutMs = 60_000 } = {}) {
  const url = graphqlUrl(env);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await getAccessToken(), ...headers },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => null);
  if (body?.errors?.length) throw new Error(body.errors.map((e) => e.message).join(' ; '));
  if (!res.ok || !body?.data) throw new Error(`GraphQL ${new URL(url).host} : HTTP ${res.status}`);
  return body.data;
}
