# bobbee-test-data

Serveur MCP pour Claude Code : créer des dossiers et préparer des données de test sur un **env éphémère** Bobbee
(`mp-1234.feature.bobbee.co`). Jamais dev, staging ni prod.

Tout passe par l'API GraphQL de l'app, **avec ton compte** : tu ne peux rien faire de plus que dans l'app.

## Installation

Prérequis : Node 20+. Pour la recherche dans le schéma GraphQL (`bobbee_schema`) : la CLI GitHub (`gh auth login`)
avec accès à `OSS360/app-bobbee`, car l'introspection est coupée sur les serveurs Bobbee.

Le MCP est livré comme plugin Claude Code. Dans un terminal (marche aussi pour Claude Desktop, dont la zone de
message ne propose pas `/plugin`) :

```bash
claude plugin install bobbee-test-data --marketplace SSSSPingal/bobbee-test-data
```

Ou dans Claude Code en terminal : `/plugin install bobbee-test-data --marketplace SSSSPingal/bobbee-test-data`.
Puis ouvrir une nouvelle conversation (ou `/reload-plugins`).

Sur une version plus ancienne de Claude Code, en deux temps : `/plugin marketplace add SSSSPingal/bobbee-test-data`,
puis `/plugin install bobbee-test-data@bobbee`.

**Mises à jour automatiques** : une fois, dans `/plugin`, onglet Marketplaces, choisir `bobbee` et activer
l'auto-update. Claude Code récupère alors les nouvelles versions au démarrage (désactivé par défaut hors marketplaces
d'Anthropic). Sans ça : `/plugin marketplace update bobbee`.

Si tu l'avais installé avant via `npx` : `claude mcp remove bobbee-test-data --scope user`, pour ne pas l'avoir en double.

## Connexion

Dans Claude Code, demande « connecte-moi à Bobbee ». Une page s'ouvre dans ton navigateur : email + mot de passe de
ton compte Bobbee dev (il sert aussi aux éphémères), et c'est tout. Même chose quand la session expire.

Le mot de passe ne passe jamais par la conversation : la page est servie par le MCP sur ta machine (127.0.0.1,
lien à usage unique, 5 min). Il ne sert qu'à calculer une preuve SRP, comme la page de connexion de l'app : il n'est
ni envoyé ni stocké. Seul le refresh token est gardé, dans `~/.bobbee-test-data/session.json`. Comptes SSO non gérés.

En secours, depuis un clone du repo : `npm install` puis `npm run login` (saisie dans le terminal).

## Utilisation

Dans Claude Code, décris ce que tu veux, par exemple :

> Sur mp-17743, crée un dossier agricole avec un exercice 2026 et un inventaire non validé, puis des produits récoltés :
> un produit OK (compte avec règle « Variation de stocks » et contrepartie de classe 3), un produit sans compte,
> un compte sans règle de variation, une variation sans contrepartie, une contrepartie clôturée.

Claude reprend les appels du front et vérifie le schéma de la branche, te récapitule le plan, puis l'exécute après ton
accord. Les pièges déjà rencontrés sont dans les consignes du MCP (`INSTRUCTIONS` dans `server.mjs`) : en ajouter un
quand il revient, pour que tout le monde en profite.

### Depuis un ticket : `/test-data MP-1234`

Le skill lit le ticket et son AT (connecteur Atlassian de Claude, sinon colle le ticket), puis le diff de la branche
(`gh`). Il en déduit les cas à tester et propose un plan : par cas, les données, le dossier, les opérations et le
résultat attendu. Il l'exécute après ton accord et finit par un récapitulatif pour le testeur. Il ne modifie jamais
le ticket.

| Outil | Rôle |
| --- | --- |
| `bobbee_status`, `bobbee_login` | Connexion en cours, page de connexion dans le navigateur |
| `maker_firms`, `maker_options` | Cabinets, plans comptables de référence, utilisateurs rattachables (recherche) |
| `maker_create`, `maker_job` | Création de dossiers (comme l'écran « Dossiers clients ») et suivi |
| `bobbee_operations` | Opérations GraphQL du front (`vue/src/**/*.gql`) à la branche de l'éphémère, prêtes à rejouer |
| `bobbee_schema` | Schéma de la branche : définitions GraphQL, enums et modèles Prisma |
| `bobbee_graphql` | Requête ou mutation libre, dans le contexte d'un dossier (`companyId`) ou d'un cabinet ; signale un retour null |

## Dépannage

**Erreur d'authentification, ou les outils ne répondent plus** : la session a expiré. Demande « connecte-moi à Bobbee »
dans Claude Code et reconnecte-toi sur la page qui s'ouvre. En secours, depuis un clone du repo : `npm run login`.
`bobbee_status` indique si une session est active.

## Limites

- Rien n'est transactionnel : un enchaînement qui échoue au milieu laisse des données partielles.
- Pas d'upload de fichiers (FEC, pièces) ni de connexion bancaire pour l'instant.
- Les inputs et mutations CRUD générés par Prisma (`updateInvoiceProduct`, `…WhereInput`) ne sont pas dans le dépôt :
  `bobbee_schema` ne les trouve pas, leur usage se lit dans `bobbee_operations`.
- `bobbee_operations` cherche dans le chemin des `.gql`, pas dans leur contenu.
- Pas d'accès aux logs backend de l'éphémère (CloudWatch) : une erreur générique ne dit pas sa cause.
- Création de dossiers : cabinets de grille EXPERT seulement. Les tâches vivent en mémoire du MCP.
- Certaines mutations envoient des mails (invitation d'un utilisateur…).

## Publier une nouvelle version

1. `npm install` puis `npm run build` : régénère `dist/server.mjs`, le serveur regroupé en un fichier que lance le plugin
   (le plugin n'installe pas de `node_modules`).
2. Monter `version` dans `.claude-plugin/plugin.json` (et `package.json`) : **sans changement de version, les postes
   déjà installés ne récupèrent pas la mise à jour**.
3. Committer `dist/` avec le reste, puis pousser sur `main`.
