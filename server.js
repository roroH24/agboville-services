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
  "http://localhost:3001",
  "http://127.0.0.1:3001",
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

  if (req.method === "OPTIONS") return res.sendStatus(204);
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
  if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
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
  const lines = [`Date dossier: ${now}`, `Type dossier: ${requestType}`, ""];

  const paymentInfo = {};
  const regularInfo = {};

  for (const [key, value] of Object.entries(formData)) {
    if (key.startsWith("Paiement_") || key.startsWith("Montant_")) {
      paymentInfo[key] = value;
    } else {
      regularInfo[key] = value;
    }
  }

  for (const [key, value] of Object.entries(regularInfo)) {
    lines.push(toMailLines(value, key));
  }

  if (Object.keys(paymentInfo).length > 0) {
    lines.push("");
    lines.push("=== INFORMATIONS DE PAIEMENT ===");
    for (const [key, value] of Object.entries(paymentInfo)) {
      lines.push(toMailLines(value, key));
    }
  }

  return { subject, text: lines.join("\n") };
}

async function createWavePayment(montant, description, reference, clientPhone) {
  const apiKey = process.env.WAVE_API_KEY;
  
  if (!apiKey || apiKey.includes("votre_")) {
    return {
      ok: true,
      message: "Paiement Wave non configuré. Utilisation du mode simulation.",
      transactionId: "WAVE_" + Date.now(),
      simulation: true
    };
  }

  try {
    const response = await fetch("https://api.wave.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: montant,
        currency: "XOF",
        description: description,
        reference: reference,
        customer_phone: clientPhone,
        callback_url: `http://localhost:${process.env.PORT}/api/payment/wave/callback`
      })
    });

    const result = await response.json();
    
    if (result.success) {
      return {
        ok: true,
        paymentLink: result.payment_link,
        transactionId: result.transaction_id
      };
    } else {
      return {
        ok: false,
        message: result.message || "Erreur Wave"
      };
    }
  } catch (error) {
    console.error("Erreur Wave:", error);
    return {
      ok: false,
      message: "Impossible de contacter Wave"
    };
  }
}

async function createMTNPayment(montant, description, reference, clientPhone) {
  const apiKey = process.env.MTN_API_KEY;
  
  if (!apiKey || apiKey.includes("votre_")) {
    return {
      ok: true,
      transactionId: "MTN_" + Date.now(),
      simulation: true
    };
  }

  try {
    const response = await fetch("https://api.mtn.com/v1/payments/initiate", {
      method: "POST",
      headers: {
        "X-Reference-Id": reference,
        "X-Target-Environment": "production",
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: ""+montant,
        currency: "XOF",
        externalId: reference,
        payer: {
          partyIdType: "MSISDN",
          partyId: clientPhone
        },
        payerMessage: description,
        payeeNote: description
      })
    });

    if (response.ok) {
      return {
        ok: true,
        transactionId: "MTN_" + Date.now()
      };
    } else {
      return {
        ok: false,
        message: "Erreur MTN Money"
      };
    }
  } catch (error) {
    console.error("Erreur MTN:", error);
    return {
      ok: false,
      message: "Impossible de contacter MTN Money"
    };
  }
}

async function createMoovPayment(montant, description, reference, clientPhone) {
  const apiKey = process.env.MOOV_API_KEY;
  
  if (!apiKey || apiKey.includes("votre_")) {
    return {
      ok: true,
      transactionId: "MOOV_" + Date.now(),
      simulation: true
    };
  }

  try {
    const response = await fetch("https://api.moov.ci/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: montant,
        currency: "XOF",
        phone: clientPhone,
        description: description,
        reference: reference
      })
    });

    const result = await response.json();
    
    if (result.success || response.ok) {
      return {
        ok: true,
        transactionId: result.transaction_id || "MOOV_" + Date.now()
      };
    } else {
      return {
        ok: false,
        message: "Erreur Moov Money"
      };
    }
  } catch (error) {
    console.error("Erreur Moov:", error);
    return {
      ok: false,
      message: "Impossible de contacter Moov Money"
    };
  }
}

async function createOrangePayment(montant, description, reference, clientPhone) {
  const apiKey = process.env.ORANGE_API_KEY;
  
  if (!apiKey || apiKey.includes("votre_")) {
    return {
      ok: true,
      transactionId: "ORANGE_" + Date.now(),
      simulation: true
    };
  }

  try {
    const response = await fetch("https://api.orange.com/orange-money-webpay/v1/webpayment", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: montant,
        currency: "XOF",
        notificationUrl: `http://localhost:${process.env.PORT}/api/payment/orange/callback`,
        reference: reference,
        description: description
      })
    });

    const result = await response.json();
    
    if (result.transactionId || response.ok) {
      return {
        ok: true,
        paymentUrl: result.paymentUrl,
        transactionId: result.transactionId || "ORANGE_" + Date.now()
      };
    } else {
      return {
        ok: false,
        message: "Erreur Orange Money"
      };
    }
  } catch (error) {
    console.error("Erreur Orange:", error);
    return {
      ok: false,
      message: "Impossible de contacter Orange Money"
    };
  }
}

app.post("/api/payment/wave", async (req, res) => {
  try {
    const { montant, description, reference, clientPhone } = req.body;

    if (!montant || montant <= 0) {
      return res.status(400).json({ ok: false, message: "Montant invalide" });
    }

    const payment = await createWavePayment(montant, description, reference, clientPhone);
    return res.json(payment);
  } catch (error) {
    console.error("Erreur paiement Wave:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur Wave" });
  }
});

app.post("/api/payment/mtn", async (req, res) => {
  try {
    const { montant, description, reference, clientPhone } = req.body;

    if (!montant || montant <= 0) {
      return res.status(400).json({ ok: false, message: "Montant invalide" });
    }

    const payment = await createMTNPayment(montant, description, reference, clientPhone);
    return res.json(payment);
  } catch (error) {
    console.error("Erreur paiement MTN:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur MTN" });
  }
});

app.post("/api/payment/moov", async (req, res) => {
  try {
    const { montant, description, reference, clientPhone } = req.body;

    if (!montant || montant <= 0) {
      return res.status(400).json({ ok: false, message: "Montant invalide" });
    }

    const payment = await createMoovPayment(montant, description, reference, clientPhone);
    return res.json(payment);
  } catch (error) {
    console.error("Erreur paiement Moov:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur Moov" });
  }
});

app.post("/api/payment/orange", async (req, res) => {
  try {
    const { montant, description, reference, clientPhone } = req.body;

    if (!montant || montant <= 0) {
      return res.status(400).json({ ok: false, message: "Montant invalide" });
    }

    const payment = await createOrangePayment(montant, description, reference, clientPhone);
    return res.json(payment);
  } catch (error) {
    console.error("Erreur paiement Orange:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur Orange" });
  }
});

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

    if (!formData.Mode_Reglement) {
      return res.status(400).json({ ok: false, message: "Le mode de reglement est obligatoire." });
    }

    if (formData.Mode_Reglement === "En_ligne") {
      if (!formData.Paiement_Mode || !formData.Paiement_Numero) {
        return res.status(400).json({ ok: false, message: "Pour le paiement en ligne, reseau et numero sont obligatoires." });
      }
    } else {
      formData.Paiement_Mode = "Paiement a la reception";
      formData.Paiement_Numero = "Aucun (encaissement en temps reel)";
      if (!formData.Paiement_Reference) {
        formData.Paiement_Reference = "Non applicable";
      }
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
    return res.status(500).json({ ok: false, message: "Echec de l'envoi. Verifiez la configuration SMTP." });
  }
});

app.all("/api/requests", (_req, res) => {
  return res.status(405).json({ ok: false, message: "Methode non autorisee. Utilisez POST /api/requests." });
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
