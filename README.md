# Agboville Services

## 1) Installation
```bash
npm install
```

## 2) Configuration email
Copier `.env.example` vers `.env` puis remplacer les valeurs.

Variables importantes:
- `SECRETARY_EMAIL`: email du secretaire
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`
- `SMTP_USER`, `SMTP_PASS`
- `SMTP_FROM`

## 3) Lancer le projet
```bash
npm run dev
```
Puis ouvrir: `http://localhost:3000`

## 4) Fonctionnement
- Les 3 formulaires envoient leurs donnees vers `POST /api/requests`
- Le serveur envoie un email au secretaire avec:
  - type de dossier
  - action attendue
  - details du client

## 5) Structure des fichiers
- `index.html`: structure de la page
- `style.css`: style
- `app.js`: logique frontend
- `server.js`: API + envoi email
