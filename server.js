import "dotenv/config";
import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedRequestTypes = new Set([
  "Commande_Restaurant",
  "Location_Maison",
  "Location_Objet"
]);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function toMailLines(value, key) {
  if (Array.isArray(value)) {
    return `${key}: ${value.join(", ")}`;
  }
  return `${key}: ${value}`;
}

function buildMailPayload(requestType, formData) {
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

  const subjectByType = {
    Commande_Restaurant: "Nouvelle commande restaurant",
    Location_Maison: "Nouvelle demande de visite maison",
    Location_Objet: "Nouvelle demande de location objets"
  };

  const subject = subjectByType[requestType] || "Nouvelle demande client";

  const lines = [
    `Date dossier: ${now}`,
    `Type dossier: ${requestType}`,
    ""
  ];

  for (const [key, value] of Object.entries(formData)) {
    lines.push(toMailLines(value, key));
  }

  return {
    subject,
    text: lines.join("\n")
  };
}

app.post("/api/requests", async (req, res) => {
  try {
    const { requestType, formData } = req.body || {};

    if (!requestType || !formData || typeof formData !== "object") {
      return res.status(400).json({ ok: false, message: "Donnees invalides." });
    }

    if (!allowedRequestTypes.has(requestType)) {
      return res.status(400).json({ ok: false, message: "Type de demande invalide." });
    }

    if (!formData.Telephone) {
      return res.status(400).json({ ok: false, message: "Le numero de telephone est obligatoire." });
    }

    if (!formData.Nom || String(formData.Nom).trim() === "") {
      formData.Nom = "Non renseigne";
    }

    const secretaryEmail = process.env.SECRETARY_EMAIL;
    if (!secretaryEmail) {
      return res.status(500).json({ ok: false, message: "SECRETARY_EMAIL manquant dans .env" });
    }

    const requiredSmtpVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
    const missing = requiredSmtpVars.filter((name) => !process.env[name] || String(process.env[name]).trim() === "");
    if (missing.length > 0) {
      return res.status(500).json({
        ok: false,
        message: `Configuration SMTP incomplete: ${missing.join(", ")}`
      });
    }

    const transporter = createTransporter();
    const payload = buildMailPayload(requestType, formData);

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: secretaryEmail,
      subject: payload.subject,
      text: payload.text
    });

    return res.json({ ok: true, message: "Demande envoyee au secretaire." });
  } catch (error) {
    console.error("Erreur envoi demande:", error);
    return res.status(500).json({
      ok: false,
      message: "Echec de l'envoi. Verifiez la configuration SMTP."
    });
  }
});

app.all("/api/requests", (_req, res) => {
  return res.status(405).json({
    ok: false,
    message: "Methode non autorisee. Utilisez POST /api/requests."
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agboville-services", time: new Date().toISOString() });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Serveur demarre sur http://localhost:${port}`);
});
