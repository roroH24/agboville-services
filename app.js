function resolveApiUrl() {
  const meta = document.querySelector('meta[name="api-base-url"]');
  const configuredBase = meta ? meta.getAttribute("content")?.trim() : "";

  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, "")}/api/requests`;
  }

  if (
    window.location.hostname === "localhost" &&
    window.location.port &&
    window.location.port !== "3000"
  ) {
    return "http://localhost:3000/api/requests";
  }

  return "/api/requests";
}

const API_URL = resolveApiUrl();

const locButtons = document.querySelectorAll("[data-loc-target]");
const formConfigs = [
  { formId: "restaurantForm", messageId: "restaurantMessage" },
  { formId: "maisonForm", messageId: "maisonMessage" },
  { formId: "objetForm", messageId: "objetMessage" }
];

function setLocation(targetId, value) {
  const target = document.getElementById(targetId);
  if (target) {
    target.value = value;
  }
}

function showMessage(messageEl, text, isError) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.classList.toggle("error", Boolean(isError));
  messageEl.classList.toggle("success", !isError);
}

function formDataToObject(formData) {
  const output = {};
  for (const [key, value] of formData.entries()) {
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      if (Array.isArray(output[key])) {
        output[key].push(value);
      } else {
        output[key] = [output[key], value];
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!rawBody) {
    return {};
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return { message: "Reponse JSON invalide du serveur." };
    }
  }

  return { message: rawBody };
}

async function sendPayload(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function sendForm(form, messageEl) {
  const requestType = form.dataset.requestType;
  const formData = new FormData(form);

  if (requestType === "Commande_Restaurant") {
    const checkedPlats = form.querySelectorAll('input[type="checkbox"][name="Plats_Choisis"]:checked');
    if (checkedPlats.length === 0) {
      showMessage(messageEl, "Veuillez cocher au moins un plat.", true);
      return;
    }
  }

  if (requestType === "Location_Objet") {
    const checked = form.querySelectorAll('input[type="checkbox"][name="Objets"]:checked');
    if (checked.length === 0) {
      showMessage(messageEl, "Veuillez cocher au moins un objet.", true);
      return;
    }
  }

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showMessage(messageEl, "Envoi en cours...", false);

  try {
    const payload = {
      requestType,
      formData: formDataToObject(formData)
    };

    let response = await sendPayload(API_URL, payload);

    if (
      response.status === 405 &&
      API_URL.startsWith("/") &&
      window.location.hostname === "localhost" &&
      window.location.port !== "3000"
    ) {
      response = await sendPayload("http://localhost:3000/api/requests", payload);
    }

    const result = await parseResponseBody(response);

    if (!response.ok) {
      if (response.status === 405) {
        throw new Error("Erreur HTTP 405: ouvrez le site via http://localhost:3000.");
      }
      throw new Error(result.message || `Erreur HTTP ${response.status}`);
    }

    if (result.ok === false) {
      throw new Error(result.message || "Erreur d'envoi.");
    }

    showMessage(
      messageEl,
      result.message || "Demande envoyee au secretaire avec succes.",
      false
    );
    form.reset();
  } catch (error) {
    showMessage(messageEl, error.message || "Echec de l'envoi.", true);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

locButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-loc-target");

    if (!navigator.geolocation) {
      setLocation(targetId, "Geolocalisation non supportee");
      alert("Geolocalisation non supportee par ce navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        setLocation(targetId, `Latitude: ${lat}, Longitude: ${lon}`);
        alert("Localisation ajoutee au formulaire.");
      },
      () => {
        setLocation(targetId, "Localisation non autorisee ou indisponible");
        alert("Impossible de recuperer la localisation.");
      }
    );
  });
});

formConfigs.forEach((config) => {
  const form = document.getElementById(config.formId);
  const messageEl = document.getElementById(config.messageId);

  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendForm(form, messageEl);
  });
});
