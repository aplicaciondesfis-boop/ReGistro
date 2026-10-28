import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  serverTimestamp, 
  Timestamp, 
  writeBatch 
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-ai.js";

// Configuración del proyecto aprovisionado en Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBWaDrziitxV8VUM8uJd0-MOObV1Q9sFvs",
  authDomain: "gen-lang-client-0763498694.firebaseapp.com",
  projectId: "gen-lang-client-0763498694",
  storageBucket: "gen-lang-client-0763498694.firebasestorage.app",
  messagingSenderId: "1017602413544",
  appId: "1:1017602413544:web:ed5d51a0a5387df76b4a5d"
};

const databaseId = "ai-studio-android-finanzas-9de8d947-51ef-49c8-bea7-269c8805f10f";

const app = initializeApp(firebaseConfig);

// ---------------------------------------------------------------
// APP CHECK (obligatorio para usar la IA de Firebase desde el 2/11/2026)
// Pegá acá la "clave del sitio" de reCAPTCHA Enterprise (ver guía).
// ---------------------------------------------------------------
const APPCHECK_SITE_KEY = "6LeBGgUuAAAAANK29mh3T7em1UooCbtFKaUdNRS5";
const appCheckActivo = APPCHECK_SITE_KEY && !APPCHECK_SITE_KEY.startsWith("PEGAR");
if (appCheckActivo) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}
const auth = getAuth(app);
const db = getFirestore(app, databaseId);

// Estado de la aplicación
let currentUser = null;
let activeSpace = "hogar"; // "hogar" o "personal"
let currentHousehold = null;
let userHouseholds = [];
let purchases = [];
let purchaseItems = [];
let obligations = [];

// Elementos de la interfaz
const authScreen = document.getElementById("authScreen");
const mainContent = document.getElementById("mainContent");
const btnGoogleSignIn = document.getElementById("btnGoogleSignIn");
const btnAuth = document.getElementById("btnAuth");
const spaceSelector = document.getElementById("spaceSelector");
const btnSettings = document.getElementById("btnSettings");
const revisionBadge = document.getElementById("revisionBadge");

// Modales
const modalScan = document.getElementById("modalScan");
const modalManual = document.getElementById("modalManual");
const modalSettings = document.getElementById("modalSettings");
const fileReceiptInput = document.getElementById("fileReceiptInput");
const scanLoadingIndicator = document.getElementById("scanLoadingIndicator");

// Etiqueta de versión (chiquita, abajo a la izquierda) para comprobar que se cargó el app.js nuevo
const versionTag = document.createElement("div");
versionTag.textContent = "lectura real v3 - 27/10";
versionTag.style.cssText = "position:fixed;bottom:4px;left:6px;font-size:10px;opacity:.55;z-index:9999;pointer-events:none;";
document.body.appendChild(versionTag);

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration:', err));
}

// -------------------------------------------------------------
// AUTENTICACIÓN
// -------------------------------------------------------------
btnGoogleSignIn.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    alert("Error al iniciar sesión con Google: " + err.message);
  }
});

btnAuth.addEventListener("click", () => {
  signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    authScreen.style.display = "none";
    mainContent.style.display = "block";
    btnAuth.style.display = "inline-flex";
    btnAuth.textContent = `Salir (${user.displayName ? user.displayName.split(' ')[0] : 'Sesión'})`;
    initHouseholdListener(user.uid);
  } else {
    authScreen.style.display = "block";
    mainContent.style.display = "none";
    btnAuth.style.display = "none";
  }
});

// -------------------------------------------------------------
// GESTIÓN DE HOGARES
// -------------------------------------------------------------
function initHouseholdListener(uid) {
  const q = query(collection(db, "households"), where("memberUids", "array-contains", uid));
  onSnapshot(q, async (snapshot) => {
    userHouseholds = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    if (userHouseholds.length === 0) {
      // Crear hogar inicial
      const newRef = doc(collection(db, "households"));
      const h = {
        name: "Hogar Gualeguaychú",
        adminUid: uid,
        memberUids: [uid],
        members: { [uid]: "admin" },
        createdAt: serverTimestamp()
      };
      await setDoc(newRef, h);
    } else {
      if (!currentHousehold) {
        currentHousehold = userHouseholds[0];
      } else {
        currentHousehold = userHouseholds.find(h => h.id === currentHousehold.id) || userHouseholds[0];
      }
      updateSpaceSelectorUI();
      listenData();
    }
  });
}

function updateSpaceSelectorUI() {
  spaceSelector.innerHTML = "";
  userHouseholds.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = `🏠 ${h.name} (Compartido)`;
    if (activeSpace === h.id) opt.selected = true;
    spaceSelector.appendChild(opt);
  });
  const personalOpt = document.createElement("option");
  personalOpt.value = "personal";
  personalOpt.textContent = "👤 Mis Gastos Personales (Privado)";
  if (activeSpace === "personal") personalOpt.selected = true;
  spaceSelector.appendChild(personalOpt);
}

spaceSelector.addEventListener("change", (e) => {
  activeSpace = e.target.value;
  listenData();
});

// -------------------------------------------------------------
// SINCRONIZACIÓN EN TIEMPO REAL (FIRESTORE)
// -------------------------------------------------------------
let unsubPurchases = null;
let unsubItems = null;
let unsubObligations = null;

function listenData() {
  if (unsubPurchases) unsubPurchases();
  if (unsubItems) unsubItems();
  if (unsubObligations) unsubObligations();

  const isPersonal = activeSpace === "personal";
  const targetHouseholdId = isPersonal ? "personal" : (currentHousehold ? currentHousehold.id : "");
  if (!targetHouseholdId && !isPersonal) return;

  document.getElementById("summarySpaceLabel").textContent = isPersonal ? "RESUMEN PERSONAL" : `RESUMEN DE ${currentHousehold ? currentHousehold.name.toUpperCase() : 'HOGAR'}`;

  // 1. Compras
  let qPurchases = isPersonal
    ? query(collection(db, "purchases"), where("householdId", "==", "personal"), where("createdByUid", "==", currentUser.uid))
    : query(collection(db, "purchases"), where("householdId", "==", targetHouseholdId), where("memberUids", "array-contains", currentUser.uid));

  unsubPurchases = onSnapshot(qPurchases, (snap) => {
    purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    purchases.sort((a, b) => {
      const da = a.date ? (a.date.toDate ? a.date.toDate() : new Date(a.date)) : new Date();
      const db = b.date ? (b.date.toDate ? b.date.toDate() : new Date(b.date)) : new Date();
      return db - da;
    });
    renderSummary();
    renderPurchases();
    renderReviewQueue();
    renderPriceComparison();
  });

  // 2. Líneas de compra
  let qItems = isPersonal
    ? query(collection(db, "purchase_items"), where("householdId", "==", "personal"))
    : query(collection(db, "purchase_items"), where("householdId", "==", targetHouseholdId), where("memberUids", "array-contains", currentUser.uid));

  unsubItems = onSnapshot(qItems, (snap) => {
    purchaseItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPriceComparison();
  });

  // 3. Obligaciones
  let qObligations = isPersonal
    ? query(collection(db, "obligations"), where("householdId", "==", "personal"), where("createdByUid", "==", currentUser.uid))
    : query(collection(db, "obligations"), where("householdId", "==", targetHouseholdId), where("memberUids", "array-contains", currentUser.uid));

  unsubObligations = onSnapshot(qObligations, (snap) => {
    obligations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderObligations();
  });
}

// -------------------------------------------------------------
// RENDERIZADO DE INTERFAZ
// -------------------------------------------------------------
function renderSummary() {
  const totalPaid = purchases.reduce((acc, p) => acc + (p.totalPaid || 0), 0);
  const totalDiscounts = purchases.reduce((acc, p) => acc + (p.discountsTotal || 0), 0);
  const totalCashback = purchases.reduce((acc, p) => acc + (p.cashbackAmount || 0), 0);
  const realCost = purchases.reduce((acc, p) => acc + (p.effectiveCost || p.totalPaid || 0), 0);

  document.getElementById("metricTotalPaid").textContent = `$${totalPaid.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ARS`;
  document.getElementById("metricRealCost").textContent = `Costo Real Neto: $${realCost.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ARS`;
  document.getElementById("metricDiscounts").textContent = `-$${totalDiscounts.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  document.getElementById("metricCashback").textContent = `+$${totalCashback.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const reviewNeeded = purchases.filter(p => p.status === "a_revisar").length;
  if (reviewNeeded > 0) {
    revisionBadge.textContent = reviewNeeded;
    revisionBadge.style.display = "inline-block";
  } else {
    revisionBadge.style.display = "none";
  }
}

function renderPurchases() {
  const container = document.getElementById("purchasesList");
  document.getElementById("purchasesCount").textContent = `${purchases.length} registros`;

  if (purchases.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay comprobantes cargados en este espacio. Tocá en "Digitalizar Comprobante" o "Carga Manual".</div>`;
    return;
  }

  container.innerHTML = purchases.map(p => {
    const isReview = p.status === "a_revisar";
    const dateObj = p.date ? (p.date.toDate ? p.date.toDate() : new Date(p.date)) : new Date();
    const dateStr = dateObj.toLocaleDateString("es-AR");

    return `
      <div class="card-item ${isReview ? 'review-needed' : ''}">
        <div class="card-header">
          <div>
            <div class="card-title">${escapeHtml(p.storeName || "Comercio")}</div>
            <div class="card-meta">${dateStr} • ${escapeHtml(p.paymentMethod || "Efectivo")} ${p.manualArchiveNumber ? `• Archivo: <strong>${escapeHtml(p.manualArchiveNumber)}</strong>` : ''}</div>
          </div>
          <div style="text-align: right;">
            <div class="card-price">$${(p.totalPaid || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div>
            ${p.cashbackAmount > 0 ? `<div class="card-meta" style="color: var(--secondary)">Reintegro: $${p.cashbackAmount.toFixed(2)}</div>` : ''}
          </div>
        </div>
        ${isReview ? `
          <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span class="badge-pill warning">⚠️ Requiere revisión</span>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="window.approvePurchase('${p.id}')">Aprobar</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join("");
}

function renderPriceComparison() {
  const container = document.getElementById("priceComparisonList");
  const search = document.getElementById("priceSearchInput").value.toLowerCase().trim();

  const validItems = purchaseItems.filter(item => item.canonicalProductName && item.canonicalProductName !== "sin detalle");
  const groups = {};

  validItems.forEach(item => {
    const key = item.canonicalProductName.toLowerCase().trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  const rows = Object.keys(groups).map(key => {
    const items = groups[key];
    const prices = items.map(i => i.unitPriceNormalized || i.unitPrice || 0).filter(p => p > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    const purchaseIds = new Set(items.map(i => i.purchaseId));
    const stores = Array.from(new Set(purchases.filter(p => purchaseIds.has(p.id)).map(p => p.storeName))).filter(Boolean);

    return {
      name: items[0].canonicalProductName,
      min,
      max,
      avg,
      stores,
      items
    };
  }).filter(r => !search || r.name.toLowerCase().includes(search));

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay productos que coincidan con la búsqueda.</div>`;
    return;
  }

  container.innerHTML = rows.map(r => {
    const storeText = r.stores.length > 1 ? `Varias (${r.stores.length} comercios)` : (r.stores[0] || "Comercio");
    return `
      <div class="card-item" style="cursor: pointer;" onclick="this.querySelector('.history-detail').style.display = this.querySelector('.history-detail').style.display === 'none' ? 'block' : 'none'">
        <div class="card-header">
          <div>
            <div class="card-title">${escapeHtml(r.name)}</div>
            <div class="card-meta">🏪 ${escapeHtml(storeText)}</div>
          </div>
          <div style="text-align: right;">
            <div class="card-price" style="color: var(--primary);">Prom: $${r.avg.toFixed(2)}</div>
            <div class="card-meta">Rango: $${r.min.toFixed(0)} - $${r.max.toFixed(0)}</div>
          </div>
        </div>
        <div class="history-detail" style="display: none; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
          <div style="font-weight: 600; font-size: 0.8rem; color: var(--primary); margin-bottom: 6px;">Historial de compras:</div>
          ${r.items.map(i => `
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 3px 0;">
              <span>${escapeHtml(i.rawDescription)} (Cant: ${i.quantity || 1})</span>
              <strong>$${(i.lineTotal || 0).toFixed(2)} ($${(i.unitPriceNormalized || i.unitPrice || 0).toFixed(2)}/u)</strong>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

document.getElementById("priceSearchInput").addEventListener("input", renderPriceComparison);

function renderObligations() {
  const container = document.getElementById("obligationsList");
  const upcomingContainer = document.getElementById("upcomingList");
  const upcomingSection = document.getElementById("upcomingSection");

  const pending = obligations.filter(o => o.status === "pendiente");
  const paid = obligations.filter(o => o.status === "pagado");

  // Próximos vencimientos para el dashboard
  if (pending.length > 0) {
    upcomingSection.style.display = "block";
    upcomingContainer.innerHTML = pending.slice(0, 3).map(o => `
      <div class="card-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
        <div>
          <div style="font-weight: 600;">${escapeHtml(o.title)}</div>
          <div class="card-meta">${escapeHtml(o.category)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong>$${(o.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>
          <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="window.toggleObligation('${o.id}', '${o.status}')">Pagar</button>
        </div>
      </div>
    `).join("");
  } else {
    upcomingSection.style.display = "none";
  }

  container.innerHTML = obligations.map(o => `
    <div class="card-item" style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div class="card-title">${escapeHtml(o.title)}</div>
        <div class="card-meta">${escapeHtml(o.category)} • ${o.isRecurring ? 'Recurrente' : 'Puntual'} ${o.isCreditCardSettlement ? '• Resumen Tarjeta' : ''}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="card-price" style="color: ${o.status === 'pagado' ? 'var(--success)' : 'var(--primary)'}">$${(o.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
        <button class="btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.toggleObligation('${o.id}', '${o.status}')">
          ${o.status === 'pagado' ? '✓ Pagado' : 'Marcar Pago'}
        </button>
      </div>
    </div>
  `).join("");
}

function renderReviewQueue() {
  const container = document.getElementById("reviewQueueList");
  const reviewItems = purchases.filter(p => p.status === "a_revisar");

  if (reviewItems.length === 0) {
    container.innerHTML = `<div class="empty-state">¡Excelente! No hay comprobantes pendientes de revisión.</div>`;
    return;
  }

  container.innerHTML = reviewItems.map(p => `
    <div class="card-item review-needed">
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(p.storeName)}</div>
          <div class="card-meta">${p.date ? new Date(p.date.toDate ? p.date.toDate() : p.date).toLocaleDateString("es-AR") : ''} • ${escapeHtml(p.paymentMethod)}</div>
        </div>
        <div class="card-price">$${(p.totalPaid || 0).toFixed(2)}</div>
      </div>
      ${p.reviewNotes && p.reviewNotes.length ? `
        <div style="margin: 8px 0; font-size: 0.8rem; background: rgba(0,0,0,0.05); padding: 6px 10px; border-radius: 6px;">
          ${p.reviewNotes.map(n => `<div>• ${escapeHtml(n)}</div>`).join("")}
        </div>
      ` : ''}
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <button class="btn-secondary" style="color: var(--danger); padding: 6px 12px; font-size: 0.8rem;" onclick="window.deletePurchase('${p.id}')">Eliminar</button>
        <button class="btn-primary" style="padding: 6px 14px; font-size: 0.8rem;" onclick="window.approvePurchase('${p.id}')">Aprobar</button>
      </div>
    </div>
  `).join("");
}

// -------------------------------------------------------------
// OPERACIONES GLOBALES (ACCESIBLES DESDE BOTONES HTML)
// -------------------------------------------------------------
window.approvePurchase = async (id) => {
  await updateDoc(doc(db, "purchases", id), { status: "confirmado" });
};

window.deletePurchase = async (id) => {
  if (confirm("¿Estás seguro de eliminar este comprobante?")) {
    await deleteDoc(doc(db, "purchases", id));
  }
};

window.toggleObligation = async (id, currentStatus) => {
  const newStatus = currentStatus === "pendiente" ? "pagado" : "pendiente";
  await updateDoc(doc(db, "obligations", id), { 
    status: newStatus,
    paidAt: newStatus === "pagado" ? serverTimestamp() : null
  });
};

// -------------------------------------------------------------
// PESTAÑAS
// -------------------------------------------------------------
document.querySelectorAll(".nav-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.style.display = "none");

    btn.classList.add("active");
    const target = btn.getAttribute("data-tab");
    document.getElementById(`tab-${target}`).style.display = "block";
  });
});

// -------------------------------------------------------------
// MODALES Y ENTRADA DE DATOS
// -------------------------------------------------------------
document.getElementById("btnOpenScan").addEventListener("click", () => modalScan.style.display = "flex");
document.getElementById("btnCloseScanModal").addEventListener("click", () => modalScan.style.display = "none");

document.getElementById("btnOpenManual").addEventListener("click", () => modalManual.style.display = "flex");
document.getElementById("btnCloseManualModal").addEventListener("click", () => modalManual.style.display = "none");

document.getElementById("btnSettings").addEventListener("click", () => {
  modalSettings.style.display = "flex";
  renderSettingsMembers();
});
document.getElementById("btnCloseSettingsModal").addEventListener("click", () => modalSettings.style.display = "none");

// Guardar gasto manual
document.getElementById("btnSaveManualExpense").addEventListener("click", async () => {
  const store = document.getElementById("manualStoreSelect").value;
  const amount = parseFloat(document.getElementById("manualAmountInput").value);
  const category = document.getElementById("manualCategorySelect").value;
  const description = document.getElementById("manualDescriptionInput").value;
  const paymentMethod = document.getElementById("manualPaymentMethodSelect").value;
  const manualArchiveNumber = document.getElementById("manualArchiveInput").value;

  if (isNaN(amount) || amount <= 0) {
    alert("Por favor ingresá un monto válido.");
    return;
  }

  const isPersonal = activeSpace === "personal";
  const hId = isPersonal ? "personal" : currentHousehold.id;
  const memberUids = isPersonal ? [currentUser.uid] : (currentHousehold ? currentHousehold.memberUids : [currentUser.uid]);

  const purchaseRef = doc(collection(db, "purchases"));
  const purchase = {
    householdId: hId,
    storeName: store,
    receiptType: "Gasto Manual",
    date: serverTimestamp(),
    subtotal: amount,
    discountsTotal: 0,
    totalPaid: amount,
    cashbackAmount: 0,
    effectiveCost: amount,
    paymentMethod: paymentMethod,
    status: "confirmado",
    manualArchiveNumber: manualArchiveNumber,
    createdByUid: currentUser.uid,
    lastModifiedByUid: currentUser.uid,
    memberUids: memberUids,
    createdAt: serverTimestamp()
  };

  const itemRef = doc(collection(db, "purchase_items"));
  const item = {
    purchaseId: purchaseRef.id,
    householdId: hId,
    rawDescription: description || category,
    canonicalProductName: description || category,
    quantity: 1,
    unitPrice: amount,
    lineTotal: amount,
    presentationValue: 1,
    presentationUnit: "unidad",
    unitPriceNormalized: amount,
    memberUids: memberUids,
    createdAt: serverTimestamp()
  };

  const batch = writeBatch(db);
  batch.set(purchaseRef, purchase);
  batch.set(itemRef, item);
  await batch.commit();

  modalManual.style.display = "none";
  document.getElementById("manualAmountInput").value = "";
  document.getElementById("manualDescriptionInput").value = "";
});

// Guardar nueva obligación
document.getElementById("btnNewObligation").addEventListener("click", async () => {
  const title = prompt("Concepto de la obligación (ej. Enersa Luz, Gas, Cuota):");
  if (!title) return;
  const amountStr = prompt("Monto en ARS:");
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return;

  const isPersonal = activeSpace === "personal";
  const hId = isPersonal ? "personal" : currentHousehold.id;
  const memberUids = isPersonal ? [currentUser.uid] : (currentHousehold ? currentHousehold.memberUids : [currentUser.uid]);

  await addDoc(collection(db, "obligations"), {
    householdId: hId,
    title: title,
    category: "Servicio",
    amount: amount,
    status: "pendiente",
    isRecurring: true,
    isCreditCardSettlement: false,
    createdByUid: currentUser.uid,
    memberUids: memberUids,
    createdAt: serverTimestamp()
  });
});

// Muestras de tickets para prueba inmediata
document.getElementById("btnSampleDia").addEventListener("click", () => {
  if (!confirm("OJO: este botón carga un ticket de EJEMPLO con datos falsos, no lee tu foto. ¿Cargar igual?")) return;
  processParsedTicket({
    storeName: "DIA%",
    receiptNumber: "0002-1249",
    totalPaid: 2600.00,
    subtotal: 2950.00,
    discountsTotal: 350.00,
    cashbackAmount: 0,
    paymentMethod: "qr_mercadopago",
    items: [
      { rawDescription: "LECHE SACHET 1L", canonicalProductName: "Leche sachet", quantity: 1, unitPrice: 1150, lineTotal: 1150, presentationValue: 1, presentationUnit: "l", unitPriceNormalized: 1150 },
      { rawDescription: "TAPAS ROTISERAS", canonicalProductName: "Tapas rotiseras", quantity: 2, unitPrice: 900, lineTotal: 1800, presentationValue: 2, presentationUnit: "unidad", unitPriceNormalized: 900 }
    ],
    doubtfulNotes: []
  });
});

document.getElementById("btnSampleChino").addEventListener("click", () => {
  if (!confirm("OJO: este botón carga un ticket de EJEMPLO con datos falsos, no lee tu foto. ¿Cargar igual?")) return;
  processParsedTicket({
    storeName: "Chino Roffo",
    receiptNumber: "",
    totalPaid: 2850.00,
    subtotal: 2850.00,
    discountsTotal: 0,
    cashbackAmount: 0,
    paymentMethod: "efectivo",
    items: [
      { rawDescription: "ARROZ 1KG", canonicalProductName: "Arroz blanco", quantity: 1, unitPrice: 1400, lineTotal: 1400, presentationValue: 1, presentationUnit: "kg", unitPriceNormalized: 1400 },
      { rawDescription: "FIDEOS TALLARIN 500G", canonicalProductName: "Fideos tallarines", quantity: 1, unitPrice: 950, lineTotal: 950, presentationValue: 0.5, presentationUnit: "kg", unitPriceNormalized: 1900 },
      { rawDescription: "VENTAS VARIAS", canonicalProductName: "sin detalle", quantity: 1, unitPrice: 500, lineTotal: 500, presentationValue: 1, presentationUnit: "unidad", unitPriceNormalized: 500 }
    ],
    doubtfulNotes: ["Comercio chino categorizado automáticamente por calle Roffo"]
  });
});

// -------------------------------------------------------------
// LECTURA REAL DE TICKETS CON GEMINI (Firebase AI Logic)
// -------------------------------------------------------------
const lineItemSchema = Schema.object({
  properties: {
    rawDescription: Schema.string({ description: "Descripción textual del producto tal cual figura en el ticket" }),
    canonicalName: Schema.string({ description: "Nombre genérico normalizado (ej: 'Tapas de empanadas rotiseras', 'Leche entera', 'Pechuga de pollo'). Si no tiene detalle (ej: 'ALMACEN', 'VARIOS'), escribir 'sin detalle'" }),
    brand: Schema.string({ description: "Marca si es visible, o vacío" }),
    quantity: Schema.number({ description: "Cantidad comprada (ej: 1, 2, 0.75)" }),
    unitPrice: Schema.number({ description: "Precio unitario bruto" }),
    discount: Schema.number({ description: "Descuento particular aplicado a esta línea" }),
    lineTotal: Schema.number({ description: "Importe final de la línea después del descuento" }),
    presentationValue: Schema.number({ description: "Valor numérico del peso/volumen/unidades (ej: 1 para 1 litro, 0.5 para 500g, 12 para docena)" }),
    presentationUnit: Schema.string({ description: "Unidad de medida: 'kg', 'g', 'l', 'ml' o 'unidad'" }),
    isDoubtful: Schema.boolean({ description: "True si el texto o número está borroso, roto o fue interpretado con duda" })
  }
});

const receiptSchema = Schema.object({
  properties: {
    storeName: Schema.string({ description: "Nombre comercial. Si es un chino de barrio sin nombre claro, usar 'Chino + calle' (ej: 'Chino Roffo'). Cadenas: DIA, Vea, Malambo, etc." }),
    receiptNumber: Schema.string({ description: "Número de comprobante" }),
    dateString: Schema.string({ description: "Fecha y hora en formato YYYY-MM-DD HH:mm, o vacío si no se lee" }),
    subtotal: Schema.number({ description: "Subtotal antes de descuentos globales" }),
    discountsTotal: Schema.number({ description: "Suma total de descuentos globales o cupones" }),
    totalPaid: Schema.number({ description: "Total efectivamente pagado en pesos argentinos (ARS)" }),
    cashbackAmount: Schema.number({ description: "Reintegro o cashback de billetera/banco si figura, registrado aparte" }),
    paymentMethod: Schema.string({ description: "Medio de pago: 'efectivo', 'debito', 'credito', 'qr_mercadopago', 'transferencia'. Si no se identifica, poner 'efectivo/transferencia'" }),
    items: Schema.array({ items: lineItemSchema, description: "Listado de líneas de compra" }),
    doubtfulNotes: Schema.array({ items: Schema.string(), description: "Notas sobre partes ilegibles, dudosas o que requieran revisión humana" })
  }
});

const PROMPT_TICKET = `Analizá la imagen de este comprobante/ticket de compra de Gualeguaychú, Entre Ríos, Argentina (en pesos ARS).
Extraé rigurosamente los datos respetando estas reglas:
1. NUNCA inventes datos. Si algo es ilegible o dudoso, marcalo en doubtfulNotes y poné isDoubtful=true en el ítem.
2. Comercios chinos de barrio: si no tienen marca corporativa, llamalos 'Chino + calle' (ej. Chino Roffo). Cadenas conocidas como DIA, Vea, Malambo o pollerías van por su nombre.
3. Líneas genéricas sin descripción ('ALMACEN', 'VENTAS VARIAS', 'COMESTIBLES') se deben categorizar como 'sin detalle'.
4. Distinguí matices: si son tapas de empanadas rotiseras no son lo mismo que comunes; si la leche es descremada o entera, indicalo.
5. Medios de pago: si no se reconoce explícitamente, indicá 'efectivo/transferencia'.
6. Reintegros o cashback: anotalos aparte en cashbackAmount sin alterar el total pagado del ticket.
7. Calculá bien la presentación (ej: 500 gramos = 0.5 kg, 1 litro = 1.0 l, o cantidad de unidades).`;

let receiptModel = null;
function getReceiptModel() {
  if (!receiptModel) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    receiptModel = getGenerativeModel(ai, {
      model: "gemini-3.8-flash",
      generationConfig: { responseMimeType: "application/json", responseSchema: receiptSchema }
    });
  }
  return receiptModel;
}

// Reduce la foto (los celulares sacan fotos enormes) y la pasa a base64 JPEG
async function imagenABase64(file, maxLado = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen"));
      i.src = url;
    });
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function num(v, porDefecto = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

async function leerTicketConGemini(file) {
  const base64 = await imagenABase64(file);
  const resultado = await Promise.race([
    getReceiptModel().generateContent([
      PROMPT_TICKET,
      { inlineData: { data: base64, mimeType: "image/jpeg" } }
    ]),
    new Promise((_, rej) => setTimeout(() => rej(new Error("La IA tardó demasiado (más de 60 segundos)")), 60000))
  ]);
  const json = JSON.parse(resultado.response.text());

  const items = (json.items || []).map(it => {
    const presVal = num(it.presentationValue, 1);
    const lineTotal = num(it.lineTotal, num(it.quantity, 1) * num(it.unitPrice) - num(it.discount));
    return {
      rawDescription: it.rawDescription || "Ítem",
      canonicalProductName: it.canonicalName || it.rawDescription || "sin detalle",
      brand: it.brand || "",
      quantity: num(it.quantity, 1),
      unitPrice: num(it.unitPrice),
      discount: num(it.discount),
      lineTotal: lineTotal,
      presentationValue: presVal,
      presentationUnit: it.presentationUnit || "unidad",
      unitPriceNormalized: presVal > 0 ? lineTotal / presVal : num(it.unitPrice),
      isDoubtful: !!it.isDoubtful
    };
  });

  // Fecha del ticket (si se pudo leer); si no, queda la fecha de carga
  let fecha = null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(json.dateString || "");
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
    if (!isNaN(d.getTime())) fecha = Timestamp.fromDate(d);
  }

  const notas = (json.doubtfulNotes || []).filter(n => n && n.trim());
  if (items.some(i => i.isDoubtful) && notas.length === 0) {
    notas.push("Hay líneas que la IA marcó como dudosas: revisalas");
  }

  const totalPaid = num(json.totalPaid);
  return {
    storeName: json.storeName || "Comercio",
    receiptNumber: json.receiptNumber || "",
    date: fecha,
    totalPaid: totalPaid,
    subtotal: num(json.subtotal) || (totalPaid + num(json.discountsTotal)),
    discountsTotal: num(json.discountsTotal),
    cashbackAmount: num(json.cashbackAmount),
    paymentMethod: json.paymentMethod || "efectivo/transferencia",
    items: items,
    doubtfulNotes: notas
  };
}

fileReceiptInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!currentUser) { alert("Iniciá sesión primero."); return; }
  scanLoadingIndicator.style.display = "block";
  try {
    const parsed = await leerTicketConGemini(file);
    if (!parsed.items.length || parsed.totalPaid <= 0) {
      throw new Error("La IA no pudo leer productos o el total del ticket. Probá con una foto más clara y de frente.");
    }
    await processParsedTicket(parsed);
  } catch (err) {
    console.error("Error leyendo ticket:", err);
    alert("No se pudo leer el ticket.\n\nDetalle: " + (err && err.message ? err.message : err));
  } finally {
    scanLoadingIndicator.style.display = "none";
    fileReceiptInput.value = "";
  }
});

async function processParsedTicket(parsed) {
  modalScan.style.display = "none";
  const isPersonal = activeSpace === "personal";
  const hId = isPersonal ? "personal" : currentHousehold.id;
  const memberUids = isPersonal ? [currentUser.uid] : (currentHousehold ? currentHousehold.memberUids : [currentUser.uid]);

  // Chequeo matemático
  const sumLines = parsed.items.reduce((acc, i) => acc + i.lineTotal, 0);
  const mathDiff = Math.abs(sumLines - parsed.totalPaid);
  const isDoubtful = mathDiff > 2.0 || parsed.doubtfulNotes.length > 0;

  const purchaseRef = doc(collection(db, "purchases"));
  const purchase = {
    householdId: hId,
    storeName: parsed.storeName,
    receiptNumber: parsed.receiptNumber || "",
    date: parsed.date || serverTimestamp(),
    subtotal: parsed.subtotal || parsed.totalPaid,
    discountsTotal: parsed.discountsTotal || 0,
    totalPaid: parsed.totalPaid,
    cashbackAmount: parsed.cashbackAmount || 0,
    effectiveCost: (parsed.totalPaid - (parsed.cashbackAmount || 0)),
    paymentMethod: parsed.paymentMethod || "efectivo/transferencia",
    status: isDoubtful ? "a_revisar" : "confirmado",
    reviewNotes: isDoubtful ? (parsed.doubtfulNotes || [`Diferencia de sumas: líneas suman $${sumLines.toFixed(2)} vs total $${parsed.totalPaid.toFixed(2)}`]) : [],
    createdByUid: currentUser.uid,
    lastModifiedByUid: currentUser.uid,
    memberUids: memberUids,
    createdAt: serverTimestamp()
  };

  const batch = writeBatch(db);
  batch.set(purchaseRef, purchase);

  parsed.items.forEach(item => {
    const itemRef = doc(collection(db, "purchase_items"));
    batch.set(itemRef, {
      purchaseId: purchaseRef.id,
      householdId: hId,
      rawDescription: item.rawDescription,
      canonicalProductName: item.canonicalProductName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      presentationValue: item.presentationValue || 1,
      presentationUnit: item.presentationUnit || "unidad",
      unitPriceNormalized: item.unitPriceNormalized || item.unitPrice,
      brand: item.brand || "",
      discount: item.discount || 0,
      isDoubtful: !!item.isDoubtful,
      memberUids: memberUids,
      createdAt: serverTimestamp()
    });
  });

  await batch.commit();
  alert(`¡Comprobante de ${parsed.storeName} registrado con éxito!`);
}

// -------------------------------------------------------------
// INVITACIONES
// -------------------------------------------------------------
function renderSettingsMembers() {
  const container = document.getElementById("membersList");
  if (!currentHousehold || !currentHousehold.members) {
    container.textContent = "Cargando integrantes...";
    return;
  }
  container.innerHTML = Object.entries(currentHousehold.members).map(([uid, role]) => `
    <div style="display: flex; justify-content: space-between; padding: 4px 0;">
      <span>Usuario (${uid.slice(0, 6)}...)</span>
      <strong style="color: var(--primary);">${role.toUpperCase()}</strong>
    </div>
  `).join("");
}

document.getElementById("btnGenerateInvite").addEventListener("click", async () => {
  if (!currentHousehold) return;
  const role = document.getElementById("inviteRoleSelect").value;
  const token = Math.random().toString(36).substring(2, 10).toUpperCase();

  await setDoc(doc(db, "invitations", token), {
    householdId: currentHousehold.id,
    householdName: currentHousehold.name,
    role: role,
    createdByUid: currentUser.uid,
    isRevoked: false,
    createdAt: serverTimestamp()
  });

  const resDiv = document.getElementById("inviteResult");
  resDiv.style.display = "block";
  resDiv.innerHTML = `
    <div style="font-size: 0.8rem; color: var(--text-muted);">Código generado para tu pareja:</div>
    <div style="font-size: 1.4rem; font-weight: 800; color: var(--primary);">${token}</div>
    <div style="font-size: 0.8rem;">Rol: <strong>${role.toUpperCase()}</strong></div>
  `;
});

document.getElementById("btnJoinHousehold").addEventListener("click", async () => {
  const code = document.getElementById("joinCodeInput").value.trim().toUpperCase();
  if (!code) return;

  const inviteSnap = await getDoc(doc(db, "invitations", code));
  if (!inviteSnap.exists()) {
    alert("Código de invitación no encontrado.");
    return;
  }
  const invite = inviteSnap.data();
  if (invite.isRevoked) {
    alert("Esta invitación fue revocada.");
    return;
  }

  const hRef = doc(db, "households", invite.householdId);
  const hSnap = await getDoc(hRef);
  if (!hSnap.exists()) {
    alert("Hogar no encontrado.");
    return;
  }

  const hData = hSnap.data();
  const updatedUids = Array.from(new Set([...(hData.memberUids || []), currentUser.uid]));
  const updatedMembers = { ...(hData.members || {}), [currentUser.uid]: invite.role };

  await updateDoc(hRef, {
    memberUids: updatedUids,
    members: updatedMembers
  });

  alert(`¡Te uniste con éxito a '${hData.name}'!`);
  modalSettings.style.display = "none";
});

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
