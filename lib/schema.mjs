// Schéma de Bobbee lu sur GitHub à la branche de l'éphémère (introspection coupée côté serveur) : définitions GraphQL
// écrites à la main, plus les enums et modèles Prisma (types et CRUD générés absents du dépôt). En mémoire par commit.
import { Kind, parse, print } from 'graphql';
import { checkEnv } from './env.mjs';
import { REPO, gh, rawFiles, resolveBranch } from './github.mjs';

// Les fichiers par domaine passent avant schema.graphql (agrégat pas toujours à jour).
const GRAPHQL_DIR = 'backend/prisma/graphql';
const GRAPHQL_EXTRA = ['backend/schema.graphql', 'backend/schemaStart.graphql'];
const PRISMA_DIR = 'backend/prisma/schema';
const ROOTS = new Set(['Query', 'Mutation', 'Subscription']);
const PRISMA_BLOCK_RE = /^(enum|model|type)\s+(\w+)\s*\{[\s\S]*?^\}/gm;
const MAX_MATCHES = 30;
const MAX_CHARS = 30_000;

const cache = new Map(); // sha -> entrées du schéma

const TYPE_KINDS = {
  [Kind.OBJECT_TYPE_DEFINITION]: 'type', [Kind.OBJECT_TYPE_EXTENSION]: 'extend type', [Kind.INPUT_OBJECT_TYPE_DEFINITION]: 'input',
  [Kind.ENUM_TYPE_DEFINITION]: 'enum', [Kind.SCALAR_TYPE_DEFINITION]: 'scalar', [Kind.UNION_TYPE_DEFINITION]: 'union', [Kind.INTERFACE_TYPE_DEFINITION]: 'interface',
};

function add(entries, item) {
  const key = `${item.kind}:${item.name}`;
  if (!entries.has(key)) entries.set(key, item);
}

// Une entrée par champ de Query/Mutation et par type ; la première définition d'un nom l'emporte.
function addGraphql(entries, file, source) {
  for (const def of parse(source, { noLocation: true }).definitions) {
    const name = def.name?.value;
    if (!name) continue;
    if (ROOTS.has(name)) for (const f of def.fields ?? []) add(entries, { kind: name, name: f.name.value, file, sdl: print(f) });
    else add(entries, { kind: TYPE_KINDS[def.kind] ?? def.kind, name, file, sdl: print(def) });
  }
}

function addPrisma(entries, file, source) {
  for (const [sdl, kind, name] of source.matchAll(PRISMA_BLOCK_RE)) add(entries, { kind: `prisma ${kind}`, name, file, sdl });
}

const listDir = async (dir, sha, ext) => (await gh(`${REPO}/contents/${dir}?ref=${sha}`))
  .filter((f) => f.type === 'file' && f.name.endsWith(ext)).map((f) => f.path);

async function loadSchema(sha) {
  if (cache.has(sha)) return cache.get(sha);
  const [graphqlFiles, prismaFiles] = await Promise.all([listDir(GRAPHQL_DIR, sha, '.graphql'), listDir(PRISMA_DIR, sha, '.prisma')]);
  const sources = await rawFiles([...graphqlFiles, ...GRAPHQL_EXTRA, ...prismaFiles], sha);
  const entries = new Map();
  const skipped = [];
  for (const { path, source } of sources) {
    try {
      if (source === null) skipped.push(path);
      else if (path.endsWith('.prisma')) addPrisma(entries, path, source);
      else addGraphql(entries, path, source);
    } catch (e) { skipped.push(`${path} (${e.message})`); }
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
  const term = terms.join(' ');
  found.sort((a, b) => rank(a, term) - rank(b, term) || a.name.localeCompare(b.name));
  const matches = [];
  let chars = 0;
  for (const e of found) {
    if (matches.length >= MAX_MATCHES || (matches.length && chars + e.sdl.length > MAX_CHARS)) break;
    // Un gros modèle Prisma seul est coupé plutôt qu'écarté.
    matches.push(e.sdl.length > MAX_CHARS ? { ...e, sdl: `${e.sdl.slice(0, MAX_CHARS)}\n… (coupé)` } : e);
    chars += e.sdl.length;
  }
  return { branch: name, sha, total: found.length, truncated: matches.length < found.length, matches, ...(skipped.length ? { skipped } : {}) };
}
