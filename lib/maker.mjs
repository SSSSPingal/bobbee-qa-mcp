// Création de dossiers sur un env éphémère : même enchaînement que l'écran « Dossiers clients » de l'app,
// en-têtes X-companyId vide et X-accountingFirmId = cabinet. Tâches en mémoire (perdues au redémarrage du MCP).
import { randomUUID } from 'node:crypto';
import { checkEnv } from './env.mjs';
import { gql } from './gql.mjs';
import * as Q from './maker.gql.mjs';
import { STOCK_FORMAT_WARNING, accountingPeriods, batchNames, checkId, checkTemplate, companyVariables, defaultOffer, defaultRofs, periodVariables, stockVariables } from './maker.helpers.mjs';

const jobs = new Map(); // id -> tâche de création
const PARALLEL = 3; // ménage les petites bases des éphémères
const MAX_USERS = 20;

// Cabinets où je peux créer : le mien et ceux de mes sous-utilisateurs (sélecteur de cabinet de l'app).
export async function makerFirms({ env }) {
  const { meUserDetails: me } = await gql(env, Q.ME_FIRMS);
  const firms = [{ subUserId: null, company: me.company }, ...(me.subUsers ?? []).map((s) => ({ subUserId: s.id, company: s.company }))]
    .filter((f) => f.company?.accountingFirm)
    .map(({ subUserId, company }) => ({ id: company.id, name: company.name, subUserId, priceList: company.bobbeePriceList ?? null }));
  return { env: checkEnv(env), meId: me.id, me: { id: me.id, email: me.email, firstname: me.firstname, lastname: me.lastname }, firms };
}

async function findFirm(env, firmId) {
  checkId(firmId, 'cabinet');
  const firm = (await makerFirms({ env })).firms.find((f) => f.id === firmId);
  if (!firm) throw new Error('cabinet hors de ton périmètre');
  return firm;
}

export const firmHeaders = (firm) => ({ 'X-companyId': '', 'X-accountingFirmId': firm.id, ...(firm.subUserId ? { 'X-subUserId': firm.subUserId } : {}) });

async function firmLists(env, firm) {
  const headers = firmHeaders(firm);
  const [{ users }, { candidateAccountableAccountTables: tables }] = await Promise.all([
    gql(env, Q.FIRM_USERS, { companyId: firm.id }, { headers }),
    gql(env, Q.CANDIDATE_TABLES, { companyId: '' }, { headers }),
  ]);
  return { users, accountTables: tables.map((t) => ({ id: t.id, name: t.name, owner: t.companyScope?.accountingCompanyOwner?.name ?? null })) };
}

// Pour un cabinet : utilisateurs à rattacher, plans comptables de référence, offre par défaut.
export async function makerFirmOptions({ env, firmId }) {
  const firm = await findFirm(env, firmId);
  return { firm, defaultOffer: defaultOffer(firm.priceList), ...(await firmLists(env, firm)) };
}

// Une étape d'un dossier : tracée dans la tâche ; l'erreur arrête ce dossier, sauf étape facultative (warning).
async function step(item, label, run, { warning } = {}) {
  const entry = { label, state: 'running' };
  item.steps.push(entry);
  try { await run(); entry.state = 'done'; }
  catch (e) {
    if (!warning) { entry.state = 'failed'; throw new Error(`${label} : ${e.message}`); }
    entry.state = 'warn';
    item.warnings.push(`${warning} (${e.message})`);
  }
}

async function createOne(job, item, t, table) {
  const { env, firm, users } = job;
  const call = (query, variables) => gql(env, query, variables, { headers: firmHeaders(firm) });
  let profileId;
  await step(item, 'Dossier', async () => {
    const { upsertCompany } = await call(Q.UPSERT_COMPANY, companyVariables(t, item.name, firm.id));
    item.companyId = upsertCompany.id;
    profileId = upsertCompany.profile?.id;
  });
  // Plan comptable avant le rattachement au cabinet : le back n'accepte qu'un dossier « en création » à ce stade.
  await step(item, 'Plan comptable', () => call(Q.CREATE_ACCOUNT_TABLE, { companyId: item.companyId, referenceAccountableAccountTableId: table.id, salesAccounts: [] }));
  await step(item, 'Options', () => call(Q.UPSERT_PROFILE_COMPANY, { id: profileId ?? '', companyId: item.companyId, accountingType: t.accountingType, rofs: defaultRofs(t), ...t.options }));
  if (t.stock.enabled) {
    await step(item, t.stock.agriFeatures ? 'Stock & agri' : 'Stock', () => call(Q.UPSERT_STOCK_SETTINGS, stockVariables(t, profileId ?? '', item.companyId)), { warning: STOCK_FORMAT_WARNING });
  }
  await step(item, 'Offre', () => call(Q.UPDATE_FIRM_CLIENT, { offer: t.offer, isTraining: t.isTraining, clientId: item.companyId, accountingFirmId: firm.id }));
  await step(item, 'Rattachement au cabinet', () => call(Q.ADD_CLIENT_TO_FIRM, { id: firm.id, companies: [item.companyId] }));
  for (const user of users) await step(item, `Accès ${user.email}`, () => call(Q.USER_ADD_COMPANY, { userId: user.id, companyId: item.companyId }));
  if (t.createPeriod) {
    const periods = accountingPeriods(t);
    for (const [i, period] of periods.entries()) {
      await step(item, periods.length > 1 ? `Exercice ${i + 1} (${period.start} → ${period.end})` : 'Premier exercice', () => call(Q.UPSERT_ACCOUNTING_PERIOD, periodVariables(period, item.companyId)));
    }
  }
  // L'app me rattache d'office (addClientToCompanies) : retrait en dernier si demandé.
  if (!job.attachMe) await step(item, 'Retrait de mon accès', () => call(Q.USER_REMOVE_COMPANY, { userId: job.actingUserId, companyId: item.companyId }));
}

async function runItem(job, item, t, table) {
  item.state = 'running';
  try { await createOne(job, item, t, table); item.state = 'done'; }
  catch (e) { item.state = 'failed'; item.error = e.message; }
}

async function runJob(job, t, table) {
  const queue = [...job.items];
  const worker = async () => { for (let item = queue.shift(); item; item = queue.shift()) await runItem(job, item, t, table); };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  job.state = job.items.some((i) => i.state === 'failed') ? 'failed' : 'done';
  job.finishedAt = new Date().toISOString();
}

// Lance la création en arrière-plan ; suivie par makerJob.
export async function startMakerCreation({ env, firmId, userIds = [], attachMe = true, prefix, count, values }) {
  const name = checkEnv(env);
  const t = checkTemplate(values ?? {});
  const names = batchNames(prefix, t.name, count);
  const { firms, meId } = await makerFirms({ env: name });
  const firm = firms.find((f) => f.id === checkId(firmId, 'cabinet'));
  if (!firm) throw new Error('cabinet hors de ton périmètre');
  if (firm.priceList?.scope !== 'EXPERT') throw new Error('cabinet hors grille EXPERT : création non gérée');
  const { users, accountTables } = await firmLists(name, firm);
  const table = accountTables.find((a) => a.name === t.accountTableName);
  if (!table) throw new Error(`plan comptable « ${t.accountTableName} » introuvable pour ce cabinet`);
  if (!Array.isArray(userIds) || userIds.length > MAX_USERS) throw new Error(`personnes à rattacher : ${MAX_USERS} maximum`);
  // Moi exclu de la liste : mon accès est géré par attachMe (rattachement d'office de l'app).
  const picked = [...new Set(userIds)].filter((id) => id !== meId && id !== firm.subUserId).map((id) => {
    const user = users.find((u) => u.id === checkId(id, 'utilisateur'));
    if (!user) throw new Error('utilisateur hors du cabinet');
    return { id: user.id, email: user.email };
  });
  const job = {
    id: randomUUID(), env: name, firm: { id: firm.id, name: firm.name, subUserId: firm.subUserId }, users: picked,
    attachMe: attachMe !== false, actingUserId: firm.subUserId ?? meId,
    state: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    items: names.map((n) => ({ name: n, state: 'pending', companyId: null, error: null, warnings: [], steps: [] })),
  };
  jobs.set(job.id, job);
  runJob(job, t, table).catch((e) => { job.state = 'failed'; job.error = e.message; });
  return { job };
}

export function makerJob({ id }) {
  const job = jobs.get(id);
  if (!job) throw new Error('tâche inconnue (les tâches vivent en mémoire du MCP)');
  return job;
}
