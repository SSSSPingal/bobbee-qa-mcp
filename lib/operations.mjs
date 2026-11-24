// Opérations GraphQL du front (vue/src/**/*.gql) à la branche de l'éphémère : la forme d'appel réelle de l'app.
// Recherche par nom de fichier (une requête pour la liste, gardée par commit), puis lecture des fichiers retenus.
import { checkEnv } from './env.mjs';
import { REPO, gh, rawFiles, resolveBranch } from './github.mjs';

const MAX_FILES = 8;
const lists = new Map(); // sha -> chemins des .gql

async function gqlPaths(sha) {
  if (!lists.has(sha)) {
    const { tree, truncated } = await gh(`${REPO}/git/trees/${sha}:vue/src?recursive=1`);
    if (truncated) console.error('[bobbee-test-data] liste des .gql du front tronquée par GitHub');
    lists.set(sha, tree.filter((f) => f.type === 'blob' && f.path.endsWith('.gql')).map((f) => `vue/src/${f.path}`));
  }
  return lists.get(sha);
}

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1, -'.gql'.length).toLowerCase();

export async function searchOperations({ env, search, branch }) {
  const { branch: name, sha } = await resolveBranch(checkEnv(env), branch);
  const terms = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error('search vide');
  const term = terms.join('');
  const found = (await gqlPaths(sha)).filter((p) => terms.every((t) => p.toLowerCase().includes(t)))
    .sort((a, b) => (baseName(b) === term) - (baseName(a) === term) || a.length - b.length);
  const files = await rawFiles(found.slice(0, MAX_FILES), sha);
  return { branch: name, sha, total: found.length, truncated: found.length > MAX_FILES, files, ...(found.length > MAX_FILES ? { others: found.slice(MAX_FILES, 40) } : {}) };
}
