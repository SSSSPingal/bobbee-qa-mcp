// Lecture du dépôt app-bobbee sur GitHub via la CLI gh de l'utilisateur (accès à OSS360/app-bobbee requis).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const REPO = 'repos/OSS360/app-bobbee';
const BRANCH_KINDS = ['feature', 'bugfix', 'hotfix'];

export async function gh(path, { raw = false } = {}) {
  const args = ['api', ...(raw ? ['-H', 'Accept: application/vnd.github.raw+json'] : []), path];
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    return raw ? stdout : JSON.parse(stdout);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('CLI gh introuvable : installe GitHub CLI puis « gh auth login »');
    throw new Error(`GitHub (${path}) : ${(e.stderr || e.message).trim()}`);
  }
}

export const rawFile = (path, sha) => gh(`${REPO}/contents/${path}?ref=${sha}`, { raw: true });

// Fichiers lus par lots de 6 ; un fichier illisible vaut null.
export async function rawFiles(paths, sha) {
  const out = [];
  for (let i = 0; i < paths.length; i += 6) {
    out.push(...await Promise.all(paths.slice(i, i + 6).map(async (path) => ({ path, source: await rawFile(path, sha).catch(() => null) }))));
  }
  return out;
}

// Branche du ticket de l'éphémère (feature|bugfix|hotfix/mp-1234[/slug]), ou celle donnée.
export async function resolveBranch(env, branch) {
  if (branch) return { branch, sha: (await gh(`${REPO}/git/ref/heads/${branch}`)).object.sha };
  const lists = await Promise.all(BRANCH_KINDS.map((kind) => gh(`${REPO}/git/matching-refs/heads/${kind}/${env}`)));
  const refs = lists.flat().map((r) => ({ branch: r.ref.replace('refs/heads/', ''), sha: r.object.sha }))
    .filter((r) => r.branch.endsWith(`/${env}`) || r.branch.includes(`/${env}/`));
  if (refs.length === 1) return refs[0];
  if (!refs.length) throw new Error(`aucune branche trouvée pour ${env} : passer branch`);
  throw new Error(`plusieurs branches pour ${env} : ${refs.map((r) => r.branch).join(', ')} ; passer branch`);
}
