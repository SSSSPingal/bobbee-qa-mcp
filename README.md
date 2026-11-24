# bobbee-test-data

Serveur MCP pour Claude Code : créer des dossiers et préparer des données de test sur un **env éphémère** Bobbee
(`mp-1234.feature.bobbee.co`). Jamais dev, staging ni prod.

Tout passe par l'API GraphQL de l'app, **avec ton compte** : tu ne peux rien faire de plus que dans l'app.

## Installation

Prérequis : Node 20+. Pour la recherche dans le schéma GraphQL (`bobbee_schema`) : la CLI GitHub (`gh auth login`)
avec accès à `OSS360/app-bobbee`, car l'introspection est coupée sur les serveurs Bobbee.

Une seule commande, sans cloner :

```bash
claude mcp add --scope user bobbee-test-data -- npx -y github:SSSSPingal/bobbee-test-data
```

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

Claude cherche les mutations dans le schéma de la branche, te récapitule le plan, puis l'exécute après ton accord.

| Outil | Rôle |
| --- | --- |
| `bobbee_status`, `bobbee_login` | Connexion en cours, page de connexion dans le navigateur |
| `maker_firms`, `maker_options` | Cabinets, utilisateurs rattachables, plans comptables de référence |
| `maker_create`, `maker_job` | Création de dossiers (comme l'écran « Dossiers clients ») et suivi |
| `bobbee_schema` | Recherche dans le schéma GraphQL de la branche de l'éphémère |
| `bobbee_graphql` | Requête ou mutation libre, dans le contexte d'un dossier (`companyId`) ou d'un cabinet |

## Limites

- Rien n'est transactionnel : un enchaînement qui échoue au milieu laisse des données partielles.
- Pas d'upload de fichiers (FEC, pièces) ni de connexion bancaire pour l'instant.
- Les types générés par Prisma (`…WhereInput`, `…CreateInput`) ne sont pas dans le dépôt : `bobbee_schema` ne les
  trouve pas.
- Création de dossiers : cabinets de grille EXPERT seulement. Les tâches vivent en mémoire du MCP.
- Certaines mutations envoient des mails (invitation d'un utilisateur…).
