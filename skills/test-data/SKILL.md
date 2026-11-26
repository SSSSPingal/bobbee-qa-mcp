---
name: test-data
description: Prépare les données de test d'un ticket Jira Bobbee (MP-XXXX) sur son env éphémère. Lit le ticket et son AT dans Jira/Confluence, puis le diff de sa branche, en déduit les cas à tester, propose un plan de création (dossiers, données, opérations GraphQL) et l'exécute après accord. Déclenche sur « /test-data MP-1234 », « prépare les données pour tester MP-1234 », « jeu de test du ticket », « données de recette pour MP-xxxx ».
argument-hint: MP-XXXX [précisions]
---

# Données de test d'un ticket

Ticket : `$ARGUMENTS`. Sans clé MP-XXXX, la demander. L'env éphémère est la clé en minuscules (`MP-1234` → `mp-1234`),
sauf si l'utilisateur en donne un autre.

Jira : lecture seule, ne jamais modifier le ticket (champ, transition, commentaire).

## 1. Lire, en parallèle

- **Connexion** : `bobbee_status` ; si non connecté, `bobbee_login` tout de suite (il se connecte pendant la suite).
- **Ticket**, via le connecteur Atlassian (`getJiraIssue`, site `isagri.atlassian.net`) : résumé, description, critères
  d'acceptation, commentaires (`listJiraIssueComments`), sous-tâches et tickets liés utiles.
  Sans connecteur Atlassian : demander à l'utilisateur de coller le contenu du ticket, ne pas deviner.
- **AT** : `searchConfluence` sur la clé du ticket ; si une analyse technique existe, la lire.
- **Code de la branche** (dépôt `OSS360/app-bobbee`, CLI `gh`) :
  - `gh pr list --repo OSS360/app-bobbee --state all --search "<clé>" --json number,title,headRefName`
  - `gh pr diff <n> --repo OSS360/app-bobbee --name-only`, puis le diff des fichiers qui portent la règle métier
    (services, helpers, resolvers, schéma Prisma, `.gql` du front). Sans PR : `gh api repos/OSS360/app-bobbee/compare/main...<branche>`.

## 2. En déduire les cas à tester

Depuis les critères d'acceptation et les conditions du code (gardes, `if`, erreurs levées, enums) :
- le cas nominal, puis chaque cas limite ou d'erreur, un cas = une situation de données distincte ;
- pour chaque cas, le résultat attendu dans l'app (ce que le testeur doit voir).

Ne garder que ce que le ticket change : pas de cas sur le reste de l'écran.

## 3. Préparer le plan (lecture seule)

- Dossier : en réutiliser un existant de l'éphémère si l'utilisateur en donne un, sinon en créer
  (`maker_firms` → `maker_options`) avec l'offre, le plan comptable et l'exercice que les cas exigent.
- Pour chaque donnée : l'opération du front (`bobbee_operations`), types et enums vérifiés (`bobbee_schema`),
  les ids nécessaires lus avant (`bobbee_graphql` en lecture : comptes, exercice, tags…).

Présenter le plan puis **attendre l'accord** :

| Cas | Données à créer | Dossier | Opérations | Résultat attendu |
| --- | --- | --- | --- | --- |

Ajouter en dessous ce qui ne peut pas être préparé par l'API (upload FEC ou pièce, connexion bancaire, mail) :
à faire à la main par le testeur.

## 4. Exécuter après accord

Suivre les consignes du MCP (pièges connus compris). Après chaque écriture, relire ce qui a été créé ; un retour null
est un échec. Rien n'est transactionnel : en cas d'échec au milieu, s'arrêter et dire ce qui existe déjà.

Finir par un récapitulatif pour le testeur : dossier (nom, companyId), et par cas les données créées et où les voir
dans l'app.
