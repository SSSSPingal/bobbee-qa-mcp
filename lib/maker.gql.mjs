// Requêtes GraphQL Bobbee de la création d'un dossier client, réduites aux champs utiles
// (mêmes mutations et même ordre que l'écran « Dossiers clients » : EditCompany.vue, ClientCompanies.vue).

export const ME_FIRMS = `{
  meUserDetails {
    id
    email
    firstname
    lastname
    company { id name accountingFirm bobbeePriceList { id scope version } }
    subUsers { id company { id name accountingFirm bobbeePriceList { id scope version } } }
  }
}`;

export const FIRM_USERS = `query ($companyId: String!) {
  users(where: { type: NATURAL_PERSON OR: [{ companyId: $companyId } { companyUsers_some: { companyId: $companyId, partOfCompany: true } }] } orderBy: firstname_ASC) {
    id firstname lastname email
  }
}`;

export const CANDIDATE_TABLES = `query ($companyId: ID!) {
  candidateAccountableAccountTables(where: { companyId: $companyId }) {
    id name companyScope { accountingCompanyOwner { id name } }
  }
}`;

// Création seule (where id vide) : le profil du dossier est créé dans la foulée, comme dans l'app.
export const UPSERT_COMPANY = `mutation (
  $name: String $siret: String $siren: String $vatNumber: String $legalForm: CompanyLegalForm
  $vatSystem: CompanyVatSystem $vatOption: CompanyVatOption $vatDeclarationDay: Int
  $taxSystemType: CompanyTaxSystemType $incomeCategory: CompanyIncomeCategory $taxRegime: CompanyTaxRegime
  $nafsCreate: CompanyActivityCreateOneInput $startBusinessDate: DateTime $firstAccountingPeriodEnd: DateTime
  $parentCompany: CompanyCreateOneInput
) {
  upsertCompany(
    where: { id: "" }
    create: {
      name: $name shortName: "" siret: $siret siren: $siren vatNumber: $vatNumber legalForm: $legalForm isActive: true
      vatSystem: $vatSystem vatOption: $vatOption vatDeclarationDay: $vatDeclarationDay
      taxSystemType: $taxSystemType incomeCategory: $incomeCategory taxRegime: $taxRegime
      withManager: true salaryCountAverage: 0 shareCapital: 0 shareTotal: 0 registrationTown: ""
      activity: $nafsCreate address: "" postalCode: "" city: "" country: "France" solution: NO_SOLUTION
      accountingFirm: false enableAccountingFirms: false corporateTaxDepartment: "" timeZone: "Europe/Paris"
      startBusinessDate: $startBusinessDate firstAccountingPeriodEnd: $firstAccountingPeriodEnd
      inBankruptcy: false inLiquidation: false parentCompany: $parentCompany
      profile: { create: { createPaySlip: true createZTillReceipt: false zTillReceiptWithTransactions: false createExpenseReport: true } }
    }
    update: {}
  ) {
    id name profile { id }
  }
}`;

export const CREATE_ACCOUNT_TABLE = `mutation ($companyId: ID!, $referenceAccountableAccountTableId: ID!, $salesAccounts: Json) {
  createCompanyAccountableAccountTable(data: { companyId: $companyId, referenceAccountableAccountTableId: $referenceAccountableAccountTableId, salesAccounts: $salesAccounts }) { id }
}`;

export const UPSERT_PROFILE_COMPANY = `mutation (
  $id: ID $companyId: ID $accountingType: ProfileCompanyAccountingType $rofs: Json
  $createExpenseReport: Boolean $createPaySlip: Boolean $createSalesInvoice: Boolean $createZTillReceipt: Boolean
) {
  upsertProfileCompany(
    where: { id: $id }
    create: { company: { connect: { id: $companyId } } accountingType: $accountingType rofs: $rofs }
    update: {
      accountingType: $accountingType rofs: $rofs createExpenseReport: $createExpenseReport createPaySlip: $createPaySlip
      createSalesInvoice: $createSalesInvoice createZTillReceipt: $createZTillReceipt
    }
  ) { id }
}`;

// Stock et agri : ProfileCompany.stock / stockConfig { onlyInventory, agriFeatures } / activateTags (SettingStock.vue).
// Enregistrement appelé à changer côté Bobbee : étape non bloquante (voir lib/companyMaker.mjs).
export const UPSERT_STOCK_SETTINGS = `mutation ($id: ID $companyId: ID $stock: Boolean $stockConfig: Json $activateTags: Boolean) {
  upsertProfileCompany(
    where: { id: $id }
    create: { company: { connect: { id: $companyId } } stock: $stock stockConfig: $stockConfig activateTags: $activateTags }
    update: { stock: $stock stockConfig: $stockConfig activateTags: $activateTags }
  ) { id }
}`;

// Pas de mutation dédiée au retrait d'accès dans Bobbee : updateUser n'accepte que profile / availableCompanies.
export const USER_REMOVE_COMPANY = `mutation ($userId: ID!, $companyId: ID!) {
  updateUser(where: { id: $userId }, data: { availableCompanies: { disconnect: [{ id: $companyId }] } }) { id }
}`;

export const UPDATE_FIRM_CLIENT = `mutation ($offer: String, $isTraining: Boolean, $clientId: ID!, $accountingFirmId: ID!) {
  updateOrCreateAccountingFirmClient(data: { offer: $offer, isTraining: $isTraining, clientId: $clientId, accountingFirmId: $accountingFirmId }) { id }
}`;

export const ADD_CLIENT_TO_FIRM = `mutation ($id: ID!, $companies: [ID!]) {
  addClientToCompanies(data: { accountingFirmId: $id, toAddCompanies: $companies, sendMail: false }) { id }
}`;

export const USER_ADD_COMPANY = `mutation ($userId: ID!, $companyId: ID!) {
  userAddAvailableCompany(data: { userId: $userId, companyId: $companyId }) { success }
}`;

export const UPSERT_ACCOUNTING_PERIOD = `mutation ($companyId: ID!, $start: DateTime!, $end: DateTime!) {
  upsertAccountingPeriod(
    where: { id: "" }
    create: { company: { connect: { id: $companyId } } start: $start end: $end closed: false temporaryClosed: false }
    update: {}
  ) { id }
}`;
