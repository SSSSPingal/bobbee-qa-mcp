// Schéma GraphQL de Bobbee lu sur GitHub à la branche de l'éphémère (introspection coupée côté serveur).
// Passe par la CLI gh de l'utilisateur (accès à OSS360/app-bobbee requis) ; schéma gardé en mémoire par commit.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Kind, parse, print } from 'graphql';
import { checkEnv } from './env.mjs';

const run = promisify(execFile);
const REPO = 'repos/OSS360/app-bobbee';
const BRANCH_KINDS = ['feature', 'bugfix', 'hotfix'];
// Sources du schéma ; les fichiers par domaine passent avant schema.graphql (agrégat pas toujours à jour).
const SCHEMA_DIR = 'backend/prisma/graphql';
const EXTRA_FILES = ['backend/schema.graphql', 'backend/schemaStart.graphql'];
const ROOTS = new Set(['Query', 'Mutation', 'Subscription']);
const MAX_MATCHES = 30;
const MAX_CHARS = 30_000;

const cache = new Map(); // sha -> entrées du schéma

async function gh(path, { raw = false } = {}) {
  const args = ['api', ...(raw ? ['-H', 'Accept: application/vnd.github.raw+json'] : []), path];
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    return raw ? stdout : JSON.parse(stdout);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('CLI gh introuvable : installe GitHub CLI puis « gh auth login »');
    throw new Error(`GitHub (${path}) : ${(e.stderr || e.message).trim()}`);
  }
}

// Branche du ticket de l'éphémère (feature|bugfix|hotfix/mp-1234[/slug]), ou celle donnée.
async function resolveBranch(env, branch) {
  if (branch) return { branch, sha: (await gh(`${REPO}/git/ref/heads/${branch}`)).object.sha };
  const lists = await Promise.all(BRANCH_KINDS.map((kind) => gh(`${REPO}/git/matching-refs/heads/${kind}/${env}`)));
  const refs = lists.flat().map((r) => ({ branch: r.ref.replace('refs/heads/', ''), sha: r.object.sha }))
    .filter((r) => r.branch.endsWith(`/${env}`) || r.branch.includes(`/${env}/`));
  if (refs.length === 1) return refs[0];
  if (!refs.length) throw new Error(`aucune branche trouvée pour ${env} : passer branch`);
  throw new Error(`plusieurs branches pour ${env} : ${refs.map((r) => r.branch).join(', ')} ; passer branch`);
}

const TYPE_KINDS = {
  [Kind.OBJECT_TYPE_DEFINITION]: 'type', [Kind.OBJECT_TYPE_EXTENSION]: 'extend type', [Kind.INPUT_OBJECT_TYPE_DEFINITION]: 'input',
  [Kind.ENUM_TYPE_DEFINITION]: 'enum', [Kind.SCALAR_TYPE_DEFINITION]: 'scalar', [Kind.UNION_TYPE_DEFINITION]: 'union', [Kind.INTERFACE_TYPE_DEFINITION]: 'interface',
};

// Une entrée par champ de Query/Mutation et par type ; la première définition d'un nom l'emporte.
function addEntries(entries, file, source) {
  for (const def of parse(source, { noLocation: true }).definitions) {
    const name = def.name?.value;
    if (!name) continue;
    const items = ROOTS.has(name)
      ? (def.fields ?? []).map((f) => ({ kind: name, name: f.name.value, file, sdl: print(f) }))
      : [{ kind: TYPE_KINDS[def.kind] ?? def.kind, name, file, sdl: print(def) }];
    for (const item of items) {
      const key = `${item.kind}:${item.name}`;
      if (!entries.has(key)) entries.set(key, item);
    }
  }
}

async function loadSchema(sha) {
  if (cache.has(sha)) return cache.get(sha);
  const dir = await gh(`${REPO}/contents/${SCHEMA_DIR}?ref=${sha}`);
  const files = [...dir.filter((f) => f.type === 'file' && f.name.endsWith('.graphql')).map((f) => f.path), ...EXTRA_FILES];
  const sources = [];
  for (let i = 0; i < files.length; i += 6) {
    const chunk = files.slice(i, i + 6);
    sources.push(...await Promise.all(chunk.map(async (path) => ({ path, source: await gh(`${REPO}/contents/${path}?ref=${sha}`, { raw: true }).catch(() => null) }))));
  }
  const entries = new Map();
  const skipped = [];
  for (const { path, source } of sources) {
    try { if (source !== null) addEntries(entries, path, source); else skipped.push(path); }
    catch (e) { skipped.push(`${path} (${e.message})`); }
  }
  const schema = { entries: [...entries.values()], skipped };
  cache.set(sha, schema);
  return schema;
}

const rank = (e, term) => (e.name.toLowerCase() === term ? 0 : ROOTS.has(e.kind) ? 1 : 2);

// Recherche par nom (tous les mots), à défaut dans le texte des définitions.
export async function searchSchema({ env, search, branch }) {
  const { branch: name, sha } = await resolveBranch(checkEnv(env), branch);
  const { entries, skipped } = await loadSchema(sha);
  const terms = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error('search vide');
  const has = (text) => terms.every((t) => text.toLowerCase().includes(t));
  let found = entries.filter((e) => has(e.name));
  if (!found.length) found = entries.filter((e) => has(e.sdl));
  found.sort((a, b) => rank(a, terms.join(' ')) - rank(b, terms.join(' ')) || a.name.localeCompare(b.name));
  const matches = [];
  let chars = 0;
  for (const e of found) {
    if (matches.length >= MAX_MATCHES || chars + e.sdl.length > MAX_CHARS) break;
    matches.push(e);
    chars += e.sdl.length;
  }
  return { branch: name, sha, total: found.length, truncated: matches.length < found.length, matches, ...(skipped.length ? { skipped } : {}) };
}
