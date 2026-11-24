// Règles pures de la création d'un dossier (Company maker) : validation du modèle, SIRET fictif, variables des mutations.
import { randomInt } from 'node:crypto';

export const DEFAULT_PREFIX = '[QA]';
export const MAX_BATCH = 10;
export const MAX_PERIODS = 10;

// Racine des noms de dossiers : 3 caractères minimum, la suppression par préfixe ne doit jamais tout viser.
export function checkPrefix(prefix) {
  const p = String(prefix ?? DEFAULT_PREFIX).trim();
  if (p.length < 3 || p.length > 30) throw new Error('préfixe : 3 à 30 caractères');
  return p;
}

// Couples catégorie de revenus → régimes fiscaux permis (vue/src/types/tax/taxSystems.types.ts).
export const TAX_REGIMES = {
  ASSOC: ['OTHER', 'REAL_SIMPLIFIED', 'REAL_NORMAL'],
  BA: ['MICRO_BA', 'REAL_SIMPLIFIED', 'REAL_NORMAL'],
  BIC: ['MICRO_ENTERPRISE', 'REAL_SIMPLIFIED', 'REAL_NORMAL'],
  BNC: ['CONTROLLED_DECLARATION', 'MICRO_ENTERPRISE'],
  RF: ['OTHER'],
};
export const VAT_SYSTEMS = ['NotSubjectTo', 'BelowTheThreshold', 'Normal', 'Simplified', 'SimplifiedExercise', 'Quartely', 'FlatRateRefund'];
export const VAT_OPTIONS = ['Debits', 'Receipts'];
export const ACCOUNTING_TYPES = ['RECEIVABLES_DEBT', 'INCOMING_OUTGOING_PAYMENT'];
export const OFFERS = ['ACCOUNTING_CAC', 'ACCOUNTING_BASIC', 'ACCOUNTING_ESSENTIAL', 'ACCOUNTING_PREMIUM', 'BUSINESS_BASIC', 'BUSINESS_SMART', 'BUSINESS_ESSENTIAL', 'BUSINESS_PREMIUM'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{20,30}$/;

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} invalide : ${value}`);
  return value;
}

// Clé de Luhn : SIRET fictif valide (préfixe 9 pour ne pas tomber sur une vraie entreprise courante).
function luhnKey(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function fakeSiret() {
  const sirenBase = `9${Array.from({ length: 7 }, () => randomInt(10)).join('')}`;
  const siren = `${sirenBase}${luhnKey(sirenBase)}`;
  const nicBase = `0000${randomInt(10)}`.slice(-4);
  return `${siren}${nicBase}${luhnKey(siren + nicBase)}`;
}

export function vatNumber(siren) {
  return `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0')}${siren}`;
}

// Paramètres du dossier : validés champ par champ, valeurs Bobbee uniquement.
export function checkTemplate(t) {
  const incomeCategory = oneOf(t.incomeCategory, Object.keys(TAX_REGIMES), 'catégorie de revenus');
  const v = {
    name: String(t.name ?? '').trim(),
    legalForm: String(t.legalForm ?? '').trim().toUpperCase(),
    incomeCategory,
    taxRegime: oneOf(t.taxRegime, TAX_REGIMES[incomeCategory], 'régime fiscal'),
    taxSystemType: oneOf(t.taxSystemType, ['IS', 'IR'], 'imposition'),
    vatSystem: oneOf(t.vatSystem, VAT_SYSTEMS, 'régime de TVA'),
    vatOption: t.vatOption ? oneOf(t.vatOption, VAT_OPTIONS, 'option TVA') : null,
    vatDeclarationDay: t.vatDeclarationDay ? Number(t.vatDeclarationDay) : null,
    naf: String(t.naf ?? '').trim().toUpperCase(),
    accountingType: oneOf(t.accountingType, ACCOUNTING_TYPES, 'type de comptabilité'),
    accountTableName: String(t.accountTableName ?? '').trim(),
    offer: oneOf(t.offer, OFFERS, 'offre'),
    isTraining: !!t.isTraining,
    periodStart: String(t.periodStart ?? ''),
    periodEnd: String(t.periodEnd ?? ''),
    createPeriod: t.createPeriod !== false,
    periodCount: t.periodCount === undefined ? 1 : Number(t.periodCount),
    // Sous-options sans stock : ignorées, comme le fait l'écran SettingStock de l'app.
    stock: {
      enabled: !!t.stock?.enabled,
      onlyInventory: !!t.stock?.enabled && !!t.stock?.onlyInventory,
      agriFeatures: !!t.stock?.enabled && !!t.stock?.agriFeatures,
    },
    options: {
      createExpenseReport: !!t.options?.createExpenseReport,
      createPaySlip: !!t.options?.createPaySlip,
      createSalesInvoice: !!t.options?.createSalesInvoice,
      createZTillReceipt: !!t.options?.createZTillReceipt,
    },
  };
  if (!v.name || v.name.length > 80) throw new Error('nom du dossier : 1 à 80 caractères');
  if (!/^[A-Z0-9]{2,10}$/.test(v.legalForm)) throw new Error('forme juridique invalide');
  if (v.vatDeclarationDay !== null && !(v.vatDeclarationDay >= 15 && v.vatDeclarationDay <= 24)) throw new Error('jour de déclaration TVA : 15 à 24');
  if (v.naf && !/^\d{4}[A-Z]$/.test(v.naf)) throw new Error('code NAF au format 6201Z');
  if (!v.accountTableName) throw new Error('plan comptable de référence manquant');
  if (!DATE_RE.test(v.periodStart) || !DATE_RE.test(v.periodEnd) || v.periodEnd <= v.periodStart) throw new Error('dates du premier exercice invalides');
  if (!Number.isInteger(v.periodCount) || v.periodCount < 1 || v.periodCount > MAX_PERIODS) throw new Error(`nombre d'exercices : 1 à ${MAX_PERIODS}`);
  return v;
}

export const checkId = (id, label) => {
  if (!ID_RE.test(String(id ?? ''))) throw new Error(`${label} invalide`);
  return id;
};

// Noms du lot : « [QA] Nom », numérotés s'il y en a plusieurs.
export function batchNames(prefix, name, count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) throw new Error(`nombre de dossiers : 1 à ${MAX_BATCH}`);
  return Array.from({ length: n }, (_, i) => `${checkPrefix(prefix)} ${name}${n > 1 ? ` ${i + 1}` : ''}`);
}

// Offre par défaut de l'app selon la grille tarifaire du cabinet (vue/src/services/offerServices.ts).
export function defaultOffer(priceList) {
  if (priceList?.scope !== 'EXPERT') return 'BUSINESS_BASIC';
  return Number(priceList.version) === 1 ? 'ACCOUNTING_PREMIUM' : 'ACCOUNTING_BASIC';
}

const isoDay = (d) => `${d}T00:00:00Z`;

export function companyVariables(t, name, firmId) {
  const siret = fakeSiret();
  const siren = siret.slice(0, 9);
  const forcedDay = ['Simplified', 'SimplifiedExercise'].includes(t.vatSystem) && t.incomeCategory === 'BA' ? 5 : null;
  return {
    name, siret, siren, vatNumber: vatNumber(siren), legalForm: t.legalForm,
    vatSystem: t.vatSystem, vatOption: t.vatOption, vatDeclarationDay: forcedDay ?? t.vatDeclarationDay,
    taxSystemType: t.taxSystemType, incomeCategory: t.incomeCategory, taxRegime: t.taxRegime,
    nafsCreate: t.naf ? { connect: { name: t.naf } } : undefined,
    startBusinessDate: isoDay(t.periodStart), firstAccountingPeriodEnd: isoDay(t.periodEnd),
    parentCompany: { connect: { id: firmId } },
  };
}

// Préfixes ROF par défaut de l'app (EditCompany.vue) ; liasse selon la catégorie de revenus.
export function defaultRofs(t) {
  const bundle = { BIC: t.taxSystemType === 'IR' ? 'BIC' : 'IS', BNC: 'BNC', BA: 'BA', RF: 'RF' }[t.incomeCategory] ?? 'BIC';
  return [
    { tax: 'TVA', code: '1', prefix: 'TVA' }, { tax: 'IS', code: '1', prefix: 'IS' }, { tax: 'CVAE', code: '1', prefix: 'CVAE' },
    { tax: 'RCM', code: '1', prefix: 'RCM' }, { tax: 'Liasse', code: '1', prefix: bundle }, { tax: 'Intégration fiscale', code: '1', prefix: 'ISGROUPE' },
  ];
}

// Agri impose les tags (règle RG2 du back, reprise ici pour un appel cohérent).
export const stockVariables = (t, profileId, companyId) => ({
  id: profileId, companyId, stock: true,
  stockConfig: { onlyInventory: t.stock.onlyInventory, agriFeatures: t.stock.agriFeatures },
  activateTags: t.stock.agriFeatures ? true : undefined,
});

export const STOCK_FORMAT_WARNING = "Réglages stock/agri refusés par Bobbee : leur enregistrement a peut-être changé (migration en cours côté app). "
  + 'Dossier créé sans eux : à régler dans l\'app, puis adapter UPSERT_STOCK_SETTINGS (lib/maker.gql.mjs).';

const ymd = (d) => d.toISOString().slice(0, 10);

// Exercice suivant : démarre le lendemain, 12 mois ; une fin de mois reste une fin de mois (29 février compris).
export function nextPeriod(end) {
  const d = new Date(`${end}T00:00:00Z`);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  const y = d.getUTCFullYear() + 1, m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = start.getUTCDate() === 1 ? lastDay : Math.min(d.getUTCDate(), lastDay);
  return { start: ymd(start), end: ymd(new Date(Date.UTC(y, m, day))) };
}

// Premier exercice saisi, puis les suivants enchaînés.
export function accountingPeriods(t) {
  const periods = [{ start: t.periodStart, end: t.periodEnd }];
  while (periods.length < t.periodCount) periods.push(nextPeriod(periods.at(-1).end));
  return periods;
}

export const periodVariables = (period, companyId) => ({ companyId, start: isoDay(period.start), end: isoDay(period.end) });
