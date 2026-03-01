function normalizeBaseUrl(baseUrl) {
  return baseUrl ? baseUrl.replace(/\/+$/, "") : "";
}
function resolveConfiguredApiBase() {
  const meta = document.querySelector('meta[name="api-base-url"]');
  const configuredBase = meta ? meta.getAttribute("content")?.trim() : "";
  return normalizeBaseUrl(configuredBase || "");
}
function getApiBaseCandidates() {
  const configuredBase = resolveConfiguredApiBase();
  if (configuredBase) return [configuredBase];
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const candidates = [""];
  if (isLocalHost) {
    candidates.push(`http://${host}:3000`);
    candidates.push(`http://${host}:3001`);
    if (host === "localhost") {
      candidates.push("http://127.0.0.1:3000");
      candidates.push("http://127.0.0.1:3001");
    } else {
      candidates.push("http://localhost:3000");
      candidates.push("http://localhost:3001");
    }
  }
  return [...new Set(candidates.map(normalizeBaseUrl))];
}
function buildApiUrl(base, path) {
  return base ? `${base}${path}` : path;
}
async function postWithFallback(path, payload) {
  const bases = getApiBaseCandidates();
  let lastResponse = null;
  let lastError = null;
  for (const base of bases) {
    const url = buildApiUrl(base, path);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) return response;
      lastResponse = response;
      if (response.status === 404 || response.status === 405) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("Impossible de joindre l'API.");
}
const locButtons = document.querySelectorAll("[data-loc-target]");
const allRequestForms = document.querySelectorAll("form[data-request-type]");

function setLocation(targetId, value) {
  const target = document.getElementById(targetId);
  if (target) target.value = value;
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

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!rawBody) return {};

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return { message: "Reponse JSON invalide du serveur." };
    }
  }

  return { message: rawBody };
}

async function processPayment(form, formDataObj, messageEl) {
  const modeReglement = formDataObj.Mode_Reglement;
  
  if (modeReglement !== "En_ligne") {
    return true;
  }

  const montant = formDataObj.Montant_Total;
  if (!montant || montant <= 0) {
    showMessage(messageEl, "Veuillez entrer un montant valide pour le paiement en ligne.", true);
    return false;
  }

  const paiementMode = formDataObj.Paiement_Mode;
  const paiementNumero = formDataObj.Paiement_Numero;

  if (!paiementMode || !paiementNumero) {
    showMessage(messageEl, "Veuillez selectionner un reseau et entrer votre numero de paiement.", true);
    return false;
  }

  showMessage(messageEl, `Traitement du paiement de ${montant} FCFA via ${paiementMode}...`, false);

  return new Promise(async (resolve) => {
    try {
      const paymentEndpoint = {
        "MTN Money": "/api/payment/mtn",
        "Moov Money": "/api/payment/moov",
        "Wave": "/api/payment/wave",
        "Orange Money": "/api/payment/orange"
      }[paiementMode] || "/api/payment/wave";

      const response = await postWithFallback(paymentEndpoint, {
        montant: parseInt(montant),
        description: `Paiement ${formDataObj.Type_Dossier || "commande"}`,
        reference: `ORD-${Date.now()}`,
        clientPhone: formDataObj.Telephone
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.ok) {
        showMessage(messageEl, result.message || "Echec du paiement. Veuillez reessayer.", true);
        resolve(false);
        return;
      }

      formDataObj.Paiement_Statut = "Effectue";
      formDataObj.Paiement_ID_Transaction = result.transactionId;
      formDataObj.Montant_Paye = montant;

      if (result.paymentLink && !result.simulation) {
        showMessage(messageEl, "Redirection vers le portail de paiement...", false);
        setTimeout(() => {
          window.location.href = result.paymentLink;
        }, 1500);
      } else if (result.paymentUrl && !result.simulation) {
        showMessage(messageEl, "Redirection vers Orange Money...", false);
        setTimeout(() => {
          window.location.href = result.paymentUrl;
        }, 1500);
      } else {
        showMessage(messageEl, `Paiement confirme. Transaction: ${result.transactionId}`, false);
      }

      resolve(true);
    } catch (error) {
      console.error("Erreur paiement:", error);
      showMessage(messageEl, `Erreur: ${error.message || "Erreur de connexion au serveur de paiement."}`, true);
      resolve(false);
    }
  });
}

function createReceiptModal() {
  if (document.querySelector(".modal-overlay")) return;
  
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "receiptModal";
  overlay.innerHTML = `
    <div class="receipt-modal">
      <div class="receipt-header">
        <h2>Commande confirmee</h2>
        <p>Merci pour votre commande!</p>
      </div>
      <div id="receiptContent"></div>
    </div>
  `;
  
  document.body.appendChild(overlay);
}

function showReceipt(requestType, formDataObj) {
  if (!document.querySelector(".modal-overlay")) {
    createReceiptModal();
  }
  
  const overlay = document.querySelector(".modal-overlay");
  const content = document.querySelector("#receiptContent");
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR", {
    weekday: "short", 
    year: "numeric", 
    month: "long", 
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const typeLabel = {
    "Commande_Restaurant": "Restaurant",
    "Location_Maison": "Visite Maison",
    "Location_Objet": "Location Objets"
  }[requestType] || "Commande";

  let itemsHtml = "";
  
  if (requestType === "Commande_Restaurant" && toArray(formDataObj.Plats_Choisis).length > 0) {
    itemsHtml = `<div class="receipt-section">
      <h4>Articles commandes</h4>
      ${toArray(formDataObj.Plats_Choisis).map(plat => `<div class="receipt-item"><span class="receipt-item-label">- ${plat}</span></div>`).join("")}
    </div>`;
  } else if (requestType === "Location_Objet" && toArray(formDataObj.Objets).length > 0) {
    itemsHtml = `<div class="receipt-section">
      <h4>Objets loues</h4>
      ${toArray(formDataObj.Objets).map(obj => `<div class="receipt-item"><span class="receipt-item-label">- ${obj}</span></div>`).join("")}
    </div>`;
  }

  const clientInfo = `
    <div class="receipt-section">
      <h4>Informations client</h4>
      ${formDataObj.Nom ? `<div class="receipt-item"><span class="receipt-item-label">Nom:</span><span class="receipt-item-value">${formDataObj.Nom}</span></div>` : ""}
      <div class="receipt-item"><span class="receipt-item-label">Telephone:</span><span class="receipt-item-value">${formDataObj.Telephone}</span></div>
      <div class="receipt-item"><span class="receipt-item-label">Date:</span><span class="receipt-item-value">${dateStr}</span></div>
    </div>
  `;

  const paymentInfo = formDataObj.Paiement_Statut ? `
    <div class="receipt-section">
      <h4>Paiement en ligne</h4>
      <div class="receipt-item"><span class="receipt-item-label">Reseau:</span><span class="receipt-item-value">${formDataObj.Paiement_Mode}</span></div>
      <div class="receipt-item"><span class="receipt-item-label">Numero:</span><span class="receipt-item-value">****${formDataObj.Paiement_Numero.slice(-3)}</span></div>
      <div class="receipt-item"><span class="receipt-item-label">Transaction:</span><span class="receipt-item-value">${formDataObj.Paiement_ID_Transaction}</span></div>
    </div>
  ` : "";

  const receiptHtml = `
    <div class="receipt-body">
      ${itemsHtml}
      ${clientInfo}
      ${paymentInfo}
      <div class="receipt-total">
        <div class="receipt-total-amount">
          <span class="receipt-total-label">Montant Total:</span>
          <span class="receipt-total-value">${parseInt(formDataObj.Montant_Total || 0).toLocaleString("fr-FR")} FCFA</span>
        </div>
      </div>
      ${formDataObj.Paiement_Statut ? `<div class="receipt-confirmation">Paiement confirme avec succes</div>` : ""}
    </div>
    <div class="receipt-footer">
      <p>Numero de commande: <strong>#${Date.now().toString().slice(-8)}</strong></p>
      <p>Merci d'avoir utilise nos services!</p>
    </div>
    <div class="receipt-actions">
      <button class="receipt-print-btn" onclick="window.print()">Imprimer</button>
      <button class="receipt-close-btn" onclick="document.querySelector('.modal-overlay').classList.remove('active')">Fermer</button>
    </div>
  `;

  content.innerHTML = receiptHtml;
  overlay.classList.add("active");
}

async function sendForm(form) {
  const requestType = form.dataset.requestType;
  if (!form.reportValidity()) return;
  if (requestType === "Commande_Restaurant") {
    syncFoodSelectionsFromQuantities(form);
  }
  if (requestType === "Location_Objet") {
    syncObjectSelectionsFromQuantities(form);
  }

  const formData = new FormData(form);
  const messageEl = form.querySelector(".form-message");

  if (requestType === "Commande_Restaurant") {
    const checkedPlats = form.querySelectorAll('input[type="checkbox"][name="Plats_Choisis"]:checked');
    if (checkedPlats.length === 0) {
      showMessage(messageEl, "Veuillez cocher au moins un plat.", true);
      return;
    }
  }

  if (requestType === "Location_Objet") {
    const checkedObjets = form.querySelectorAll('input[type="checkbox"][name="Objets"]:checked');
    if (checkedObjets.length === 0) {
      showMessage(messageEl, "Veuillez cocher au moins un objet.", true);
      return;
    }
  }

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showMessage(messageEl, "Envoi en cours...", false);

  try {
    const formDataObj = formDataToObject(formData);
    
    const paymentSuccess = await processPayment(form, formDataObj, messageEl);
    if (!paymentSuccess) {
      if (submitButton) submitButton.disabled = false;
      return;
    }

    const payload = {
      requestType,
      formData: formDataObj
    };

    const response = await postWithFallback("/api/requests", payload);

    const result = await parseResponseBody(response);

    if (!response.ok) {
      if (response.status === 405) {
        throw new Error("Erreur HTTP 405: verifiez que l'API tourne sur http://localhost:3000.");
      }
      throw new Error(result.message || `Erreur HTTP ${response.status}`);
    }

    if (result.ok === false) {
      throw new Error(result.message || "Erreur d'envoi.");
    }

    showMessage(messageEl, result.message || "Demande envoyee au secretaire avec succes.", false);
    
    showReceipt(requestType, formDataObj);
    
    form.reset();
    if (requestType === "Commande_Restaurant") {
      updateFoodPrice();
      refreshQuickFoodPicker();
    } else if (requestType === "Location_Objet") {
      updateObjectPrice();
      refreshQuickObjectPicker();
    }
    const selected = form.querySelector('input[name="Mode_Reglement"]:checked');
    const onlineEnabled = !selected || selected.value === "En_ligne";
    setOnlinePaymentState(form, onlineEnabled);
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

document.querySelectorAll("form[data-request-type]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendForm(form);
  });
});

function setOnlinePaymentState(form, onlineEnabled) {
  const paymentBlock = form.querySelector("[data-payment-fields]");
  if (!paymentBlock) return;

  paymentBlock.classList.toggle("is-hidden", !onlineEnabled);

  const networkInputs = paymentBlock.querySelectorAll('input[name="Paiement_Mode"]');
  const paymentNumberInput = paymentBlock.querySelector('input[name="Paiement_Numero"]');
  const montantInput = paymentBlock.querySelector('input[name="Montant_Total"]');

  networkInputs.forEach((input, index) => {
    input.required = onlineEnabled && index === 0;
    if (!onlineEnabled) input.checked = false;
  });

  if (paymentNumberInput) {
    paymentNumberInput.required = onlineEnabled;
    if (!onlineEnabled) paymentNumberInput.value = "";
  }

  if (montantInput) {
    montantInput.required = onlineEnabled;
    if (!onlineEnabled) montantInput.value = "";
  }
}

function initPaymentMethodToggles() {
  allRequestForms.forEach((form) => {
    const modeInputs = form.querySelectorAll('input[name="Mode_Reglement"]');
    if (modeInputs.length === 0) return;

    const update = () => {
      const selected = form.querySelector('input[name="Mode_Reglement"]:checked');
      const onlineEnabled = !selected || selected.value === "En_ligne";
      setOnlinePaymentState(form, onlineEnabled);
    };

    modeInputs.forEach((input) => input.addEventListener("change", update));
    update();
  });
}

initPaymentMethodToggles();

const DISH_PRICES = {
  "Poulet braise + alloco": 3500,
  "Riz gras + viande": 2500,
  "Poisson frit + attieke": 4000,
  "Garba thon + attieke": 2000,
  "Foutou sauce graine + boeuf": 3000,
  "Spaghetti crevettes": 3500,
  "Kedjenou de poulet + riz": 4500
};

const DISH_QTY_FIELDS = {
  "Poulet braise + alloco": "Quantite_Poulet_Braise_Alloco",
  "Riz gras + viande": "Quantite_Riz_Gras_Viande",
  "Poisson frit + attieke": "Quantite_Poisson_Frit_Attieke",
  "Garba thon + attieke": "Quantite_Garba_Thon_Attieke",
  "Foutou sauce graine + boeuf": "Quantite_Foutou_Sauce_Graine_Boeuf",
  "Spaghetti crevettes": "Quantite_Spaghetti_Crevettes",
  "Kedjenou de poulet + riz": "Quantite_Kedjenou_Poulet_Riz"
};

const ITEM_PRICES = {
  "Chaise plastique blanche": 500,
  "Table ronde": 2000,
  "Tente de reception": 25000,
  "Nappe blanche": 300,
  "Housse de chaise": 250,
  "Glaciere grand format": 4000,
  "Sonorisation complete": 45000
};

const ITEM_QTY_FIELDS = {
  "Chaise plastique blanche": "Quantite_Chaises",
  "Table ronde": "Quantite_Tables",
  "Tente de reception": "Quantite_Tentes",
  "Nappe blanche": "Quantite_Nappes",
  "Housse de chaise": "Quantite_Housses",
  "Glaciere grand format": "Quantite_Glacieres",
  "Sonorisation complete": "Quantite_Sonorisation"
};

function animatePriceCounter(targetEl, nextValue) {
  if (!targetEl) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    targetEl.textContent = nextValue.toLocaleString("fr-FR");
    targetEl.dataset.currentValue = String(nextValue);
    return;
  }

  const fromValue = parseInt(targetEl.dataset.currentValue || "0", 10) || 0;
  const toValue = Math.max(0, parseInt(nextValue, 10) || 0);

  if (fromValue === toValue) {
    targetEl.textContent = toValue.toLocaleString("fr-FR");
    targetEl.dataset.currentValue = String(toValue);
    return;
  }

  if (targetEl._priceAnimFrame) {
    cancelAnimationFrame(targetEl._priceAnimFrame);
  }

  const startTime = performance.now();
  const diff = Math.abs(toValue - fromValue);
  const duration = Math.min(800, Math.max(240, diff / 60));

  const step = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(fromValue + (toValue - fromValue) * eased);

    targetEl.textContent = current.toLocaleString("fr-FR");
    targetEl.dataset.currentValue = String(current);

    if (progress < 1) {
      targetEl._priceAnimFrame = requestAnimationFrame(step);
    } else {
      targetEl.textContent = toValue.toLocaleString("fr-FR");
      targetEl.dataset.currentValue = String(toValue);
      targetEl._priceAnimFrame = null;
    }
  };

  targetEl._priceAnimFrame = requestAnimationFrame(step);
}

function findFoodCheckboxByDish(form, dishName) {
  const checkboxes = form.querySelectorAll('input[name="Plats_Choisis"]');
  return Array.from(checkboxes).find((checkbox) => checkbox.value.startsWith(`${dishName} - `)) || null;
}

function syncFoodSelectionsFromQuantities(form) {
  Object.entries(DISH_QTY_FIELDS).forEach(([dishName, qtyFieldName]) => {
    const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
    const checkbox = findFoodCheckboxByDish(form, dishName);
    if (!qtyField || !checkbox) return;
    const quantity = parseInt(qtyField.value, 10) || 0;
    checkbox.checked = quantity > 0;
  });
}

function setFoodQuantity(form, qtyFieldName, nextValue) {
  const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
  if (!qtyField) return;
  qtyField.value = Math.max(0, nextValue);
  syncFoodSelectionsFromQuantities(form);
  updateFoodPrice();
  refreshQuickFoodPicker();
}

function refreshQuickFoodPicker() {
  const form = document.querySelector('form[data-request-type="Commande_Restaurant"]');
  if (!form) return;

  const quickCards = document.querySelectorAll(".quick-dish");
  quickCards.forEach((card) => {
    const dishName = card.getAttribute("data-dish-name");
    const qtyFieldName = DISH_QTY_FIELDS[dishName];
    const qtyField = qtyFieldName ? form.querySelector(`input[name="${qtyFieldName}"]`) : null;
    const quantity = qtyField ? parseInt(qtyField.value, 10) || 0 : 0;
    const display = qtyFieldName ? document.querySelector(`[data-qty-display="${qtyFieldName}"]`) : null;
    if (display) display.textContent = String(quantity);
    card.classList.toggle("selected", quantity > 0);
  });
}

function initFoodQuickPicker() {
  const form = document.querySelector('form[data-request-type="Commande_Restaurant"]');
  if (!form) return;

  const searchInput = document.getElementById("food_search");
  const emptyMessage = document.getElementById("food_search_empty");
  const categoryBlocks = document.querySelectorAll(".food-category");

  const stepButtons = document.querySelectorAll("[data-qty-action][data-qty-field]");
  stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const qtyFieldName = button.getAttribute("data-qty-field");
      const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
      if (!qtyField) return;
      const currentValue = parseInt(qtyField.value, 10) || 0;
      const action = button.getAttribute("data-qty-action");
      const nextValue = action === "decrease" ? currentValue - 1 : currentValue + 1;
      setFoodQuantity(form, qtyFieldName, nextValue);
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      categoryBlocks.forEach((category) => {
        const cards = category.querySelectorAll(".quick-dish");
        let categoryVisible = 0;

        cards.forEach((card) => {
          const dishName = (card.getAttribute("data-dish-name") || "").toLowerCase();
          const isVisible = !term || dishName.includes(term);
          card.classList.toggle("is-hidden", !isVisible);
          if (isVisible) {
            visibleCount += 1;
            categoryVisible += 1;
          }
        });

        category.classList.toggle("is-hidden", categoryVisible === 0);
      });

      if (emptyMessage) {
        emptyMessage.classList.toggle("is-hidden", visibleCount > 0);
      }
    });
  }

  refreshQuickFoodPicker();
}

function findObjectCheckboxByItem(form, itemName) {
  const checkboxes = form.querySelectorAll('input[name="Objets"]');
  return Array.from(checkboxes).find((checkbox) => checkbox.value === itemName) || null;
}

function syncObjectSelectionsFromQuantities(form) {
  Object.entries(ITEM_QTY_FIELDS).forEach(([itemName, qtyFieldName]) => {
    const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
    const checkbox = findObjectCheckboxByItem(form, itemName);
    if (!qtyField || !checkbox) return;
    const quantity = parseInt(qtyField.value, 10) || 0;
    checkbox.checked = quantity > 0;
  });
}

function setObjectQuantity(form, qtyFieldName, nextValue) {
  const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
  if (!qtyField) return;
  qtyField.value = Math.max(0, nextValue);
  syncObjectSelectionsFromQuantities(form);
  updateObjectPrice();
  refreshQuickObjectPicker();
}

function refreshQuickObjectPicker() {
  const form = document.querySelector('form[data-request-type="Location_Objet"]');
  if (!form) return;

  const quickCards = document.querySelectorAll(".quick-object");
  quickCards.forEach((card) => {
    const itemName = card.getAttribute("data-object-name");
    const qtyFieldName = ITEM_QTY_FIELDS[itemName];
    const qtyField = qtyFieldName ? form.querySelector(`input[name="${qtyFieldName}"]`) : null;
    const quantity = qtyField ? parseInt(qtyField.value, 10) || 0 : 0;
    const display = qtyFieldName ? document.querySelector(`[data-object-qty-display="${qtyFieldName}"]`) : null;
    if (display) display.textContent = String(quantity);
    card.classList.toggle("selected", quantity > 0);
  });
}

function initObjectQuickPicker() {
  const form = document.querySelector('form[data-request-type="Location_Objet"]');
  if (!form) return;

  const searchInput = document.getElementById("object_search");
  const emptyMessage = document.getElementById("object_search_empty");
  const categoryBlocks = document.querySelectorAll(".object-category");

  const stepButtons = document.querySelectorAll("[data-object-qty-action][data-object-qty-field]");
  stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const qtyFieldName = button.getAttribute("data-object-qty-field");
      const qtyField = form.querySelector(`input[name="${qtyFieldName}"]`);
      if (!qtyField) return;
      const currentValue = parseInt(qtyField.value, 10) || 0;
      const action = button.getAttribute("data-object-qty-action");
      const nextValue = action === "decrease" ? currentValue - 1 : currentValue + 1;
      setObjectQuantity(form, qtyFieldName, nextValue);
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      categoryBlocks.forEach((category) => {
        const cards = category.querySelectorAll(".quick-object");
        let categoryVisible = 0;

        cards.forEach((card) => {
          const itemName = (card.getAttribute("data-object-name") || "").toLowerCase();
          const isVisible = !term || itemName.includes(term);
          card.classList.toggle("is-hidden", !isVisible);
          if (isVisible) {
            visibleCount += 1;
            categoryVisible += 1;
          }
        });

        category.classList.toggle("is-hidden", categoryVisible === 0);
      });

      if (emptyMessage) {
        emptyMessage.classList.toggle("is-hidden", visibleCount > 0);
      }
    });
  }

  refreshQuickObjectPicker();
}

function updateFoodPrice() {
  const form = document.querySelector('form[data-request-type="Commande_Restaurant"]');
  if (!form) return;

  syncFoodSelectionsFromQuantities(form);

  const checkboxes = form.querySelectorAll('input[name="Plats_Choisis"]:checked');
  const details = [];
  let total = 0;

  checkboxes.forEach((checkbox) => {
    const dishName = checkbox.value.replace(/ - \d+ FCFA$/, "");
    const price = DISH_PRICES[dishName] || 0;
    const qtyFieldName = DISH_QTY_FIELDS[dishName];
    const qtyField = qtyFieldName ? form.querySelector(`input[name="${qtyFieldName}"]`) : null;
    
    let quantity = qtyField ? parseInt(qtyField.value) || 0 : 0;
    
    if (quantity > 0) {
      const subtotal = price * quantity;
      total += subtotal;
      details.push(`${dishName}: ${quantity} × ${price} FCFA = ${subtotal} FCFA`);
    }
  });

  const priceDetails = form.querySelector("#r_price_details");
  const totalPrice = form.querySelector("#r_total_price");
  const montantInput = form.querySelector('input[name="Montant_Total"]');

  if (priceDetails) {
    priceDetails.textContent = details.length > 0 ? details.join(" + ") : "Aucun article avec quantite > 0";
  }
  if (totalPrice) {
    animatePriceCounter(totalPrice, total);
  }
  if (montantInput) {
    montantInput.value = total;
  }
}

function updateObjectPrice() {
  const form = document.querySelector('form[data-request-type="Location_Objet"]');
  if (!form) return;

  syncObjectSelectionsFromQuantities(form);

  const checkboxes = form.querySelectorAll('input[name="Objets"]:checked');
  const dateDebut = form.querySelector('input[name="Date_Debut"]');
  const dateFin = form.querySelector('input[name="Date_Fin"]');

  let nbDays = 1;
  if (dateDebut && dateFin && dateDebut.value && dateFin.value) {
    const start = new Date(dateDebut.value);
    const end = new Date(dateFin.value);
    nbDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
  }

  const details = [];
  let total = 0;

  checkboxes.forEach((checkbox) => {
    const itemName = checkbox.value;
    const price = ITEM_PRICES[itemName] || 0;
    const qtyFieldName = ITEM_QTY_FIELDS[itemName];
    const qtyField = qtyFieldName ? form.querySelector(`input[name="${qtyFieldName}"]`) : null;
    
    let quantity = qtyField ? parseInt(qtyField.value) || 0 : 0;
    
    if (quantity > 0) {
      const subtotal = price * quantity * nbDays;
      total += subtotal;
      details.push(`${itemName}: ${quantity} × ${price} FCFA/jour × ${nbDays} j = ${subtotal} FCFA`);
    }
  });

  const priceDetails = form.querySelector("#o_price_details");
  const totalPrice = form.querySelector("#o_total_price");
  const montantInput = form.querySelector('input[name="Montant_Total"]');

  if (priceDetails) {
    priceDetails.textContent = details.length > 0 ? details.join(" + ") : "Aucun article avec quantite > 0";
  }
  if (totalPrice) {
    animatePriceCounter(totalPrice, total);
  }
  if (montantInput) {
    montantInput.value = total;
  }
}

function initScrollReveal() {
  const revealTargets = document.querySelectorAll(
    ".card, .catalog-item, .food-category, .price-summary, .actions"
  );
  if (revealTargets.length === 0) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  revealTargets.forEach((el, index) => {
    el.classList.add("reveal-on-scroll");
    el.style.setProperty("--reveal-delay", `${Math.min(index * 35, 280)}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    revealTargets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  revealTargets.forEach((el) => observer.observe(el));
}

const restaurantForm = document.querySelector('form[data-request-type="Commande_Restaurant"]');
if (restaurantForm) {
  const platsCheckboxes = restaurantForm.querySelectorAll('input[name="Plats_Choisis"]');
  const qteInputs = restaurantForm.querySelectorAll('input[type="number"]');
  
  platsCheckboxes.forEach((cb) => cb.addEventListener("change", updateFoodPrice));
  qteInputs.forEach((input) => input.addEventListener("change", updateFoodPrice));
  initFoodQuickPicker();
  updateFoodPrice();
}

const objectForm = document.querySelector('form[data-request-type="Location_Objet"]');
if (objectForm) {
  const objetsCheckboxes = objectForm.querySelectorAll('input[name="Objets"]');
  const dateInputs = objectForm.querySelectorAll('input[name="Date_Debut"], input[name="Date_Fin"]');
  const qteInputs = objectForm.querySelectorAll('input[type="number"]');
  
  objetsCheckboxes.forEach((cb) => cb.addEventListener("change", updateObjectPrice));
  dateInputs.forEach((input) => input.addEventListener("change", updateObjectPrice));
  qteInputs.forEach((input) => input.addEventListener("change", updateObjectPrice));
  initObjectQuickPicker();
  updateObjectPrice();
}

initScrollReveal();

