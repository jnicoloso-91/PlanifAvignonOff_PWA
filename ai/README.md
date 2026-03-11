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

1. Mettre à jour les catalogues In & Off en faisant un coller de l'adresse du cataloque dans l'application
2. Réexporter les catalogues Excel In & Off depuis l'application
3. Recopier les catalogues Excel dans Google Drive
4. Mettre à jour les URL Google Drive dans les fonctions d'import de catalogues de l'application 
5. Regénérer les json In & Off à partir de exportJsonForAi de utils-json.js depuis l'application
6. Regénérer l'index global:
    1. Installer les dépendances à la racine du repo (1 fois) :
        ```bash
        npm install
    2. Se mettre dans le dossier `ai`
    3. lancer la commande: node build_index.js
        ex: node build_index off_2025.json in_2025.json index_avignon_2025.json
7. Recopier les json In & Off et le nouvel index dans GitHub sous ai
8. Si changement d'année:
    1. Dans l'application changer l'année par défaut
    2. Dans Cloudflare
        1. Se logger sous compte GitHub
        2. Aller dans off_proxy
        3. Aller dans Settings
        4. Mettre à jour EMBEDDINGS_INDEX_URL
