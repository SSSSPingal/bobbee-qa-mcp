// Connexion Cognito (pool dev) par email + mot de passe en SRP, comme le front Bobbee : le mot de passe sert à calculer
// une preuve, jamais envoyé ni stocké. Refresh token dans ~/.bobbee-test-data/session.json ; token d'accès en mémoire.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import cognitoIdentity from 'amazon-cognito-identity-js';
import { POOL } from './env.mjs';

const FILE = join(homedir(), '.bobbee-test-data', 'session.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LOGIN_HINT = 'appeler l\'outil bobbee_login (page de connexion dans le navigateur)';

const { AuthenticationDetails, CognitoUser, CognitoUserPool } = cognitoIdentity;

let access = null; // { token, exp }
let renewing = null; // renouvellement partagé par les appels simultanés

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});

function save(data) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(`${FILE}.tmp`, FILE);
}

// Stockage en mémoire pour la librairie Cognito (localStorage absent de Node).
function memoryStorage() {
  const items = new Map();
  return { setItem: (k, v) => items.set(k, v), getItem: (k) => items.get(k) ?? null, removeItem: (k) => items.delete(k), clear: () => items.clear() };
}

function srpLogin(email, password) {
  const Storage = memoryStorage();
  const user = new CognitoUser({ Username: email, Pool: new CognitoUserPool({ UserPoolId: POOL.userPoolId, ClientId: POOL.clientId, Storage }), Storage });
  user.setAuthenticationFlowType('USER_SRP_AUTH');
  return new Promise((resolve, rej) => {
    const extraStep = (name) => () => rej(new Error(`Cognito demande une étape en plus (${name}) : connecte-toi d'abord une fois dans l'app.`));
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      // Pool avec suivi des appareils : la clé d'appareil est exigée ensuite pour le refresh.
      onSuccess: (session) => resolve({ session, deviceKey: user.deviceKey ?? null }),
      onFailure: (e) => rej(['NotAuthorizedException', 'UserNotFoundException'].includes(e.code) ? new Error('Email ou mot de passe incorrect.') : e),
      newPasswordRequired: extraStep('NEW_PASSWORD_REQUIRED'),
      mfaRequired: extraStep('SMS_MFA'),
      totpRequired: extraStep('SOFTWARE_TOKEN_MFA'),
      mfaSetup: extraStep('MFA_SETUP'),
      selectMFAType: extraStep('SELECT_MFA_TYPE'),
      customChallenge: extraStep('CUSTOM_CHALLENGE'),
    });
  });
}

export async function login(email, password) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(address)) throw new Error('email invalide');
  if (!password) throw new Error('mot de passe manquant');
  const { session, deviceKey } = await srpLogin(address, password);
  save({ email: address, refreshToken: session.getRefreshToken().getToken(), deviceKey, connectedAt: new Date().toISOString() });
  return address;
}

// API Cognito directe : refresh et révocation.
async function idpRequest(action, payload) {
  const res = await fetch(`https://cognito-idp.${POOL.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Cognito : ${body.message ?? body.__type ?? `HTTP ${res.status}`}`), { code: body.__type });
  return body;
}

async function renew() {
  const data = load();
  if (!data.refreshToken) throw new Error(`Pas connecté à Bobbee : ${LOGIN_HINT}.`);
  const params = { REFRESH_TOKEN: data.refreshToken, ...(data.deviceKey ? { DEVICE_KEY: data.deviceKey } : {}) };
  try {
    const { AuthenticationResult: r } = await idpRequest('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: POOL.clientId, AuthParameters: params });
    access = { token: r.AccessToken, exp: Date.now() + r.ExpiresIn * 1000 };
    return access.token;
  } catch (e) {
    if (e.code !== 'NotAuthorizedException') throw e;
    save({ email: data.email });
    throw new Error(`Session Bobbee expirée : ${LOGIN_HINT}.`);
  }
}

// Token d'accès valide (marge d'une minute), renouvelé par le refresh token si besoin.
export async function getAccessToken() {
  if (access && access.exp - Date.now() > 60_000) return access.token;
  renewing ??= renew().finally(() => { renewing = null; });
  return renewing;
}

export async function logout() {
  const { refreshToken, email } = load();
  access = null;
  save({ email });
  if (refreshToken) await idpRequest('RevokeToken', { Token: refreshToken, ClientId: POOL.clientId }).catch(() => {});
}

export function authStatus() {
  const { email = null, refreshToken, connectedAt = null } = load();
  return { connected: !!refreshToken, email, connectedAt, ...(refreshToken ? {} : { hint: LOGIN_HINT }) };
}
