// Page de connexion locale et temporaire : formulaire email + mot de passe ouvert dans le navigateur, le mot de passe
// ne passe jamais par la conversation. 127.0.0.1, port libre, jeton à usage unique, fermée après connexion ou 5 min.
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { login } from './auth.mjs';

const TIMEOUT_MS = 5 * 60_000;
const MAX_BODY = 10_000;

let current = null; // { server, timer }

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connexion Bobbee QA</title>
<style>body{font-family:system-ui;max-width:360px;margin:60px auto;padding:0 16px;color:#222}input,button{width:100%;box-sizing:border-box;padding:10px;margin:6px 0;font-size:15px}
button{background:#0a7cff;color:#fff;border:0;border-radius:6px;cursor:pointer}.err{color:#c00}</style>${body}`);
}

const form = (token, email = '', error = '') => `<h2>Connexion à Bobbee (dev)</h2>
<p>Ton compte Bobbee de dev, qui sert aussi aux envs éphémères.</p>${error ? `<p class="err">${escape(error)}</p>` : ''}
<form method="post" action="/login"><input type="hidden" name="t" value="${token}">
<input name="email" type="email" placeholder="Email" value="${escape(email)}" required autofocus>
<input name="password" type="password" placeholder="Mot de passe" required><button>Se connecter</button></form>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > MAX_BODY) { reject(new Error('trop long')); req.destroy(); } });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function stop() {
  if (!current) return;
  clearTimeout(current.timer);
  current.server.close();
  current = null;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

// Ouvre la page dans le navigateur ; renvoie l'adresse à donner à l'utilisateur si le navigateur ne s'ouvre pas.
export async function startLoginPage() {
  stop();
  const token = randomBytes(24).toString('base64url');
  const sameToken = (t) => typeof t === 'string' && t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || url.pathname !== '/login') return page(res, 404, '<p>Introuvable.</p>');
    if (req.method === 'GET') return sameToken(url.searchParams.get('t')) ? page(res, 200, form(token)) : page(res, 403, '<p>Lien expiré : redemande la connexion à Claude.</p>');
    if (req.method !== 'POST') return page(res, 405, '<p>Méthode refusée.</p>');
    let params = new URLSearchParams();
    try {
      params = await readBody(req);
      if (!sameToken(params.get('t'))) return page(res, 403, '<p>Lien expiré : redemande la connexion à Claude.</p>');
      const email = await login(params.get('email'), params.get('password'));
      page(res, 200, `<h2>Connecté</h2><p>Connecté en ${escape(email)}. Tu peux fermer cet onglet et revenir à Claude.</p>`);
      stop();
    } catch (e) {
      page(res, 200, form(token, params.get('email'), e.message));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  current = { server, timer: setTimeout(stop, TIMEOUT_MS) };
  const url = `http://127.0.0.1:${server.address().port}/login?t=${token}`;
  openBrowser(url);
  return { url, expiresInMinutes: TIMEOUT_MS / 60_000, next: "Page ouverte dans le navigateur : se connecter, puis vérifier avec bobbee_status." };
}
