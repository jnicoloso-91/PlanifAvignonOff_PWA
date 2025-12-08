# IA – Index global embeddings

Ce dossier contient tout le nécessaire pour construire l'index global
index_global_embeddings.json utilisé par le Worker Cloudflare
(route /ai/semantic).

## Fichiers

- off.json : spectacles OFF parsés (tableau d'objets)
- in.json : spectacles IN parsés (tableau d'objets)
- build_index.js : script Node qui construit index_global_embeddings.json
- index_global_embeddings.json : fichier généré, à utiliser via GitHub Raw

## Utilisation

1. Installer les dépendances à la racine du repo :

```bash
npm install