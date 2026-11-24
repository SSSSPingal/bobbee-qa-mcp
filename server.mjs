#!/usr/bin/env node
// Serveur MCP « bobbee-qa » (stdio, sans SDK) : créer des dossiers et préparer des données de test sur un env éphémère Bobbee.
import { createInterface } from 'node:readline';
import { authStatus } from './lib/auth.mjs';
import { checkEnv } from './lib/env.mjs';
import { gql } from './lib/gql.mjs';
import { startLoginPage } from './lib/loginPage.mjs';
import { makerFirmOptions, makerFirms, makerJob, startMakerCreation } from './lib/maker.mjs';
import { ACCOUNTING_TYPES, MAX_BATCH, MAX_PERIODS, OFFERS, TAX_REGIMES, VAT_OPTIONS, VAT_SYSTEMS } from './lib/maker.helpers.mjs';
import { searchSchema } from './lib/schema.mjs';

// stdout est réservé au protocole.
console.log = (...args) => console.error(...args);

const INSTRUCTIONS = `Outils pour préparer des données de test sur un env éphémère Bobbee (mp-1234.feature.bobbee.co), jamais dev, staging ni prod.
Tout passe par l'API GraphQL de l'app avec le compte de l'utilisateur : ses droits, rien de plus.
- Pas connecté : appeler bobbee_login, qui ouvre une page de connexion dans le navigateur. Ne jamais demander le mot de passe dans la conversation.
- Créer un dossier : maker_firms → maker_options → maker_create → maker_job.
- Préparer des données : chercher les mutations avec bobbee_schema (schéma de la branche de l'éphémère, l'introspection est coupée),
  puis bobbee_graphql avec companyId = le dossier visé. Lire avant d'écrire (ids, plan comptable, exercice).
- Avant une série d'écritures, récapituler le plan (quoi, dans quel dossier) et obtenir l'accord de l'utilisateur. Rien n'est transactionnel.`;

const ENV = { type: 'string', description: 'Env éphémère du ticket, ex. mp-1234' };

const VALUES = {
  type: 'object',
  description: 'Paramètres du dossier.',
  properties: {
    name: { type: 'string', description: 'Nom, sans le préfixe (1 à 80 caractères)' },
    legalForm: { type: 'string', description: 'Forme juridique, ex. SAS, SARL, EARL, EI' },
    incomeCategory: { type: 'string', enum: Object.keys(TAX_REGIMES) },
    taxRegime: { type: 'string', description: `Selon incomeCategory : ${JSON.stringify(TAX_REGIMES)}` },
    taxSystemType: { type: 'string', enum: ['IS', 'IR'] },
    vatSystem: { type: 'string', enum: VAT_SYSTEMS },
    vatOption: { type: ['string', 'null'], enum: [...VAT_OPTIONS, null] },
    vatDeclarationDay: { type: ['integer', 'null'], description: '15 à 24' },
    naf: { type: 'string', description: 'Code NAF au format 6201Z (facultatif)' },
    accountingType: { type: 'string', enum: ACCOUNTING_TYPES },
    accountTableName: { type: 'string', description: 'Nom exact d\'un plan de référence (voir maker_options)' },
    offer: { type: 'string', enum: OFFERS, description: 'Stocks visibles seulement avec ACCOUNTING_PREMIUM, BUSINESS_ESSENTIAL ou BUSINESS_PREMIUM' },
    isTraining: { type: 'boolean' },
    periodStart: { type: 'string', description: 'Début du premier exercice, AAAA-MM-JJ' },
    periodEnd: { type: 'string', description: 'Fin du premier exercice, AAAA-MM-JJ' },
    createPeriod: { type: 'boolean', description: 'Créer les exercices (défaut true)' },
    periodCount: { type: 'integer', description: `Exercices enchaînés sur 12 mois, 1 à ${MAX_PERIODS}` },
    stock: { type: 'object', properties: { enabled: { type: 'boolean' }, onlyInventory: { type: 'boolean' }, agriFeatures: { type: 'boolean' } } },
    options: {
      type: 'object',
      properties: { createExpenseReport: { type: 'boolean' }, createPaySlip: { type: 'boolean' }, createSalesInvoice: { type: 'boolean' }, createZTillReceipt: { type: 'boolean' } },
    },
  },
  required: ['name', 'legalForm', 'incomeCategory', 'taxRegime', 'taxSystemType', 'vatSystem', 'accountingType', 'accountTableName', 'offer', 'periodStart', 'periodEnd'],
};

// Appel GraphQL libre ; en-têtes de contexte comme dans l'app (dossier sélectionné, cabinet).
function graphql({ env, query, variables, companyId, accountingFirmId, subUserId }) {
  const headers = {
    ...(companyId !== undefined ? { 'X-companyId': companyId } : {}),
    ...(accountingFirmId ? { 'X-accountingFirmId': accountingFirmId } : {}),
    ...(subUserId ? { 'X-subUserId': subUserId } : {}),
  };
  return gql(checkEnv(env), query, variables ?? {}, { headers });
}

const TOOLS = {
  bobbee_status: {
    description: 'État de la connexion à Bobbee (compte, date). Si non connecté : bobbee_login.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    handler: authStatus,
  },
  bobbee_login: {
    description: "Ouvre dans le navigateur une page locale de connexion à Bobbee (compte dev, sert aux éphémères), valable 5 min. "
      + "Donner l'adresse renvoyée à l'utilisateur si le navigateur ne s'ouvre pas, puis vérifier avec bobbee_status quand il dit avoir fini. "
      + 'Sert aussi à changer de compte.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: startLoginPage,
  },
  bobbee_schema: {
    description: "Cherche dans le schéma GraphQL de Bobbee, lu sur GitHub à la branche du ticket de l'éphémère (feature|bugfix|hotfix/mp-1234/…). "
      + 'Recherche par nom (tous les mots, ex. « stockaccountrule », « inventory », « UpsertProductInput »), à défaut dans le texte des définitions. '
      + 'Renvoie les champs de Query/Mutation et les types correspondants. Les types générés par Prisma (…WhereInput, …CreateInput) ne sont pas dans le dépôt. '
      + "Demande la CLI gh connectée avec un accès à OSS360/app-bobbee.",
    inputSchema: {
      type: 'object',
      properties: {
        env: ENV,
        search: { type: 'string', description: 'Mots à chercher dans les noms' },
        branch: { type: 'string', description: 'Branche à lire, si plusieurs correspondent au ticket' },
      },
      required: ['env', 'search'],
    },
    annotations: { readOnlyHint: true },
    handler: searchSchema,
  },
  bobbee_graphql: {
    description: "Exécute une requête ou une mutation GraphQL sur un env éphémère Bobbee, avec le compte et les droits de l'utilisateur. "
      + "companyId : dossier visé (en-tête X-companyId, indispensable pour les données d'un dossier) ; accountingFirmId : cabinet (X-accountingFirmId), "
      + "pour les réglages du cabinet (ex. règles Cabinet du plan comptable). Vérifier la signature avec bobbee_schema avant. "
      + "Avant une série de mutations, récapituler et obtenir l'accord de l'utilisateur.",
    inputSchema: {
      type: 'object',
      properties: {
        env: ENV,
        query: { type: 'string', description: 'Document GraphQL (une opération)' },
        variables: { type: 'object' },
        companyId: { type: 'string', description: 'Dossier visé (X-companyId)' },
        accountingFirmId: { type: 'string', description: 'Cabinet (X-accountingFirmId)' },
        subUserId: { type: 'string', description: 'Sous-utilisateur, si le cabinet est le sien (X-subUserId, voir maker_firms)' },
      },
      required: ['env', 'query'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: graphql,
  },
  maker_firms: {
    description: "Cabinets où je peux créer des dossiers sur l'éphémère (le mien et ceux de mes sous-utilisateurs).",
    inputSchema: { type: 'object', properties: { env: ENV }, required: ['env'] },
    annotations: { readOnlyHint: true },
    handler: makerFirms,
  },
  maker_options: {
    description: 'Pour un cabinet : utilisateurs rattachables, plans comptables de référence et offre par défaut. Seuls les cabinets de grille EXPERT sont gérés.',
    inputSchema: { type: 'object', properties: { env: ENV, firmId: { type: 'string' } }, required: ['env', 'firmId'] },
    annotations: { readOnlyHint: true },
    handler: makerFirmOptions,
  },
  maker_create: {
    description: `Crée 1 à ${MAX_BATCH} dossiers sur l'éphémère (comme l'écran « Dossiers clients ») et les rattache au cabinet, à moi et aux utilisateurs choisis. `
      + 'Lancé en arrière-plan : renvoie la tâche, à suivre avec maker_job. Non transactionnel. Récapituler les paramètres et obtenir l\'accord avant.',
    inputSchema: {
      type: 'object',
      properties: {
        env: ENV,
        firmId: { type: 'string', description: 'Cabinet (maker_firms)' },
        userIds: { type: 'array', items: { type: 'string' }, description: 'Utilisateurs à rattacher (maker_options)' },
        attachMe: { type: 'boolean', description: 'Garder mon accès au dossier (défaut true)' },
        prefix: { type: 'string', description: 'Préfixe des noms, 3 caractères min (défaut [QA])' },
        count: { type: 'integer', description: `Nombre de dossiers, 1 à ${MAX_BATCH}` },
        values: VALUES,
      },
      required: ['env', 'firmId', 'count', 'values'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: startMakerCreation,
  },
  maker_job: {
    description: "Avancement d'une création de dossiers : état de chaque dossier (companyId), étapes, erreurs, avertissements.",
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    handler: makerJob,
  },
};

// --- Protocole MCP (JSON-RPC ligne à ligne sur stdio) -------------------------
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle({ method, params }) {
  if (method === 'initialize') {
    return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'bobbee-qa', version: '0.1.0' }, instructions: INSTRUCTIONS };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    return { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) };
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name];
    if (!tool) throw Object.assign(new Error(`Outil inconnu : ${params?.name}`), { code: -32602 });
    try {
      const data = await tool.handler(params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
  }
  throw Object.assign(new Error(`Méthode non gérée : ${method}`), { code: -32601 });
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (msg.id === undefined) return; // notification
  try {
    send({ id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
