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
  getDocFromServer,
  serverTimestamp, 
  Timestamp, 
  writeBatch,
  runTransaction,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken as getAppCheckToken } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-ai.js";
import { numeroManual, buscarDuplicado, gruposPorTotal } from "./tickets.mjs?v=12";
import { calcularCorreccionProducto, camposProducto, precioNormalizadoProducto } from "./productos.mjs?v=12";
import { iniciarListas } from "./listas.js?v=17";
import { guardarPreferencias, leerPreferencias, periodosMensuales } from "./preferencias.mjs?v=16";

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
let appCheckInstance = null;
if (appCheckActivo) {
  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}
const auth = getAuth(app);
const db = getFirestore(app, databaseId);

// Estado de la aplicación
let currentUser = null;
let activeSpace = null; // ID del hogar seleccionado o "personal"
let dataScope = null;
let currentHousehold = null;
let userHouseholds = [];
let purchases = [];
let purchaseItems = [];
let obligations = [];
let purchasesReady = false;
let itemsReady = false;
let unsubHouseholds = null;

// Categorías oficiales de productos (las mismas que usabas en tus planillas)
const CATEGORIAS = ["Almacén", "Bebidas", "Carnes", "Frutas y verduras", "Golosinas y snacks", "Higiene personal", "Hogar", "Limpieza", "Lácteos y fiambres", "Panificados y harinas", "Sin detalle"];
window.CATEGORIAS = CATEGORIAS; // el frontend puede usar esta misma lista (por ejemplo en el formulario de gasto manual)
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function normalizarCategoria(txt) {
  const k = sinAcentos(txt);
  return CATEGORIAS.find(c => sinAcentos(c) === k) || "Sin detalle";
}

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
versionTag.textContent = "listas v17";
versionTag.style.cssText = "position:fixed;bottom:4px;left:6px;font-size:10px;opacity:.55;z-index:9999;pointer-events:none;";
document.body.appendChild(versionTag);
const shopping = iniciarListas({db,getData:()=>({purchases,items:purchaseItems,busy:!!actividadActual}),categorias:CATEGORIAS});

// Una tarea a la vez; las pestañas siguen disponibles mientras la IA trabaja.
let actividadActual = null;
const actividadEl = document.createElement("div");
actividadEl.className = "actividad-flotante";
actividadEl.hidden = true;
actividadEl.setAttribute("role", "status");
actividadEl.setAttribute("aria-live", "polite");
actividadEl.setAttribute("aria-atomic", "true");
actividadEl.innerHTML = '<span class="actividad-rueda" aria-hidden="true"></span><div><strong></strong><div class="actividad-texto"></div></div>';
document.body.appendChild(actividadEl);

function datosListos() {
  if (!currentUser) { alert("Primero iniciá sesión."); return false; }
  if (!purchasesReady) {
    alert("Esperá a que se carguen los tickets desde internet para poder comprobar que no estén repetidos.");
    return false;
  }
  return true;
}
function iniciarActividad(titulo, texto) {
  if (actividadActual) { alert("Hay una tarea en curso. Podés seguir navegando mientras termina."); return false; }
  if (!datosListos()) return false;
  actividadActual = { uid: currentUser.uid, espacio: activeSpace };
  actividadEl.querySelector("strong").textContent = titulo;
  actividadEl.querySelector(".actividad-texto").textContent = texto;
  actividadEl.hidden = false;
  controlesActividad(true);
  return true;
}
function controlesActividad(ocupado) {
  for (const id of ["spaceSelector", "btnAuth", "btnOpenScan", "btnOpenManual", "btnSaveManualExpense", "fileReceiptInput", "scanArchiveInput", "manualArchiveInput", "btnSampleDia", "btnSampleChino", "herrImportar", "herrCategorias", "productCorrectionFields", "btnSaveProductCorrection", "btnCloseProductCorrection"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = ocupado;
  }
}
function verificarContextoActividad() {
  if (!actividadActual || actividadActual.uid !== currentUser?.uid || actividadActual.espacio !== activeSpace) {
    throw new Error("Cambió la sesión o el espacio durante la tarea. Volvé a intentarlo en el espacio correcto.");
  }
}
function terminarActividad() {
  actividadActual = null;
  actividadEl.hidden = true;
  controlesActividad(false);
  shopping.procesarPendientes();
}

function pedirNumeroManual(input) {
  const numero = numeroManual(input.value);
  if (!numero) {
    alert("Ingresá el número que escribiste a mano en el ticket. Usá solo números, por ejemplo: 142.");
    input.focus();
  }
  return numero;
}
function resumenCompra(p) {
  return `${p.manualArchiveNumber ? "Nº manual " + p.manualArchiveNumber : "Sin número manual"} · ${p.storeName || "Comercio"} · ${fechaCorta(aFecha(p.date))} · ${moneda(p.totalPaid)}`;
}
function permitirTicket(ticket) {
  const coincidencia = buscarDuplicado(ticket, purchases);
  if (!coincidencia) return true;
  const { compra, motivo } = coincidencia;
  if (motivo !== "total") {
    alert(`Ese ${motivo === "numero" ? "número manual" : "comprobante"} ya está cargado.\n\n${resumenCompra(compra)}\n\nNo se guardó otra copia.`);
    return false;
  }
  return confirm(`Ya hay un ticket con exactamente el mismo total, aunque el comercio tenga otro nombre.\n\n${resumenCompra(compra)}\n\nSi es la misma compra, cancelá. ¿Confirmás que es otra compra distinta y querés guardarla?`);
}

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
  shopping.cambiarEspacio(null);
  if (unsubHouseholds) unsubHouseholds();
  if (unsubPurchases) unsubPurchases();
  if (unsubItems) unsubItems();
  if (unsubObligations) unsubObligations();
  currentHousehold = null;
  activeSpace = user ? lastSpace(user.uid) : null;
  dataScope = null;
  modalSettings.style.display = "none";
  userHouseholds = [];
  purchases = [];
  purchaseItems = [];
  obligations = [];
  purchasesReady = false;
  itemsReady = false;
  currentUser = user;
  cargarPreferenciasResumen(null);
  if (user) {
    renderAll();
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
  if (unsubHouseholds) unsubHouseholds();
  let creating = false;
  unsubHouseholds = onSnapshot(q, { includeMetadataChanges: true }, async (snapshot) => {
    if (currentUser?.uid !== uid) return;
    if (snapshot.metadata.fromCache && (snapshot.empty ||
        (activeSpace && activeSpace !== "personal" && !snapshot.docs.some(doc => doc.id === activeSpace)))) return;
    userHouseholds = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!userHouseholds.length && !creating) {
      creating = true;
      try {
        await setDoc(doc(collection(db, "households")), {
          name: "Hogar Gualeguaychú",
          adminUid: uid,
          memberUids: [uid],
          members: { [uid]: "admin" },
          createdAt: serverTimestamp()
        });
      } catch (error) {
        console.error("No se pudo crear el hogar inicial:", error);
      } finally {
        creating = false;
      }
    }
    if (currentUser?.uid !== uid) return;
    const fallback = userHouseholds.find(h => h.adminUid === uid) || userHouseholds[0];
    const selected = activeSpace === "personal" || userHouseholds.some(h => h.id === activeSpace)
      ? activeSpace : fallback?.id;
    selectSpace(selected || "personal");
  }, error => {
    console.error("No se pudieron cargar los hogares:", error);
  });
}

function lastSpace(uid) {
  try { return window.localStorage.getItem(`finanzas-espacio:${uid}`); }
  catch { return null; }
}

function selectSpace(id) {
  if (!currentUser) return;
  const household = userHouseholds.find(h => h.id === id);
  if (id !== "personal" && !household) return;
  activeSpace = id;
  currentHousehold = household || null;
  try { window.localStorage.setItem(`finanzas-espacio:${currentUser.uid}`, id); }
  catch { /* El selector también funciona sin almacenamiento local. */ }
  updateSpaceSelectorUI();
  document.getElementById("summarySpaceLabel").textContent = household
    ? `RESUMEN DE ${household.name.toUpperCase()}` : "RESUMEN PERSONAL";
  if (modalSettings.style.display === "flex") renderSettingsMembers();
  if (dataScope?.uid !== currentUser.uid || dataScope?.id !== id) listenData();
}

function updateSpaceSelectorUI() {
  spaceSelector.innerHTML = "";
  userHouseholds.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = `🏠 ${h.name} (${h.adminUid === currentUser.uid ? "Tu hogar" : "Compartido"})`;
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
  selectSpace(e.target.value);
});

// -------------------------------------------------------------
// SINCRONIZACIÓN EN TIEMPO REAL (FIRESTORE)
// -------------------------------------------------------------
let unsubPurchases = null;
let unsubItems = null;
let unsubObligations = null;

function listenData() {
  purchasesReady = false;
  itemsReady = false;
  purchases = [];
  purchaseItems = [];
  obligations = [];
  if (unsubPurchases) unsubPurchases();
  if (unsubItems) unsubItems();
  if (unsubObligations) unsubObligations();

  const isPersonal = activeSpace === "personal";
  const targetHouseholdId = isPersonal ? "personal" : (currentHousehold ? currentHousehold.id : "");
  if (!targetHouseholdId || !currentUser) return;
  const scope = { id: targetHouseholdId, uid: currentUser.uid };
  dataScope = scope;
  cargarPreferenciasResumen(scope);
  shopping.cambiarEspacio({ kind: isPersonal ? "users" : "households", id: isPersonal ? scope.uid : scope.id, uid: scope.uid });
  renderAll();

  const scopedQuery = collectionName => {
    const bySpace = where("householdId", "==", scope.id);
    return isPersonal
      ? query(collection(db, collectionName), bySpace, where("memberUids", "array-contains", scope.uid))
      : query(collection(db, collectionName), bySpace);
  };

  // 1. Compras
  unsubPurchases = onSnapshot(scopedQuery("purchases"), { includeMetadataChanges: true }, (snap) => {
    if (dataScope !== scope) return;
    purchasesReady = !snap.metadata.fromCache;
    if (!purchasesReady) return;
    purchases = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !isPersonal || p.createdByUid === scope.uid);
    purchases.sort((a, b) => {
      const da = a.date ? (a.date.toDate ? a.date.toDate() : new Date(a.date)) : new Date();
      const db = b.date ? (b.date.toDate ? b.date.toDate() : new Date(b.date)) : new Date();
      return db - da;
    });
    renderAll();
  }, (err) => {
    if (dataScope !== scope) return;
    purchasesReady = false;
    console.error("No se pudieron cargar los tickets:", err);
    alert("No se pudieron cargar los tickets. No se habilitarán nuevas cargas hasta poder comprobar los duplicados. Revisá tu conexión y volvé a abrir la app.");
  });

  // 2. Líneas de compra
  unsubItems = onSnapshot(scopedQuery("purchase_items"), { includeMetadataChanges: true }, (snap) => {
    if (dataScope !== scope) return;
    itemsReady = !snap.metadata.fromCache;
    if (!itemsReady) return;
    purchaseItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => {
    if (dataScope !== scope) return;
    itemsReady = false;
    console.error("No se pudieron cargar los productos:", err);
  });

  // 3. Obligaciones
  unsubObligations = onSnapshot(scopedQuery("obligations"), { includeMetadataChanges: true }, (snap) => {
    if (dataScope !== scope || snap.metadata.fromCache) return;
    obligations = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !isPersonal || o.createdByUid === scope.uid);
    renderAll();
  }, error => {
    if (dataScope === scope) console.error("No se pudieron cargar los pendientes:", error);
  });
}

// -------------------------------------------------------------
// RENDERIZADO DE INTERFAZ (FRONTEND - diseño v1, 01/11/2026)
// Pestañas: Resumen, Por categoría, Productos, Planilla, Revisión y pendientes
// -------------------------------------------------------------
const COLORES = ["#0F6E8C", "#E08A1E", "#2F9E6B", "#C0415E", "#7C5CC4", "#3B82C4", "#B8A21B", "#D2692F", "#4F9AA1", "#8A6F5C", "#7A8696"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MEDIOS = {
  "efectivo": "Efectivo",
  "debito": "Tarjeta de débito",
  "credito": "Tarjeta de crédito",
  "qr_mercadopago": "Mercado Pago (QR)",
  "transferencia": "Transferencia bancaria",
  "efectivo/transferencia": "Efectivo / transferencia"
};

// Filtros y orden que eligió la persona (se mantienen mientras la app está abierta)
const ui = {
  fecha: "todas", tienda: "todas", medio: "todos", categoria: "todas",
  obligEstado: "todas", planillaSub: "compras"
};
const sortState = { productos: { key: "compras", dir: "desc" } }; // orden por tabla
const filasAbiertas = new Set();                                   // filas desplegadas
const GRAFICOS_RESUMEN = {
  tienda: "Total pagado por tienda",
  medio: "Total pagado por medio de pago",
  categoria: "Gasto por categoría (neto de descuentos)"
};
const ORDEN_RESUMEN = Object.keys(GRAFICOS_RESUMEN);
let resumenPrefs = { orden: ORDEN_RESUMEN, ocultos: ["categoria"], vistas: [] };
let compararMeses = false;

// ---------- Ayudas chicas ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sumar = (lista, f) => lista.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const aFecha = (f) => f ? (f.toDate ? f.toDate() : new Date(f)) : null;

function moneda(n) {
  n = Number(n) || 0;
  const entero = Math.abs(n - Math.round(n)) < 0.005;
  return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 });
}
function numEs(n, dec = 2) { return (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: dec }); }
function medioLabel(m) { return m ? (MEDIOS[m] || m) : "Sin dato"; }
function fechaCorta(d) { return d ? d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", year: "numeric" }) : "—"; }
function horaDe(d) {
  if (!d || (d.getHours() === 0 && d.getMinutes() === 0)) return "—";
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function categoriaDe(i) { return (i.category && String(i.category).trim()) || "Sin detalle"; }
function costoRealDe(p) { return p.effectiveCost != null ? p.effectiveCost : (p.totalPaid || 0) - (p.cashbackAmount || 0); }
function unidadCorta(u) { return u === "kg" ? "/kg" : (u === "l" ? "/l" : "/u"); }

// Factor por el que se multiplican los precios de un ticket para reflejar su reintegro
// (ej: reintegro de $9.500 sobre un ticket de $50.087 => factor 0,8103, o sea 18,97% más barato)
function factorReintegro(purchaseId) {
  const p = purchases.find(x => x.id === purchaseId);
  if (!p || !(p.totalPaid > 0) || !(p.cashbackAmount > 0)) return 1;
  return Math.max(0, 1 - Math.min(1, p.cashbackAmount / p.totalPaid));
}

// ---------- Filtros ----------
function listaTiendas() { return [...new Set(purchases.map(p => p.storeName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")); }
function listaMedios() { return [...new Set(purchases.map(p => medioLabel(p.paymentMethod)))].sort((a, b) => a.localeCompare(b, "es")); }
function listaCategorias() { return [...new Set(purchaseItems.map(categoriaDe))].sort((a, b) => a.localeCompare(b, "es")); }

function opcionesFecha() {
  const meses = new Set();
  purchases.forEach(p => {
    const d = aFecha(p.date);
    if (d) meses.add(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  });
  const lista = [["todas", "Todas las fechas"], ["este_mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["30", "Últimos 30 días"]];
  [...meses].sort().reverse().forEach(k => {
    const [y, m] = k.split("-");
    lista.push([k, MESES[Number(m) - 1] + " " + y]);
  });
  return lista;
}

function coincideFecha(p) {
  const f = ui.fecha;
  if (f === "todas") return true;
  const d = aFecha(p.date);
  if (!d) return false;
  const hoy = new Date();
  if (f === "este_mes") return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
  if (f === "mes_anterior") {
    const a = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    return d.getFullYear() === a.getFullYear() && d.getMonth() === a.getMonth();
  }
  if (f === "30") return (hoy - d) / 86400000 <= 30;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") === f;
}

// usar: lista de filtros extra a aplicar además de la fecha ("tienda", "medio")
function comprasFiltradas(usar = [], fecha = coincideFecha) {
  return purchases.filter(p =>
    fecha(p) &&
    (!usar.includes("tienda") || ui.tienda === "todas" || p.storeName === ui.tienda) &&
    (!usar.includes("medio") || ui.medio === "todos" || medioLabel(p.paymentMethod) === ui.medio)
  );
}

function validarFiltros() {
  if (ui.tienda !== "todas" && !listaTiendas().includes(ui.tienda)) ui.tienda = "todas";
  if (ui.medio !== "todos" && !listaMedios().includes(ui.medio)) ui.medio = "todos";
  if (ui.categoria !== "todas" && !listaCategorias().includes(ui.categoria)) ui.categoria = "todas";
  if (!opcionesFecha().some(o => o[0] === ui.fecha)) ui.fecha = "todas";
}

function barraFiltros(campos) {
  const defs = {
    fecha: opcionesFecha(),
    tienda: [["todas", "Todas las tiendas"], ...listaTiendas().map(t => [t, t])],
    medio: [["todos", "Todos los medios"], ...listaMedios().map(m => [m, m])],
    categoria: [["todas", "Todas las categorías"], ...listaCategorias().map(c => [c, c])],
    obligEstado: [["todas", "Todos los estados"], ["pendiente", "Pendientes"], ["pagado", "Pagadas"]]
  };
  return campos.map(c =>
    `<select class="filtro-select" data-filtro="${c}">` +
    defs[c].map(([v, t]) => `<option value="${esc(v)}" ${ui[c] === v ? "selected" : ""}>${esc(t)}</option>`).join("") +
    `</select>`
  ).join("");
}

// ---------- Piezas visuales ----------
function tarjetaKpi(titulo, valor, extra = "") {
  return `<div class="kpi ${extra}"><div class="kpi-titulo">${esc(titulo)}</div><div class="kpi-valor">${valor}</div></div>`;
}

function barrasHtml(datos) {
  if (!datos.length) return `<div class="vacio">Sin datos para mostrar.</div>`;
  const max = Math.max(...datos.map(d => d.valor), 1);
  return `<div class="barras">` + datos.map(d => `
    <div class="barra-fila">
      <span class="barra-nombre">${esc(d.nombre)}</span>
      <span class="barra-pista"><span class="barra-relleno" style="width:${Math.max(2, d.valor / max * 100)}%"></span></span>
      <span class="barra-valor">${moneda(d.valor)}</span>
    </div>`).join("") + `</div>`;
}

function donutHtml(datos) {
  datos = datos.filter(d => d.valor > 0);
  const total = sumar(datos, d => d.valor);
  if (!(total > 0)) return `<div class="vacio">Sin datos para mostrar.</div>`;
  let acum = 0;
  const tramos = datos.map((d, i) => {
    const ini = acum / total * 100;
    acum += d.valor;
    return `${COLORES[i % COLORES.length]} ${ini}% ${acum / total * 100}%`;
  });
  const leyenda = datos.map((d, i) => `
    <li>
      <span class="punto" style="background:${COLORES[i % COLORES.length]}"></span>
      <span class="ley-nombre">${esc(d.nombre)}</span>
      <span class="ley-valor">${moneda(d.valor)}</span>
      <span class="ley-pct">${Math.round(d.valor / total * 100)}%</span>
    </li>`).join("");
  return `<div class="donut-box">
    <div class="donut" style="background: conic-gradient(${tramos.join(", ")})"><div class="donut-hueco"></div></div>
    <ul class="leyenda">${leyenda}</ul>
  </div>`;
}

function cardGrafico(titulo, contenido) {
  return `<div class="card-grafico"><h3>${esc(titulo)}</h3>${contenido}</div>`;
}

// ---------- Tabla genérica: ordena al tocar el título y despliega filas ----------
// cols: [{ key, label, num, cls, valor(r), render(r) }]   opc: { orden, detalle(r), vacio }
function tablaHtml(id, cols, filas, opc = {}) {
  if (!filas.length) return `<div class="vacio">${opc.vacio || "No hay datos para mostrar."}</div>`;
  const st = sortState[id] || opc.orden || null;
  const datos = [...filas];
  if (st) {
    const c = cols.find(x => x.key === st.key);
    if (c) {
      const val = c.valor || (r => r[c.key]);
      datos.sort((a, b) => {
        const x = val(a), y = val(b);
        const r = (typeof x === "string" || typeof y === "string")
          ? String(x ?? "").localeCompare(String(y ?? ""), "es")
          : (x ?? 0) - (y ?? 0);
        return st.dir === "asc" ? r : -r;
      });
    }
  }
  const cabecera = cols.map(c => {
    const activo = st && st.key === c.key;
    const flecha = activo ? (st.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th class="${c.cls || ""} ${c.num ? "num" : ""}" data-sort="${c.key}" data-tabla="${id}">${esc(c.label)}${flecha}</th>`;
  }).join("");
  const cuerpo = datos.map(r => {
    const clave = id + ":" + r.id;
    const abierta = opc.detalle && filasAbiertas.has(clave);
    const fila = `<tr class="${opc.detalle ? "expandible" : ""} ${abierta ? "abierta" : ""} ${r._clase || ""}" ${opc.detalle ? `data-fila="${esc(clave)}"` : ""}>` +
      cols.map(c => `<td class="${c.cls || ""} ${c.num ? "num" : ""}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("") + `</tr>`;
    const detalle = abierta ? `<tr class="detalle-fila"><td colspan="${cols.length}">${opc.detalle(r)}</td></tr>` : "";
    return fila + detalle;
  }).join("");
  return `<div class="tabla-wrap"><table class="tabla"><thead><tr>${cabecera}</tr></thead><tbody>${cuerpo}</tbody></table></div>`;
}

// ---------- Detalle de un comprobante (se abre al tocar la fila) ----------
function detalleCompra(p) {
  const items = purchaseItems.filter(i => i.purchaseId === p.id);
  const pct = p.totalPaid > 0 && p.cashbackAmount > 0 ? numEs(p.cashbackAmount / p.totalPaid * 100) + "%" : "";
  const revisar = p.status === "a_revisar";
  const filas = items.map(i => `
    <tr>
      <td>${esc(i.rawDescription || i.canonicalProductName)}${i.isDoubtful ? ' <span class="badge-pill warning">dudoso</span>' : ""}<br><button class="btn-chico" onclick="window.editarCategoria('${i.id}')">🏷 ${esc(categoriaDe(i))} ✎</button> <button class="btn-chico" onclick="window.editarProducto('${i.id}')">✎ Corregir producto</button></td>
      <td class="num">${numEs(i.quantity || 1, 3)}</td>
      <td class="num hide-sm">${moneda(i.unitPrice)}</td>
      <td class="num hide-sm">${i.discount > 0 ? "-" + moneda(i.discount) : "—"}</td>
      <td class="num">${moneda(i.lineTotal)}</td>
    </tr>`).join("");
  return `
    <div class="detalle-compra">
      <div class="detalle-meta">
        <span>💳 ${esc(medioLabel(p.paymentMethod))}</span>
        ${p.receiptNumber ? `<span>🧾 ${esc(p.receiptNumber)}</span>` : ""}
        <span>🗂 Nº manual: <strong>${esc(p.manualArchiveNumber || "Sin asignar")}</strong></span>
        ${p.discountsTotal > 0 ? `<span class="verde">Ahorro: ${moneda(p.discountsTotal)}</span>` : ""}
        ${p.cashbackAmount > 0 ? `<span class="azul">Reintegro: ${moneda(p.cashbackAmount)} (${pct})</span>` : ""}
      </div>
      ${p.reviewNotes && p.reviewNotes.length ? `<div class="notas-revision">${p.reviewNotes.map(n => `<div>• ${esc(n)}</div>`).join("")}</div>` : ""}
      ${items.length ? `<div class="tabla-wrap"><table class="tabla mini"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num hide-sm">Precio</th><th class="num hide-sm">Desc.</th><th class="num">Total</th></tr></thead><tbody>${filas}</tbody></table></div>` : `<div class="vacio">Sin detalle de productos.</div>`}
      <div class="detalle-acciones">
        <button class="btn-chico" onclick="window.editarNumeroManual('${p.id}')">✎ Número manual</button>
        <button class="btn-chico" onclick="window.editarReintegro('${p.id}')">💸 ${p.cashbackAmount > 0 ? "Editar reintegro" : "Agregar reintegro"}</button>
        ${revisar ? `<button class="btn-chico btn-ok" onclick="window.approvePurchase('${p.id}')">✓ Aprobar</button>` : ""}
        <button class="btn-chico btn-peligro" onclick="window.deletePurchase('${p.id}')">🗑 Eliminar</button>
      </div>
    </div>`;
}

// ---------- Columnas de las tablas de compras ----------
function colsCompras(tipo) {
  const nro = { key: "n", label: "Nº manual", valor: r => numeroManual(r.manualArchiveNumber).padStart(32, "0"), render: r => esc(r.manualArchiveNumber || "Sin asignar") };
  const fechaHora = { key: "fecha", label: "Fecha", valor: r => (aFecha(r.date) || 0).valueOf(), render: r => { const d = aFecha(r.date); const h = horaDe(d); return fechaCorta(d) + (h !== "—" ? ` <span class="suave">· ${h}</span>` : ""); } };
  const tienda = { key: "storeName", label: "Tienda", valor: r => r.storeName || "" };
  const medio = { key: "medio", label: "Medio de pago", cls: "hide-sm", valor: r => medioLabel(r.paymentMethod), render: r => esc(medioLabel(r.paymentMethod)) };
  const total = { key: "totalPaid", label: "Total pagado", num: true, valor: r => r.totalPaid || 0, render: r => moneda(r.totalPaid) };
  if (tipo === "resumen") {
    return [{ ...nro, cls: "hide-sm" }, fechaHora, tienda, medio, total,
      { key: "cashbackAmount", label: "Reintegro", num: true, cls: "hide-sm", valor: r => r.cashbackAmount || 0, render: r => r.cashbackAmount > 0 ? moneda(r.cashbackAmount) : "—" },
      { key: "costo", label: "Costo real", num: true, valor: r => costoRealDe(r), render: r => moneda(costoRealDe(r)) },
      { key: "status", label: "Control", cls: "centro", valor: r => r.status === "a_revisar" ? 0 : 1, render: r => r.status === "a_revisar" ? '<span class="control-warn" title="A revisar">⚠</span>' : '<span class="control-ok" title="Confirmado">✓</span>' }
    ];
  }
  // planilla
  return [nro,
    { key: "fecha", label: "Fecha", valor: r => (aFecha(r.date) || 0).valueOf(), render: r => fechaCorta(aFecha(r.date)) },
    { key: "hora", label: "Hora", cls: "hide-sm", valor: r => horaDe(aFecha(r.date)), render: r => horaDe(aFecha(r.date)) },
    { key: "storeName", label: "Comercio", valor: r => r.storeName || "" },
    medio,
    { key: "tipo", label: "Comprobante", cls: "hide-sm", valor: r => r.receiptType || "", render: r => esc(r.receiptType || "—") },
    { key: "nro", label: "N° comprobante", cls: "hide-sm", valor: r => r.receiptNumber || "", render: r => esc(r.receiptNumber || "—") },
    total
  ];
}

// ---------- Dibujo principal ----------
function renderAll() {
  try {
    validarFiltros();
    renderEncabezado();
    renderResumen();
    renderCategorias();
    renderProductos();
    renderPlanilla();
    renderRevision();
    shopping.actualizarCatalogo();
  } catch (err) {
    console.error("Error dibujando la pantalla:", err);
  }
}

function renderEncabezado() {
  const fechas = purchases.map(p => aFecha(p.date)).filter(Boolean).sort((a, b) => b - a);
  const ultima = fechas.length ? ` Última compra: ${fechaCorta(fechas[0])}.` : "";
  document.getElementById("pageSubtitle").textContent =
    `Gastos, categorías, precios por producto y pendientes. ${purchases.length} comprobantes cargados.${ultima}`;

  const aRevisar = purchases.filter(p => p.status === "a_revisar").length;
  const pendientes = obligations.filter(o => o.status === "pendiente").length;
  const total = aRevisar + pendientes + gruposPorTotal(purchases).length;
  if (total > 0) {
    revisionBadge.textContent = total;
    revisionBadge.style.display = "inline-block";
  } else {
    revisionBadge.style.display = "none";
  }
}

// ----- Pestaña 1: RESUMEN -----
function cargarPreferenciasResumen(scope) {
  const saved = leerPreferencias("resumen", scope);
  const orden = Array.isArray(saved.orden) ? saved.orden.filter(id => ORDEN_RESUMEN.includes(id)) : [];
  resumenPrefs = {
    orden: [...new Set([...orden, ...ORDEN_RESUMEN])],
    ocultos: Array.isArray(saved.ocultos) ? saved.ocultos : ["categoria"],
    vistas: Array.isArray(saved.vistas) ? saved.vistas.filter(v => typeof v?.nombre === "string") : []
  };
  compararMeses = false;
  document.getElementById("resumenPersonalizar").open = false;
  document.getElementById("resumenNombreVista").value = "";
  document.getElementById("resumenVistasEstado").textContent = "";
  renderControlesResumen();
}

function renderControlesResumen() {
  const { orden, ocultos, vistas } = resumenPrefs;
  document.getElementById("resumenOrdenGraficos").innerHTML = orden.map((id, index) => {
    const title = GRAFICOS_RESUMEN[id];
    return `<div class="resumen-opcion">
      <label class="check-repetidos"><input type="checkbox" data-resumen-grafico="${id}" ${ocultos.includes(id) ? "" : "checked"}>${esc(title)}</label>
      <button type="button" class="btn-chico" data-grafico="${id}" data-mover="-1" aria-label="Subir ${esc(title)}" ${index === 0 ? "disabled" : ""}>Subir</button>
      <button type="button" class="btn-chico" data-grafico="${id}" data-mover="1" aria-label="Bajar ${esc(title)}" ${index === orden.length - 1 ? "disabled" : ""}>Bajar</button>
    </div>`;
  }).join("");
  document.getElementById("resumenVistasGuardadas").innerHTML = vistas.map((vista, i) =>
    `<button type="button" class="chip" data-abrir-vista="${i}">${esc(vista.nombre)}</button>`
  ).join("");
  document.getElementById("resumenGestionVistas").innerHTML = vistas.map((vista, i) =>
    `<div class="resumen-opcion"><span>${esc(vista.nombre)}</span><button type="button" class="btn-chico" data-borrar-vista="${i}" aria-label="Quitar vista ${esc(vista.nombre)}">Quitar vista</button></div>`
  ).join("");
}

function actualizarPreferenciasResumen(next, message = "Preferencias guardadas.") {
  const status = document.getElementById("resumenVistasEstado");
  if (!guardarPreferencias("resumen", dataScope, next)) {
    status.textContent = "Este navegador no pudo guardar tus preferencias.";
    return false;
  }
  resumenPrefs = next;
  status.textContent = message;
  renderControlesResumen();
  renderResumen();
  return true;
}

document.getElementById("btnCompararMeses").addEventListener("click", () => {
  compararMeses = !compararMeses;
  renderResumen();
});
document.getElementById("resumenVistasGuardadas").addEventListener("click", e => {
  const button = e.target.closest("[data-abrir-vista]");
  if (!button) return;
  const vista = resumenPrefs.vistas[Number(button.dataset.abrirVista)];
  if (!vista) return;
  ui.fecha = vista.fecha;
  ui.tienda = vista.tienda;
  ui.medio = vista.medio;
  compararMeses = vista.comparar === true;
  renderAll();
});
document.getElementById("resumenGuardarVista").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("resumenNombreVista"), nombre = input.value.trim();
  if (!nombre || nombre.length > 48) {
    document.getElementById("resumenVistasEstado").textContent = "Escribí un nombre de hasta 48 caracteres.";
    return;
  }
  const vista = { nombre, fecha: ui.fecha, tienda: ui.tienda, medio: ui.medio, comparar: compararMeses };
  const vistas = [...resumenPrefs.vistas];
  const index = vistas.findIndex(v => sinAcentos(v.nombre) === sinAcentos(nombre));
  if (index < 0) vistas.push(vista);
  else vistas[index] = vista;
  if (actualizarPreferenciasResumen({ ...resumenPrefs, vistas }, "Vista guardada.")) input.value = "";
});
document.getElementById("resumenGestionVistas").addEventListener("click", e => {
  const button = e.target.closest("[data-borrar-vista]");
  if (!button) return;
  const vistas = resumenPrefs.vistas.filter((_, i) => i !== Number(button.dataset.borrarVista));
  if (actualizarPreferenciasResumen({ ...resumenPrefs, vistas }, "Vista quitada.")) document.getElementById("resumenNombreVista").focus();
});
document.getElementById("resumenOrdenGraficos").addEventListener("change", e => {
  const id = e.target.dataset.resumenGrafico;
  if (!ORDEN_RESUMEN.includes(id)) return;
  const ocultos = resumenPrefs.ocultos.filter(grafico => grafico !== id);
  if (!e.target.checked) ocultos.push(id);
  if (!actualizarPreferenciasResumen({ ...resumenPrefs, ocultos })) e.target.checked = !e.target.checked;
  else document.getElementById("resumenOrdenGraficos").querySelector(`[data-resumen-grafico="${id}"]`).focus();
});
document.getElementById("resumenOrdenGraficos").addEventListener("click", e => {
  const button = e.target.closest("[data-mover]");
  if (!button) return;
  const { grafico, mover } = button.dataset;
  const orden = [...resumenPrefs.orden], from = orden.indexOf(grafico), to = from + Number(mover);
  if (from < 0 || to < 0 || to >= orden.length) return;
  [orden[from], orden[to]] = [orden[to], orden[from]];
  if (actualizarPreferenciasResumen({ ...resumenPrefs, orden })) {
    document.getElementById("resumenOrdenGraficos").querySelector(`[data-resumen-grafico="${grafico}"]`).focus();
  }
});

function dentroDelPeriodo(p, periodo) {
  const fecha = aFecha(p.date);
  return fecha && fecha >= periodo.inicio && fecha < periodo.fin;
}

function renderComparacion(periodos, listas) {
  const labels = ["Este mes", "Mes anterior"];
  const totales = listas.map(lista => sumar(lista, costoRealDe));
  const diferencia = totales[0] - totales[1];
  const cifras = periodos.map(({ inicio, fin }, i) => {
    const ultimoDia = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - 1).getDate();
    const mes = MESES[inicio.getMonth()].toLowerCase();
    return `<div><strong>${labels[i]}</strong><span class="card-meta">Del 1 al ${ultimoDia} de ${mes} de ${inicio.getFullYear()} · ${listas[i].length} compras</span><strong>${moneda(totales[i])}</strong></div>`;
  }).join("");
  const diferenciaHtml = `<p>Diferencia <strong>${diferencia > 0 ? "+" : diferencia < 0 ? "−" : ""}${moneda(Math.abs(diferencia))}</strong></p>`;
  return cardGrafico("Este mes vs. el anterior", `<p class="card-meta">Costo real después de reintegros, con el mismo corte de días. Abajo se muestran las compras de este mes.</p><div class="resumen-periodos">${cifras}</div>${diferenciaHtml}`);
}

function renderResumen() {
  const compareButton = document.getElementById("btnCompararMeses");
  compareButton.setAttribute("aria-pressed", String(compararMeses));
  compareButton.classList.toggle("active", compararMeses);
  document.getElementById("filtros-resumen").innerHTML = barraFiltros(compararMeses ? ["tienda", "medio"] : ["fecha", "tienda", "medio"]);
  const filtros = ["tienda", "medio"];
  const periodos = compararMeses ? periodosMensuales(new Date()) : null;
  const lista = comprasFiltradas(filtros, periodos ? p => dentroDelPeriodo(p, periodos[0]) : coincideFecha);
  const comparacion = document.getElementById("resumenComparacion");
  comparacion.hidden = !compararMeses;
  comparacion.innerHTML = periodos ? renderComparacion(periodos, [lista, comprasFiltradas(filtros, p => dentroDelPeriodo(p, periodos[1]))]) : "";

  document.getElementById("resumenKpis").innerHTML =
    tarjetaKpi("Total pagado", moneda(sumar(lista, p => p.totalPaid))) +
    tarjetaKpi("Reintegros", moneda(sumar(lista, p => p.cashbackAmount)), "kpi-azul") +
    tarjetaKpi("Costo real (neto de reintegros)", moneda(sumar(lista, costoRealDe)), "destacado") +
    tarjetaKpi("Descuentos en tickets", moneda(sumar(lista, p => p.discountsTotal)), "kpi-verde") +
    tarjetaKpi("Compras registradas", String(lista.length));

  const porTienda = {};
  const porMedio = {};
  lista.forEach(p => {
    const t = p.storeName || "Comercio";
    porTienda[t] = (porTienda[t] || 0) + (p.totalPaid || 0);
    const m = medioLabel(p.paymentMethod);
    porMedio[m] = (porMedio[m] || 0) + (p.totalPaid || 0);
  });
  const ordenar = (obj) => Object.entries(obj).map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor);

  const charts = {
    tienda: () => barrasHtml(ordenar(porTienda)),
    medio: () => donutHtml(ordenar(porMedio)),
    categoria: () => {
      const ids = new Set(lista.map(p => p.id)), porCategoria = {};
      for (const item of purchaseItems) {
        if (!ids.has(item.purchaseId)) continue;
        const nombre = categoriaDe(item);
        porCategoria[nombre] = (porCategoria[nombre] || 0) + (item.lineTotal || 0);
      }
      return donutHtml(ordenar(porCategoria));
    }
  };
  document.getElementById("resumenGraficos").innerHTML = resumenPrefs.orden.filter(id => !resumenPrefs.ocultos.includes(id))
    .map(id => cardGrafico(GRAFICOS_RESUMEN[id], charts[id]())).join("");

  document.getElementById("resumenCount").textContent = `${lista.length} registros · tocá una fila para ver el detalle`;
  document.getElementById("resumenCompras").innerHTML = tablaHtml(
    "compras-resumen", colsCompras("resumen"), lista,
    { orden: { key: "fecha", dir: "desc" }, detalle: detalleCompra, vacio: "No hay comprobantes con estos filtros." }
  );
}

// ----- Pestaña 2: POR CATEGORÍA -----
function renderCategorias() {
  document.getElementById("filtros-categoria").innerHTML = barraFiltros(["fecha", "categoria", "tienda"]);
  const ids = new Set(comprasFiltradas(["tienda"]).map(p => p.id));
  const items = purchaseItems.filter(i => ids.has(i.purchaseId) && (ui.categoria === "todas" || categoriaDe(i) === ui.categoria));

  const gasto = {};
  const ahorro = {};
  items.forEach(i => {
    const c = categoriaDe(i);
    gasto[c] = (gasto[c] || 0) + (i.lineTotal || 0);
    ahorro[c] = (ahorro[c] || 0) + (i.discount || 0);
  });
  const ordenar = (obj) => Object.entries(obj).map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor);

  const sinCategorias = purchaseItems.length > 0 && purchaseItems.every(i => categoriaDe(i) === "Sin detalle");
  const aviso = sinCategorias
    ? `<div class="aviso">ℹ️ Todavía ningún producto tiene categoría asignada, por eso todo aparece como "Sin detalle". Cuando la IA las asigne al leer los tickets, este gráfico se completa solo.</div>`
    : "";

  document.getElementById("categoriaContenido").innerHTML = aviso + `<div class="graficos">` +
    cardGrafico("Gasto por categoría (neto de descuentos)", donutHtml(ordenar(gasto))) +
    cardGrafico("Ahorro por descuentos, por categoría", barrasHtml(ordenar(ahorro).filter(d => d.valor > 0))) +
    `</div>`;
}

// ----- Pestaña 3: PRODUCTOS -----
function agruparProductos() {
  const grupos = {};
  purchaseItems.forEach(i => {
    const nombre = (i.canonicalProductName || "").trim();
    if (!nombre || nombre.toLowerCase() === "sin detalle") return;
    const k = nombre.toLowerCase();
    (grupos[k] = grupos[k] || []).push(i);
  });
  const compraDe = {};
  purchases.forEach(p => { compraDe[p.id] = p; });

  return Object.keys(grupos).map(k => {
    const items = grupos[k];
    const tiendas = [...new Set(items.map(i => compraDe[i.purchaseId] && compraDe[i.purchaseId].storeName).filter(Boolean))];
    const cuentaUnidad = {};
    items.forEach(i => { const u = i.presentationUnit || "unidad"; cuentaUnidad[u] = (cuentaUnidad[u] || 0) + 1; });
    const unidad = Object.entries(cuentaUnidad).sort((a, b) => b[1] - a[1])[0][0];
    const precios = items.filter(i => (i.presentationUnit || "unidad") === unidad).map(i => precioNormalizadoProducto(i) * factorReintegro(i.purchaseId)).filter(x => x > 0);
    return {
      id: k,
      nombre: items[0].canonicalProductName,
      items, tiendas, unidad, compraDe,
      compras: new Set(items.map(i => i.purchaseId)).size,
      min: precios.length ? Math.min(...precios) : 0,
      max: precios.length ? Math.max(...precios) : 0,
      avg: precios.length ? sumar(precios, x => x) / precios.length : 0,
      gasto: sumar(items, i => i.lineTotal)
    };
  });
}

function detalleProducto(g) {
  const precioReal = (i) => precioNormalizadoProducto(i) * factorReintegro(i.purchaseId);
  const conPrecio = g.items.filter(i => precioReal(i) > 0 && (i.presentationUnit || "unidad") === g.unidad);
  const mejor = conPrecio.length ? Math.min(...conPrecio.map(precioReal)) : null;
  const ordenados = [...g.items].sort((a, b) => ((aFecha((g.compraDe[b.purchaseId] || {}).date) || 0) - (aFecha((g.compraDe[a.purchaseId] || {}).date) || 0)));
  const filas = ordenados.map(i => {
    const p = g.compraDe[i.purchaseId] || {};
    const pr = precioReal(i);
    const f = factorReintegro(i.purchaseId);
    const pagado = f < 1 ? `${moneda(i.lineTotal)} <span class="suave">→ ${moneda(i.lineTotal * f)}</span>` : moneda(i.lineTotal);
    return `<tr class="${mejor !== null && pr === mejor && (i.presentationUnit || "unidad") === g.unidad ? "mejor" : ""}">
      <td>${fechaCorta(aFecha(p.date))}<div class="correction-mobile"><button class="btn-chico" onclick="window.editarProducto('${i.id}')">✎ Corregir</button></div></td>
      <td>${esc(p.storeName || "—")}</td>
      <td class="hide-sm">${esc(i.brand || i.rawDescription || "—")}</td>
      <td class="hide-sm">${i.presentationValue ? numEs(i.presentationValue, 3) + " " + esc(i.presentationUnit || "") : "—"}</td>
      <td class="num">${numEs(i.quantity || 1, 3)}</td>
      <td class="num hide-sm">${pagado}</td>
      <td class="num"><strong>${moneda(pr)}</strong> <span class="suave">${unidadCorta(i.presentationUnit || "unidad")}</span></td>
      <td class="hide-sm"><button class="btn-chico" onclick="window.editarProducto('${i.id}')">✎ Corregir</button></td>
    </tr>`;
  }).join("");
  return `<div class="detalle-meta" style="margin-bottom:8px;"><span>Gasto total: <strong>${moneda(g.gasto)}</strong></span><span>Rango: ${moneda(g.min)} – ${moneda(g.max)} <span class="suave">${unidadCorta(g.unidad)}</span></span></div>
    <div class="tabla-wrap"><table class="tabla mini"><thead><tr>
      <th>Fecha</th><th>Tienda</th><th class="hide-sm">Marca / detalle</th><th class="hide-sm">Presentación</th><th class="num">Cant.</th><th class="num hide-sm">Pagado</th><th class="num">Precio kg/l/u</th><th class="hide-sm">Corregir</th>
    </tr></thead><tbody>${filas}</tbody></table></div>
    <div class="suave" style="margin-top:6px;">En verde: el precio más barato. Si el ticket tuvo reintegro, el precio ya lo descuenta.${g.items.some(i => (i.presentationUnit || "unidad") !== g.unidad) ? " Hay unidades diferentes: el promedio compara solo las filas con la misma unidad; corregí las otras para incluirlas." : ""}</div>`;
}

function renderProductos() {
  const busqueda = document.getElementById("prodSearch").value.toLowerCase().trim();
  const soloRepetidos = document.getElementById("prodRepetidos").checked;
  const todos = agruparProductos();

  document.getElementById("productosResumen").textContent =
    `${todos.length} productos distintos · ${purchaseItems.length} líneas de compra · ${purchases.length} tickets`;

  const filas = todos.filter(g =>
    (!soloRepetidos || g.compras >= 2) &&
    (!busqueda || g.items.some(i => `${i.canonicalProductName} ${i.brand || ""} ${i.rawDescription || ""}`.toLowerCase().includes(busqueda)))
  );

  // El selector de orden refleja el orden actual
  const st = sortState.productos;
  const sel = document.getElementById("prodOrden");
  const valor = st.key + ":" + st.dir;
  sel.value = [...sel.options].some(o => o.value === valor) ? valor : "custom";

  const cols = [
    { key: "nombre", label: "Producto", valor: g => g.nombre, render: g => `<span class="flecha">›</span> <strong>${esc(g.nombre)}</strong>` },
    { key: "compras", label: "Compras", num: true, valor: g => g.compras },
    { key: "tienda", label: "Tienda", cls: "hide-sm", valor: g => g.tiendas.length > 1 ? "Varias" : (g.tiendas[0] || ""), render: g => g.tiendas.length > 1 ? `Varias <span class="suave">(${g.tiendas.length})</span>` : esc(g.tiendas[0] || "—") },
    { key: "avg", label: "Precio promedio", num: true, valor: g => g.avg, render: g => `${moneda(g.avg)} <span class="suave">${unidadCorta(g.unidad)}</span>` },
    { key: "rango", label: "Mínimo – máximo", num: true, cls: "hide-sm", valor: g => g.min, render: g => `${moneda(g.min)} – ${moneda(g.max)}` },
    { key: "gasto", label: "Gasto total", num: true, cls: "hide-sm", valor: g => g.gasto, render: g => moneda(g.gasto) }
  ];
  document.getElementById("productosTabla").innerHTML = tablaHtml(
    "productos", cols, filas,
    { detalle: detalleProducto, vacio: "No hay productos que coincidan con la búsqueda." }
  );
}

// ----- Pestaña 4: PLANILLA -----
function renderPlanilla() {
  const sub = ui.planillaSub;
  document.querySelectorAll("#planillaChips .chip").forEach(c => c.classList.toggle("active", c.dataset.sub === sub));
  document.getElementById("obligacionesToolbar").style.display = sub === "obligaciones" ? "flex" : "none";

  const camposFiltro = { compras: ["fecha", "tienda", "medio"], items: ["fecha", "tienda", "medio"], comercios: ["fecha"], medios: ["fecha"], obligaciones: ["obligEstado"] };
  document.getElementById("filtros-planilla").innerHTML = barraFiltros(camposFiltro[sub]);

  const q = document.getElementById("planillaSearch").value.toLowerCase().trim();
  const coincide = (texto) => !q || texto.toLowerCase().includes(q);
  let filas = [];
  let html = "";

  if (sub === "compras") {
    filas = comprasFiltradas(["tienda", "medio"]).filter(p => coincide(`${p.manualArchiveNumber || ""} ${p.storeName} ${medioLabel(p.paymentMethod)} ${p.receiptNumber || ""} ${p.receiptType || ""} ${fechaCorta(aFecha(p.date))}`));
    html = tablaHtml("planilla-compras", colsCompras("planilla"), filas,
      { orden: { key: "fecha", dir: "desc" }, detalle: detalleCompra, vacio: "No hay comprobantes con estos filtros." });
  } else if (sub === "items") {
    const compraDe = {};
    comprasFiltradas(["tienda", "medio"]).forEach(p => { compraDe[p.id] = p; });
    filas = purchaseItems.filter(i => compraDe[i.purchaseId]).map(i => ({ ...i, _p: compraDe[i.purchaseId] }))
      .filter(i => coincide(`${i.rawDescription} ${i.canonicalProductName} ${i.brand || ""} ${i._p.storeName}`));
    const cols = [
      { key: "fecha", label: "Fecha", valor: r => (aFecha(r._p.date) || 0).valueOf(), render: r => fechaCorta(aFecha(r._p.date)) },
      { key: "tienda", label: "Comercio", cls: "hide-sm", valor: r => r._p.storeName || "", render: r => esc(r._p.storeName) },
      { key: "rawDescription", label: "Producto", valor: r => r.rawDescription || "" },
      { key: "brand", label: "Marca", cls: "hide-sm", valor: r => r.brand || "", render: r => esc(r.brand || "—") },
      { key: "quantity", label: "Cant.", num: true, valor: r => r.quantity || 0, render: r => numEs(r.quantity || 1, 3) },
      { key: "unitPrice", label: "Precio", num: true, cls: "hide-sm", valor: r => r.unitPrice || 0, render: r => moneda(r.unitPrice) },
      { key: "discount", label: "Desc.", num: true, cls: "hide-sm", valor: r => r.discount || 0, render: r => r.discount > 0 ? "-" + moneda(r.discount) : "—" },
      { key: "lineTotal", label: "Total", num: true, valor: r => r.lineTotal || 0, render: r => moneda(r.lineTotal) },
      { key: "norm", label: "Precio kg/l/u", num: true, cls: "hide-sm", valor: precioNormalizadoProducto, render: r => `${moneda(precioNormalizadoProducto(r))} <span class="suave">${unidadCorta(r.presentationUnit)}</span>` },
      { key: "corregir", label: "Corregir", render: r => `<button class="btn-chico" onclick="window.editarProducto('${r.id}')">✎ Corregir</button>` }
    ];
    html = tablaHtml("planilla-items", cols, filas, { orden: { key: "fecha", dir: "desc" }, vacio: "No hay productos con estos filtros." });
  } else if (sub === "comercios") {
    const mapa = {};
    comprasFiltradas().forEach(p => {
      const t = p.storeName || "Comercio";
      const m = mapa[t] = mapa[t] || { id: t, tienda: t, compras: 0, total: 0, desc: 0, reint: 0, ultima: 0 };
      m.compras++; m.total += p.totalPaid || 0; m.desc += p.discountsTotal || 0; m.reint += p.cashbackAmount || 0;
      m.ultima = Math.max(m.ultima, (aFecha(p.date) || 0).valueOf());
    });
    filas = Object.values(mapa).filter(m => coincide(m.tienda));
    const cols = [
      { key: "tienda", label: "Comercio", valor: r => r.tienda },
      { key: "compras", label: "Compras", num: true, valor: r => r.compras },
      { key: "total", label: "Total pagado", num: true, valor: r => r.total, render: r => moneda(r.total) },
      { key: "prom", label: "Ticket promedio", num: true, cls: "hide-sm", valor: r => r.total / r.compras, render: r => moneda(r.total / r.compras) },
      { key: "desc", label: "Descuentos", num: true, cls: "hide-sm", valor: r => r.desc, render: r => moneda(r.desc) },
      { key: "reint", label: "Reintegros", num: true, cls: "hide-sm", valor: r => r.reint, render: r => moneda(r.reint) },
      { key: "ultima", label: "Última compra", num: true, valor: r => r.ultima, render: r => fechaCorta(r.ultima ? new Date(r.ultima) : null) }
    ];
    html = tablaHtml("planilla-comercios", cols, filas, { orden: { key: "total", dir: "desc" } });
  } else if (sub === "medios") {
    const mapa = {};
    const lista = comprasFiltradas();
    const totalGral = sumar(lista, p => p.totalPaid);
    lista.forEach(p => {
      const t = medioLabel(p.paymentMethod);
      const m = mapa[t] = mapa[t] || { id: t, medio: t, compras: 0, total: 0 };
      m.compras++; m.total += p.totalPaid || 0;
    });
    filas = Object.values(mapa).filter(m => coincide(m.medio));
    const cols = [
      { key: "medio", label: "Medio de pago", valor: r => r.medio },
      { key: "compras", label: "Compras", num: true, valor: r => r.compras },
      { key: "total", label: "Total pagado", num: true, valor: r => r.total, render: r => moneda(r.total) },
      { key: "pct", label: "% del total", num: true, valor: r => r.total, render: r => totalGral > 0 ? numEs(r.total / totalGral * 100, 1) + "%" : "—" }
    ];
    html = tablaHtml("planilla-medios", cols, filas, { orden: { key: "total", dir: "desc" } });
  } else {
    filas = obligations.filter(o => (ui.obligEstado === "todas" || o.status === ui.obligEstado) && coincide(`${o.title} ${o.category || ""}`));
    const cols = [
      { key: "title", label: "Concepto", valor: o => o.title || "" },
      { key: "category", label: "Categoría", cls: "hide-sm", valor: o => o.category || "", render: o => esc(o.category || "—") },
      { key: "tipo", label: "Tipo", cls: "hide-sm", valor: o => o.isRecurring ? "Recurrente" : "Puntual", render: o => (o.isRecurring ? "Recurrente" : "Puntual") + (o.isCreditCardSettlement ? " · Resumen tarjeta" : "") },
      { key: "amount", label: "Monto", num: true, valor: o => o.amount || 0, render: o => moneda(o.amount) },
      { key: "status", label: "Estado", cls: "centro", valor: o => o.status || "", render: o => `<button class="btn-chico ${o.status === "pagado" ? "btn-ok" : ""}" onclick="window.toggleObligation('${o.id}', '${o.status}')">${o.status === "pagado" ? "✓ Pagado" : "Marcar pago"}</button>` }
    ];
    html = tablaHtml("planilla-obligaciones", cols, filas, { orden: { key: "status", dir: "desc" }, vacio: "No hay obligaciones cargadas." }) +
      `<div class="aviso" style="margin-top:12px;">💳 <strong>Control anti-duplicación:</strong> el pago de un resumen de tarjeta es una salida de fondos para cancelar el saldo; las compras individuales ya se registran en la fecha en que se hicieron.</div>`;
  }

  document.getElementById("planillaCount").textContent = `${filas.length} registros`;
  document.getElementById("planillaContenido").innerHTML = html;
}

// ----- Pestaña 5: REVISIÓN Y PENDIENTES -----
function renderRevision() {
  const aRevisar = purchases.filter(p => p.status === "a_revisar");
  const pendientes = obligations.filter(o => o.status === "pendiente");
  const compraDe = {};
  purchases.forEach(p => { compraDe[p.id] = p; });
  const dudosos = purchaseItems.filter(i => i.isDoubtful && compraDe[i.purchaseId]);

  const grupos = gruposPorTotal(purchases);
  let html = `<div class="section-title"><span>Tickets con el mismo total</span><span class="muted">${grupos.length} ${grupos.length === 1 ? "grupo" : "grupos"}</span></div>
    <div class="aviso aviso-warn">Revisá estos grupos para encontrar compras cargadas más de una vez. Se comparan los totales aunque cambie el nombre del comercio. No se elimina nada automáticamente.</div>`;
  html += grupos.length ? grupos.map((grupo, indice) => {
    const cols = [
      { key: "manual", label: "Nº manual", valor: p => p.manualArchiveNumber || "", render: p => esc(p.manualArchiveNumber || "Sin asignar") },
      { key: "storeName", label: "Comercio", valor: p => p.storeName || "" },
      { key: "fecha", label: "Fecha", valor: p => (aFecha(p.date) || 0).valueOf(), render: p => fechaCorta(aFecha(p.date)) + " · " + horaDe(aFecha(p.date)) },
      { key: "items", label: "Productos", num: true, valor: p => purchaseItems.filter(i => i.purchaseId === p.id).length, render: p => itemsReady ? purchaseItems.filter(i => i.purchaseId === p.id).length : "Cargando…" },
      { key: "cashbackAmount", label: "Reintegro", num: true, valor: p => p.cashbackAmount || 0, render: p => moneda(p.cashbackAmount) }
    ];
    return `<h3>${moneda(grupo[0].totalPaid)} · ${grupo.length} registros</h3>` + tablaHtml(`duplicados-${indice}`, cols, grupo, { detalle: detalleCompra });
  }).join("") : `<div class="vacio">No hay tickets con el mismo total en este espacio.</div>`;
  html += `<div class="section-title"><span>Comprobantes a revisar</span><span class="muted">${aRevisar.length}</span></div>
    <div class="aviso aviso-warn">⚠️ Tickets donde la suma de las líneas no coincide con el total pagado, con datos dudosos o con comercios no reconocidos.</div>`;

  html += aRevisar.length ? `<div class="items-list">` + aRevisar.map(p => `
    <div class="card-item review-needed">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(p.storeName || "Comercio")}</div>
          <div class="card-meta">${fechaCorta(aFecha(p.date))} · ${esc(medioLabel(p.paymentMethod))}</div>
        </div>
        <div class="card-price">${moneda(p.totalPaid)}</div>
      </div>
      ${p.reviewNotes && p.reviewNotes.length ? `<div class="notas-revision">${p.reviewNotes.map(n => `<div>• ${esc(n)}</div>`).join("")}</div>` : ""}
      <div class="detalle-acciones">
        <button class="btn-chico" onclick="window.editarReintegro('${p.id}')">💸 Reintegro</button>
        <button class="btn-chico btn-peligro" onclick="window.deletePurchase('${p.id}')">🗑 Eliminar</button>
        <button class="btn-chico btn-ok" onclick="window.approvePurchase('${p.id}')">✓ Aprobar</button>
      </div>
    </div>`).join("") + `</div>`
    : `<div class="vacio">¡Excelente! No hay comprobantes pendientes de revisión.</div>`;

  if (dudosos.length) {
    const cols = [
      { key: "fecha", label: "Fecha", valor: r => (aFecha(compraDe[r.purchaseId].date) || 0).valueOf(), render: r => fechaCorta(aFecha(compraDe[r.purchaseId].date)) },
      { key: "tienda", label: "Tienda", cls: "hide-sm", valor: r => compraDe[r.purchaseId].storeName || "", render: r => esc(compraDe[r.purchaseId].storeName) },
      { key: "rawDescription", label: "Producto dudoso", valor: r => r.rawDescription || "" },
      { key: "lineTotal", label: "Total", num: true, valor: r => r.lineTotal || 0, render: r => moneda(r.lineTotal) }
    ];
    html += `<div class="section-title" style="margin-top:24px;"><span>Productos dudosos</span><span class="muted">${dudosos.length}</span></div>` +
      tablaHtml("dudosos", cols, dudosos, { orden: { key: "fecha", dir: "desc" } });
  }

  html += `<div class="section-title" style="margin-top:24px;"><span>Obligaciones pendientes</span><span class="muted">${pendientes.length}</span></div>`;
  html += pendientes.length ? `<div class="items-list">` + pendientes.map(o => `
    <div class="card-item fila-obligacion">
      <div>
        <div class="card-title">${esc(o.title)}</div>
        <div class="card-meta">${esc(o.category || "")} · ${o.isRecurring ? "Recurrente" : "Puntual"}${o.isCreditCardSettlement ? " · Resumen tarjeta" : ""}</div>
      </div>
      <div class="fila-obligacion-der">
        <strong>${moneda(o.amount)}</strong>
        <button class="btn-chico btn-ok" onclick="window.toggleObligation('${o.id}', '${o.status}')">Pagar</button>
      </div>
    </div>`).join("") + `</div>`
    : `<div class="vacio">No hay obligaciones pendientes.</div>`;

  document.getElementById("revisionContenido").innerHTML = html;
}

// ---------- Eventos de la pantalla (filtros, orden, filas desplegables) ----------
document.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-filtro]");
  if (sel) { ui[sel.dataset.filtro] = sel.value; renderAll(); return; }
  if (e.target.id === "prodOrden") {
    if (e.target.value !== "custom") {
      const [key, dir] = e.target.value.split(":");
      sortState.productos = { key, dir };
    }
    renderAll();
  } else if (e.target.id === "prodRepetidos") {
    renderAll();
  }
});

document.addEventListener("input", (e) => {
  if (["prodSearch", "planillaSearch"].includes(e.target.id)) renderAll();
});

document.addEventListener("click", (e) => {
  // Cambiar de sub-pestaña en la Planilla
  const chip = e.target.closest("#planillaChips .chip");
  if (chip) { ui.planillaSub = chip.dataset.sub; renderAll(); return; }

  // Ordenar tocando el título de una columna
  const th = e.target.closest("th[data-sort]");
  if (th) {
    const tabla = th.dataset.tabla;
    const key = th.dataset.sort;
    const actual = sortState[tabla];
    if (actual && actual.key === key) sortState[tabla] = { key, dir: actual.dir === "asc" ? "desc" : "asc" };
    else sortState[tabla] = { key, dir: th.classList.contains("num") ? "desc" : "asc" };
    renderAll();
    return;
  }

  // Abrir o cerrar el detalle de una fila
  const tr = e.target.closest("tr[data-fila]");
  if (tr && !e.target.closest("button, a, input, select")) {
    const clave = tr.dataset.fila;
    if (filasAbiertas.has(clave)) filasAbiertas.delete(clave); else filasAbiertas.add(clave);
    renderAll();
  }
});

// -------------------------------------------------------------
// OPERACIONES GLOBALES (ACCESIBLES DESDE BOTONES HTML)
// -------------------------------------------------------------
window.approvePurchase = async (id) => {
  await updateDoc(doc(db, "purchases", id), { status: "confirmado" });
};

// Convierte lo que escribe la persona ("9500", "9.500", "9.500,50", "$ 9500") en un número
function parseMonto(txt) {
  let t = String(txt).replace(/[$\s]/g, "");
  if (t === "") return null;
  if (t.includes(".") && t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.includes(",")) {
    t = t.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Agregar, cambiar o quitar el reintegro (cashback) de un comprobante
window.editarReintegro = async (id) => {
  const p = purchases.find(x => x.id === id);
  if (!p) return;
  const total = p.totalPaid || 0;
  const fmt = (n) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const actual = p.cashbackAmount > 0 ? String(p.cashbackAmount).replace(".", ",") : "";

  const txt = prompt(
    `${p.storeName || "Comprobante"} por $${fmt(total)}\n\n¿Cuánto te reintegraron, en pesos? (ejemplo: 9500)\nPoné 0 para quitar el reintegro.`,
    actual
  );
  if (txt === null) return;

  const monto = parseMonto(txt);
  if (monto === null || monto < 0) {
    alert("No entendí ese monto. Escribí solo el número, por ejemplo: 9500");
    return;
  }
  if (monto > total) {
    alert("El reintegro no puede ser mayor al total del comprobante ($" + fmt(total) + ").");
    return;
  }

  const pct = total > 0 ? (monto / total) * 100 : 0;
  if (monto > 0) {
    const ok = confirm(
      `Reintegro: $${fmt(monto)} = ${pct.toFixed(2).replace(".", ",")}% del ticket.\n` +
      `Costo real de la compra: $${fmt(total - monto)}\n\n` +
      `Todos los productos de este ticket se van a mostrar con ese porcentaje menos en la comparación de precios.\n\n¿Guardar?`
    );
    if (!ok) return;
  }

  try {
    await updateDoc(doc(db, "purchases", id), {
      cashbackAmount: monto,
      effectiveCost: total - monto,
      lastModifiedByUid: currentUser.uid
    });
  } catch (err) {
    console.error("Error guardando reintegro:", err);
    alert("No se pudo guardar el reintegro.\n\nDetalle: " + (err && err.message ? err.message : err));
  }
};

window.deletePurchase = async (id) => {
  if (actividadActual || !datosListos()) return;
  if (!itemsReady) { alert("Esperá a que se carguen todos los productos antes de eliminar un ticket."); return; }
  const p = purchases.find(x => x.id === id);
  const detalle = p ? ` de ${p.storeName || "comercio"} por $${(p.totalPaid || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "";
  if (!confirm(`¿Eliminar el comprobante${detalle}?\n\nSe borra también el detalle de sus productos. No se puede deshacer.`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "purchases", id));
    purchaseItems.filter(i => i.purchaseId === id).forEach(i => batch.delete(doc(db, "purchase_items", i.id)));
    await batch.commit();
  } catch (err) {
    console.error("Error al eliminar:", err);
    alert("No se pudo eliminar.\n\nDetalle: " + (err && err.message ? err.message : err));
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
// CORREGIR LOS DATOS DE UN PRODUCTO EN UNA COMPRA
// -------------------------------------------------------------
let edicionProducto = null;
const modalProducto = document.getElementById("modalProductCorrection");
const errorProducto = document.getElementById("productCorrectionError");

function datosFormularioProducto() {
  const valor = id => document.getElementById(id).value;
  return calcularCorreccionProducto({
    canonicalProductName: valor("correctionName"), brand: valor("correctionBrand"), category: valor("correctionCategory"),
    quantity: valor("correctionQuantity"), lineTotal: valor("correctionTotal"),
    presentationValue: valor("correctionContent"), presentationUnit: valor("correctionUnit"),
    discount: edicionProducto?.original.discount ?? 0
  });
}

function actualizarPreviewProducto() {
  const preview = document.getElementById("productCorrectionPreview");
  const guardar = document.getElementById("btnSaveProductCorrection");
  try {
    const datos = datosFormularioProducto();
    const factor = factorReintegro(edicionProducto?.purchaseId);
    preview.textContent = `${moneda(datos.lineTotal)} ÷ (${numEs(datos.quantity, 6)} × ${numEs(datos.presentationValue, 6)} ${datos.presentationUnit}) = ${moneda(datos.unitPriceNormalized)} ${unidadCorta(datos.presentationUnit)}` +
      (factor < 1 ? ` · Con reintegro: ${moneda(datos.unitPriceNormalized * factor)} ${unidadCorta(datos.presentationUnit)}` : "");
    errorProducto.textContent = "";
    guardar.disabled = !!actividadActual;
  } catch (err) {
    preview.textContent = "Completá los datos para ver el precio por kilo, litro o unidad.";
    errorProducto.textContent = err.message;
    guardar.disabled = true;
  }
}

window.editarProducto = (id) => {
  if (actividadActual || !datosListos()) return;
  if (!itemsReady) { alert("Esperá a que se carguen los productos."); return; }
  const item = purchaseItems.find(i => i.id === id);
  const compra = item && purchases.find(p => p.id === item.purchaseId);
  if (!item || !compra) return;
  edicionProducto = { id, purchaseId: item.purchaseId, espacio: activeSpace, uid: currentUser.uid, original: camposProducto(item) };
  document.getElementById("productCorrectionContext").textContent = resumenCompra(compra);
  document.getElementById("productCorrectionOriginal").textContent = "Texto del ticket: " + (item.rawDescription || "Sin detalle");
  const asignar = (id, valor) => { document.getElementById(id).value = valor; };
  asignar("correctionName", item.canonicalProductName || item.rawDescription || "");
  asignar("correctionBrand", item.brand || "");
  const categorias = [...new Set([...CATEGORIAS, categoriaDe(item)])];
  document.getElementById("correctionCategory").innerHTML = categorias.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  asignar("correctionCategory", categoriaDe(item));
  asignar("correctionQuantity", item.quantity > 0 ? item.quantity : 1);
  asignar("correctionTotal", item.lineTotal ?? 0);
  asignar("correctionContent", item.presentationValue > 0 ? item.presentationValue : 1);
  asignar("correctionUnit", ["kg", "l", "unidad"].includes(item.presentationUnit) ? item.presentationUnit : "unidad");
  actualizarPreviewProducto();
  modalProducto.style.display = "flex";
}

document.getElementById("productCorrectionForm").addEventListener("input", actualizarPreviewProducto);
document.getElementById("btnCloseProductCorrection").addEventListener("click", () => {
  if (actividadActual) return;
  modalProducto.style.display = "none";
  edicionProducto = null;
});
document.getElementById("productCorrectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (actividadActual || !edicionProducto || !datosListos()) return;
  const edicion = edicionProducto;
  if (edicion.uid !== currentUser.uid || edicion.espacio !== activeSpace || !purchases.some(p => p.id === edicion.purchaseId)) {
    errorProducto.textContent = "Cambió la sesión o el espacio. Cerrá esta ventana y volvé a abrir el producto.";
    return;
  }
  let datos;
  try { datos = datosFormularioProducto(); }
  catch (err) { errorProducto.textContent = err.message; return; }
  if (!iniciarActividad("Guardando corrección", datos.canonicalProductName)) return;
  try {
    const itemRef = doc(db, "purchase_items", edicion.id);
    const compraRef = doc(db, "purchases", edicion.purchaseId);
    await runTransaction(db, async transaction => {
      const itemSnap = await transaction.get(itemRef);
      const compraSnap = await transaction.get(compraRef);
      verificarContextoActividad();
      if (!itemSnap.exists() || !compraSnap.exists()) throw new Error("El producto o su ticket ya no existe. Cerrá la ventana y revisá la lista.");
      const actual = itemSnap.data(), compra = compraSnap.data();
      if (actual.purchaseId !== edicion.purchaseId || JSON.stringify(camposProducto(actual)) !== JSON.stringify(edicion.original)) {
        throw new Error("Este producto cambió mientras lo estabas corrigiendo. Cerrá la ventana y abrilo de nuevo para ver los datos actuales.");
      }
      const hogarEsperado = activeSpace === "personal" ? "personal" : currentHousehold?.id;
      if (actual.householdId !== hogarEsperado || compra.householdId !== hogarEsperado ||
          (hogarEsperado === "personal" && compra.createdByUid !== currentUser.uid)) {
        throw new Error("El producto no pertenece al espacio que estás usando.");
      }
      transaction.update(itemRef, {
        ...datos, manuallyCorrected: true, lastModifiedByUid: currentUser.uid, updatedAt: serverTimestamp(),
        lastManualCorrection: { before: camposProducto(actual), byUid: currentUser.uid, at: serverTimestamp() }
      });
      const cambioImporte = Math.round(datos.lineTotal * 100) !== Math.round(Number(actual.lineTotal || 0) * 100);
      const cabecera = { lastModifiedByUid: currentUser.uid, updatedAt: serverTimestamp() };
      if (cambioImporte) {
        cabecera.status = "a_revisar";
        cabecera.reviewNotes = [...(compra.reviewNotes || []), `Se corrigió el importe de «${datos.canonicalProductName}»: ${moneda(actual.lineTotal)} → ${moneda(datos.lineTotal)}. Revisá la suma de productos y el total del ticket.`];
      }
      transaction.update(compraRef, cabecera);
    });
    modalProducto.style.display = "none";
    edicionProducto = null;
  } catch (err) {
    console.error("Error guardando corrección:", err);
    errorProducto.textContent = "No se pudo guardar. " + err.message;
  } finally {
    terminarActividad();
  }
});

// -------------------------------------------------------------
// CATEGORÍAS: corregir a mano y completar las que faltan con IA
// -------------------------------------------------------------
async function guardarCategorias(items, categoria) {
  for (let k = 0; k < items.length; k += 400) {
    const batch = writeBatch(db);
    items.slice(k, k + 400).forEach(i => batch.update(doc(db, "purchase_items", i.id), { category: categoria }));
    await batch.commit();
  }
}

// Cambiar la categoría de un producto (y, si querés, de todos los que se llaman igual)
window.editarCategoria = async (itemId) => {
  const it = purchaseItems.find(x => x.id === itemId);
  if (!it) return;
  const nombre = it.canonicalProductName || it.rawDescription || "producto";
  const lista = CATEGORIAS.map((c, k) => `${k + 1}) ${c}`).join("\n");
  const resp = prompt(`Categoría de «${nombre}»\nActual: ${categoriaDe(it)}\n\n${lista}\n\nEscribí el NÚMERO de la categoría (o un nombre nuevo):`);
  if (resp === null) return;
  const t = resp.trim();
  if (!t) return;
  let nueva;
  if (/^\d+$/.test(t) && +t >= 1 && +t <= CATEGORIAS.length) nueva = CATEGORIAS[+t - 1];
  else nueva = CATEGORIAS.find(c => sinAcentos(c) === sinAcentos(t)) || (t.charAt(0).toUpperCase() + t.slice(1));

  const iguales = purchaseItems.filter(x => x.id !== it.id && categoriaDe(x) !== nueva &&
    sinAcentos(x.canonicalProductName || x.rawDescription) === sinAcentos(nombre));
  let aplicar = [it];
  if (iguales.length && confirm(`¿Poner «${nueva}» también a los otros ${iguales.length} productos llamados «${nombre}»?\n\nAceptar = a todos. Cancelar = solo a este.`)) {
    aplicar = [it, ...iguales];
  }
  try {
    await guardarCategorias(aplicar, nueva);
  } catch (err) {
    console.error("Error guardando categoría:", err);
    alert("No se pudo guardar la categoría.\n\nDetalle: " + (err && err.message ? err.message : err));
  }
};

const esquemaCategorias = Schema.object({
  properties: {
    productos: Schema.array({
      items: Schema.object({
        properties: {
          numero: Schema.number({ description: "Número del producto en la lista recibida" }),
          categoria: Schema.string({ description: "Una de las categorías permitidas, escrita exactamente igual" })
        }
      })
    })
  }
});
const modelosCategorias = {};
function getModeloCategorias(nombre) {
  if (!modelosCategorias[nombre]) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    modelosCategorias[nombre] = getGenerativeModel(ai, {
      model: nombre,
      generationConfig: { responseMimeType: "application/json", responseSchema: esquemaCategorias }
    });
  }
  return modelosCategorias[nombre];
}

// Le pide a la IA una categoría para cada nombre. Devuelve { numero: categoria }
async function pedirCategoriasIA(nombres) {
  const prompt = `Asigná una categoría a cada producto de un supermercado o almacén de Argentina.
Categorías permitidas (usá exactamente estas, sin inventar otras): ${CATEGORIAS.join(", ")}.
Si no podés saber qué es el producto, usá "Sin detalle".
Devolvé en "productos" un elemento por cada producto, con su "numero" y su "categoria".

Productos:
${nombres.map((n, k) => `${k + 1}. ${n}`).join("\n")}`;
  let ultimoError = null;
  for (const nombreModelo of MODELOS_TICKET) {
    try {
      const r = await Promise.race([
        getModeloCategorias(nombreModelo).generateContent(prompt),
        new Promise((_, rej) => setTimeout(() => rej(new Error("La IA tardó demasiado (más de 45 segundos)")), 45000))
      ]);
      const json = JSON.parse(r.response.text());
      const mapa = {};
      (json.productos || []).forEach(p => { mapa[Math.round(num(p.numero))] = normalizarCategoria(p.categoria); });
      return mapa;
    } catch (e) {
      ultimoError = e;
      if (!esErrorTemporal(e)) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error("La IA está saturada en este momento. Probá de nuevo en unos minutos. (" + (ultimoError && ultimoError.message ? ultimoError.message : ultimoError) + ")");
}

// Completa con IA la categoría de los productos que todavía no tienen
window.categorizarPendientes = async () => {
  if (actividadActual) { alert("Esperá a que termine la tarea actual."); return; }
  if (!currentUser) { alert("Primero iniciá sesión."); return; }
  const pend = purchaseItems.filter(i => !(i.category && String(i.category).trim()));
  if (!pend.length) { alert("Todos los productos ya tienen categoría. 👍"); return; }
  const nombreDe = (i) => (i.canonicalProductName || i.rawDescription || "").trim();
  const unicos = [...new Set(pend.map(nombreDe).filter(Boolean))];
  const lote = unicos.slice(0, 150);
  const aviso = unicos.length > lote.length ? `\nSe hacen primero ${lote.length} nombres; después volvés a tocar el botón para el resto.` : "";
  if (!confirm(`Hay ${pend.length} productos sin categoría (${unicos.length} nombres distintos).${aviso}\n\nLa IA les asigna una categoría y después podés corregir cualquiera a mano.\n\n¿Seguir?`)) return;
  if (!iniciarActividad("IA trabajando", "Asignando categorías a los productos…")) return;
  setEstadoHerramientas("Asignando categorías a los productos…");
  try {
    const mapa = await pedirCategoriasIA(lote);
    const porCategoria = {};
    pend.forEach(i => {
      const k = lote.indexOf(nombreDe(i)) + 1;
      if (k > 0 && mapa[k]) (porCategoria[mapa[k]] = porCategoria[mapa[k]] || []).push(i);
    });
    let hechos = 0;
    for (const [cat, items] of Object.entries(porCategoria)) {
      verificarContextoActividad();
      setEstadoHerramientas(`Guardando categorías: ${hechos} de ${pend.length} productos…`);
      await guardarCategorias(items, cat); hechos += items.length;
    }
    alert(`Listo: ${hechos} productos categorizados.`);
  } catch (err) {
    console.error("Error categorizando:", err);
    alert("No se pudo categorizar.\n\nDetalle: " + (err && err.message ? err.message : err));
  } finally {
    setEstadoHerramientas("");
    terminarActividad();
  }
};

// -------------------------------------------------------------
// IMPORTAR TICKETS DESDE UNA PLANILLA (CSV)
// -------------------------------------------------------------
function parseCsv(texto) {
  texto = texto.replace(/^\uFEFF/, "");
  const primera = texto.split(/\r?\n/)[0] || "";
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ";" : ",";
  const filas = [];
  let fila = [], campo = "", comillas = false;
  const cerrarFila = () => { fila.push(campo); campo = ""; if (fila.some(x => x.trim() !== "")) filas.push(fila); fila = []; };
  for (let k = 0; k < texto.length; k++) {
    const c = texto[k];
    if (comillas) {
      if (c === '"') { if (texto[k + 1] === '"') { campo += '"'; k++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[k + 1] === "\n") k++; cerrarFila(); }
    else campo += c;
  }
  if (campo !== "" || fila.length) cerrarFila();
  if (!filas.length) return [];
  const cab = filas.shift().map(h => h.trim());
  return filas.map(f => Object.fromEntries(cab.map((h, k) => [h, (f[k] ?? "").trim()])));
}

const MEDIOS_PLANILLA = {
  "efectivo": "efectivo", "transferencia": "transferencia", "transferencia bancaria": "transferencia",
  "mercado pago (qr)": "qr_mercadopago", "efectivo / transferencia": "efectivo/transferencia"
};
const nPl = (v) => { const t = String(v ?? "").trim(); const n = Number(t.includes(".") ? t : t.replace(",", ".")); return t !== "" && Number.isFinite(n) ? n : 0; };
function fechaPlanilla(txt) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(txt).trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], 12, 0);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

// Convierte las filas del CSV (una por producto) en tickets, pasando por el mismo control matemático que la IA
function armarTicketsDePlanilla(filas) {
  const grupos = new Map();
  filas.forEach((r, indice) => {
    if (!r.ticket_n) throw new Error(`La fila ${indice + 2} no tiene número manual en ticket_n. Completalo antes de importar.`);
    if (!grupos.has(r.ticket_n)) grupos.set(r.ticket_n, []);
    grupos.get(r.ticket_n).push(r);
  });
  const tickets = [];
  [...grupos.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([n, rs]) => {
    const numero = numeroManual(n);
    if (!numero) throw new Error(`El ticket «${n}» no tiene un número manual válido. Usá solo números en ticket_n.`);
    if (tickets.some(t => t.numero === numero)) throw new Error(`El número manual ${numero} aparece escrito de dos maneras en la planilla. Revisalo antes de importar.`);
    const h = rs[0];
    const items = rs.map(r => {
      const cantidad = nPl(r.cantidad) || 1;
      const descuento = Math.abs(nPl(r.descuento_linea));
      const unidad = sinAcentos(r.unidad);
      return {
        rawDescription: r.producto_original || r.producto_nombre,
        canonicalProductName: r.producto_nombre || r.producto_original,
        brand: r.marca || "",
        category: normalizarCategoria(r.categoria),
        quantity: cantidad,
        unitPrice: nPl(r.precio_unitario),
        discount: descuento,
        lineTotal: r.importe_linea !== "" ? nPl(r.importe_linea) : cantidad * nPl(r.precio_unitario) - descuento,
        presentationValue: nPl(r.contenido_por_unidad) > 0 ? nPl(r.contenido_por_unidad) : 1,
        presentationUnit: ["kg", "l", "unidad"].includes(unidad) ? unidad : "unidad",
        unitPriceNormalized: 0,
        isDoubtful: false
      };
    });
    const fecha = fechaPlanilla(h.fecha);
    const notas = fecha ? [] : ["No se pudo leer la fecha del ticket en la planilla"];
    const t = reconciliarTicket({
      numero,
      storeName: h.comercio || "Comercio",
      receiptNumber: h.numero_comprobante || "",
      date: fecha,
      totalPaid: nPl(h.total_pagado_ticket),
      subtotal: nPl(h.subtotal_ticket),
      discountsTotal: Math.abs(nPl(h.descuentos_globales_ticket)),
      cashbackAmount: nPl(h.reintegro_ticket),
      paymentMethod: MEDIOS_PLANILLA[sinAcentos(h.medio_pago)] || h.medio_pago || "efectivo/transferencia",
      items: items,
      doubtfulNotes: notas
    });
    tickets.push(t);
  });
  return tickets;
}

async function guardarTicketImportado(t) {
  verificarContextoActividad();
  const isPersonal = activeSpace === "personal";
  const hId = isPersonal ? "personal" : currentHousehold.id;
  const memberUids = isPersonal ? [currentUser.uid] : (currentHousehold ? currentHousehold.memberUids : [currentUser.uid]);
  const dudoso = t.doubtfulNotes.length > 0;
  const purchaseRef = doc(collection(db, "purchases"));
  const batch = writeBatch(db);
  batch.set(purchaseRef, {
    householdId: hId,
    storeName: t.storeName,
    receiptNumber: t.receiptNumber || "",
    date: t.date || serverTimestamp(),
    subtotal: t.subtotal || t.totalPaid,
    discountsTotal: t.discountsTotal || 0,
    totalPaid: t.totalPaid,
    cashbackAmount: t.cashbackAmount || 0,
    effectiveCost: t.totalPaid - (t.cashbackAmount || 0),
    paymentMethod: t.paymentMethod,
    status: dudoso ? "a_revisar" : "confirmado",
    reviewNotes: dudoso ? t.doubtfulNotes : [],
    manualArchiveNumber: String(t.numero),
    createdByUid: currentUser.uid,
    lastModifiedByUid: currentUser.uid,
    memberUids: memberUids,
    createdAt: serverTimestamp()
  });
  const savedItems = [];
  t.items.forEach(item => {
    const itemRef = doc(collection(db, "purchase_items"));
    savedItems.push({id:itemRef.id,...item});
    batch.set(itemRef, {
      purchaseId: purchaseRef.id,
      householdId: hId,
      rawDescription: item.rawDescription,
      canonicalProductName: item.canonicalProductName,
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      presentationValue: item.presentationValue,
      presentationUnit: item.presentationUnit,
      unitPriceNormalized: item.unitPriceNormalized || item.unitPrice,
      brand: item.brand || "",
      discount: item.discount || 0,
      isDoubtful: false,
      memberUids: memberUids,
      createdAt: serverTimestamp()
    });
  });
  await batch.commit();
  shopping.ticketGuardado({id:purchaseRef.id,storeName:t.storeName,date:t.date||new Date(),items:savedItems});
}

window.importarPlanilla = () => {
  if (!datosListos() || actividadActual) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = async () => {
    const archivo = input.files && input.files[0];
    if (!archivo) return;
    if (!iniciarActividad("Importando planilla", "Comprobando números manuales y tickets repetidos…")) return;
    try {
      const filas = parseCsv(await archivo.text());
      const requeridas = ["ticket_n", "fecha", "comercio", "total_pagado_ticket", "producto_nombre", "importe_linea"];
      const faltan = requeridas.filter(c => !(filas[0] && c in filas[0]));
      if (!filas.length || faltan.length) {
        alert("Ese archivo no es la planilla esperada." + (faltan.length ? "\nFaltan las columnas: " + faltan.join(", ") : ""));
        return;
      }
      const tickets = armarTicketsDePlanilla(filas);
      const nuevos = [], repetidos = [];
      for (const t of tickets) {
        // Incluye los tickets anteriores del mismo archivo, aunque tengan otro ID.
        const coincidencia = buscarDuplicado(t, [...purchases, ...nuevos]);
        (coincidencia ? repetidos : nuevos).push(t);
      }
      const dudosos = nuevos.filter(t => t.doubtfulNotes.length > 0);
      const donde = activeSpace === "personal" ? "tu espacio personal" : `«${currentHousehold ? currentHousehold.name : "hogar"}»`;
      const productos = nuevos.reduce((a, t) => a + t.items.length, 0);
      const resumen = (t) => `#${t.numero} ${t.storeName} $${t.totalPaid.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

      if (!nuevos.length) {
        alert(`Los ${tickets.length} tickets de la planilla coinciden por número manual, comprobante o total con tickets ya cargados o del mismo archivo. No se agregó nada.`);
        return;
      }
      let msg = `La planilla tiene ${tickets.length} tickets.\n\n• Se van a cargar ${nuevos.length} tickets (${productos} productos) en ${donde}.`;
      if (repetidos.length) msg += `\n• Se saltean ${repetidos.length} por coincidencia de número manual, comprobante o total (incluso con otro nombre de comercio): ${repetidos.map(resumen).join("; ")}.`;
      if (dudosos.length) msg += `\n• ${dudosos.length} van a quedar en "Revisión" porque la cuenta no cierra: ${dudosos.map(t => "#" + t.numero).join(", ")}.`;
      msg += `\n\n¿Cargar?`;
      if (!confirm(msg)) return;

      let hechos = 0;
      for (const t of nuevos) {
        // Repite el control por si se recibieron cambios desde otro dispositivo.
        if (buscarDuplicado(t, purchases)) continue;
        setEstadoHerramientas(`Cargando ticket ${hechos + 1} de ${nuevos.length}…`);
        await guardarTicketImportado(t);
        hechos++;
      }
      alert(`Listo: se cargaron ${hechos} tickets.${hechos < nuevos.length ? " Se omitieron coincidencias recibidas durante la importación." : ""}`);
    } catch (err) {
      console.error("Error importando planilla:", err);
      alert("No se pudo importar la planilla.\n\nDetalle: " + (err && err.message ? err.message : err));
    } finally {
      setEstadoHerramientas("");
      terminarActividad();
    }
  };
  input.click();
};

// -------------------------------------------------------------
// BOTÓN FLOTANTE "HERRAMIENTAS" (abajo a la derecha)
// -------------------------------------------------------------
let estadoHerramientasEl = null;
function setEstadoHerramientas(txt) {
  if (estadoHerramientasEl) estadoHerramientasEl.textContent = txt;
  if (actividadActual && txt) actividadEl.querySelector(".actividad-texto").textContent = txt;
}
(function crearHerramientas() {
  const btn = document.createElement("button");
  btn.textContent = "🛠";
  btn.title = "Herramientas";
  btn.style.cssText = "position:fixed;bottom:16px;right:16px;width:44px;height:44px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;color:#1b2430;font-size:20px;cursor:pointer;z-index:9998;box-shadow:0 2px 8px rgba(0,0,0,.25);display:none;";
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;bottom:68px;right:16px;width:250px;background:#fff;color:#1b2430;border:1px solid #cbd5e1;border-radius:12px;padding:12px;z-index:9998;box-shadow:0 4px 16px rgba(0,0,0,.25);display:none;font-size:14px;";
  panel.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">Herramientas</div>
    <button id="herrImportar" style="width:100%;padding:8px;margin-bottom:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#1b2430;cursor:pointer;">📥 Importar planilla (CSV)</button>
    <button id="herrCategorias" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#1b2430;cursor:pointer;">🏷 Categorizar productos sin categoría</button>
    <div id="herrEstado" style="margin-top:8px;font-size:12px;color:#64748b;min-height:14px;"></div>`;
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  estadoHerramientasEl = panel.querySelector("#herrEstado");
  btn.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; };
  panel.querySelector("#herrImportar").onclick = () => { panel.style.display = "none"; window.importarPlanilla(); };
  panel.querySelector("#herrCategorias").onclick = () => { panel.style.display = "none"; window.categorizarPendientes(); };
  setInterval(() => {
    btn.style.display = currentUser ? "block" : "none";
    if (!currentUser) panel.style.display = "none";
  }, 1000);
})();

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
  renderSettingsMembers(true);
  document.getElementById("joinStatus").textContent = "";
});
document.getElementById("btnCloseSettingsModal").addEventListener("click", () => modalSettings.style.display = "none");

// Guardar gasto manual
document.getElementById("btnSaveManualExpense").addEventListener("click", async () => {
  if (actividadActual || !datosListos()) return;
  const store = document.getElementById("manualStoreSelect").value;
  const amount = parseFloat(document.getElementById("manualAmountInput").value);
  const category = document.getElementById("manualCategorySelect").value;
  const description = document.getElementById("manualDescriptionInput").value;
  const paymentMethod = document.getElementById("manualPaymentMethodSelect").value;
  const manualArchiveNumber = pedirNumeroManual(document.getElementById("manualArchiveInput"));
  if (!manualArchiveNumber) return;

  if (isNaN(amount) || amount <= 0) {
    alert("Por favor ingresá un monto válido.");
    return;
  }
  if (!permitirTicket({ manualArchiveNumber, storeName: store, totalPaid: amount })) return;
  if (!iniciarActividad("Guardando ticket", `Número manual ${manualArchiveNumber}…`)) return;
  try {
    verificarContextoActividad();

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
      category: CATEGORIAS.find(c => sinAcentos(c) === sinAcentos(category)) || category || "Sin detalle",
      memberUids: memberUids,
      createdAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.set(purchaseRef, purchase);
    batch.set(itemRef, item);
    await batch.commit();
    shopping.ticketGuardado({id:purchaseRef.id,storeName:store,date:new Date(),items:[{id:itemRef.id,...item}]});

    modalManual.style.display = "none";
    document.getElementById("manualAmountInput").value = "";
    document.getElementById("manualDescriptionInput").value = "";
    document.getElementById("manualArchiveInput").value = "";
  } catch (err) {
    console.error("Error guardando gasto:", err);
    alert("No se pudo guardar el gasto.\n\nDetalle: " + err.message);
  } finally {
    terminarActividad();
  }
});

// Completar el número de tickets antiguos sin inventar uno por orden de carga.
window.editarNumeroManual = async (id) => {
  if (actividadActual || !datosListos()) return;
  const compra = purchases.find(p => p.id === id);
  if (!compra) return;
  const respuesta = prompt("Número escrito a mano en este ticket:", compra.manualArchiveNumber || "");
  if (respuesta === null) return;
  const numero = numeroManual(respuesta);
  if (!numero) { alert("Ingresá solo el número manual del ticket, por ejemplo: 142."); return; }
  const repetido = buscarDuplicado({ manualArchiveNumber: numero }, purchases, id);
  if (repetido) { alert("Ese número ya pertenece a otro ticket:\n\n" + resumenCompra(repetido.compra)); return; }
  if (!iniciarActividad("Guardando número manual", `Ticket ${numero}…`)) return;
  try {
    verificarContextoActividad();
    await updateDoc(doc(db, "purchases", id), { manualArchiveNumber: numero, lastModifiedByUid: currentUser.uid });
  } catch (err) {
    alert("No se pudo guardar el número.\n\nDetalle: " + err.message);
  } finally {
    terminarActividad();
  }
};

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
    quantity: Schema.number({ description: "Cantidad comprada. Para productos por peso es el peso (ej: 0.75 kg de jamón). Para el resto, las unidades (ej: 1, 2, 3)" }),
    unitPrice: Schema.number({ description: "Precio de UNA unidad (o de UN kg si se vende por peso) SIN descuento, tal como figura en el ticket" }),
    discount: Schema.number({ description: "Descuento aplicado SOLO a esta línea, como número POSITIVO en pesos (0 si no hay). Si el ticket lo muestra como renglón negativo justo debajo del producto, va acá" }),
    lineTotal: Schema.number({ description: "Importe final de la línea = quantity x unitPrice - discount" }),
    presentationValue: Schema.number({ description: "Contenido de UNA sola unidad del producto, expresado en presentationUnit (ej: 1 para una botella de 1 litro, 0.5 para un paquete de 500 g, 1 para algo que se vende por unidad o por kg). NO multiplicar por la cantidad comprada" }),
    presentationUnit: Schema.string({ description: "Unidad de medida, siempre convertida a: 'kg', 'l' o 'unidad' (nunca 'g' ni 'ml')" }),
    category: Schema.string({ description: "Categoría del producto. Debe ser EXACTAMENTE una de: Almacén, Bebidas, Carnes, Frutas y verduras, Golosinas y snacks, Higiene personal, Hogar, Limpieza, Lácteos y fiambres, Panificados y harinas, Sin detalle" }),
    isDoubtful: Schema.boolean({ description: "True si el texto o número está borroso, roto o fue interpretado con duda" })
  }
});

const receiptSchema = Schema.object({
  properties: {
    storeName: Schema.string({ description: "Nombre comercial. Si es un chino de barrio sin nombre claro, usar 'Chino + calle' (ej: 'Chino Roffo'). Cadenas: DIA, Vea, Malambo, etc." }),
    receiptNumber: Schema.string({ description: "Número de comprobante" }),
    receiptType: Schema.string({ description: "Tipo de comprobante tal cual figura (ej: 'Factura B', 'Factura A', 'Ticket', 'Presupuesto'). Vacío si no se lee" }),
    dateString: Schema.string({ description: "Fecha y hora en formato YYYY-MM-DD HH:mm, o vacío si no se lee" }),
    subtotal: Schema.number({ description: "Suma de los importes finales de las líneas (ya con sus descuentos de línea), antes de los descuentos globales" }),
    discountsTotal: Schema.number({ description: "Descuentos GLOBALES del ticket (cupones, promos sobre el total, descuento por medio de pago, jubilados), como número POSITIVO. NO incluir los descuentos que ya anotaste en cada línea" }),
    totalPaid: Schema.number({ description: "Total final que se pagó en pesos argentinos (ARS) = subtotal - discountsTotal. Es el TOTAL del ticket, no el efectivo entregado ni el vuelto" }),
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
7. Calculá bien la presentación de UNA unidad, siempre en kg, l o unidad (ej: 500 gramos = 0.5 kg, 1 litro = 1 l). Para productos que se venden por peso, quantity es el peso, presentationValue es 1 y presentationUnit es 'kg'.
8. Números argentinos: el punto separa miles y la coma separa decimales. '1.234,50' significa 1234.50 y '950,00' significa 950. Devolvé siempre números normales (sin separador de miles).
9. Descuentos: en los tickets suelen aparecer como renglones con signo negativo o palabras como DESC, DTO, PROMO, 2x1, AHORRO, CUPON. Si el renglón corresponde claramente a un producto, restalo de ESA línea (campo discount, número positivo). Si es un descuento sobre el total, va en discountsTotal. Nunca cuentes el mismo descuento dos veces y nunca pongas descuentos como productos.
10. Los importes de IVA, impuestos y redondeos que ya están incluidos en el total no son productos ni descuentos: ignoralos.
11. Antes de responder verificá la cuenta: la suma de los lineTotal menos discountsTotal tiene que dar totalPaid. Si no da, releé el ticket; si la diferencia persiste, explicalo en doubtfulNotes.
12. Categoría de cada producto (campo category), escrita EXACTAMENTE igual que en esta lista:
- Almacén: fideos, pastas rellenas, aceite, salsas y pulpa de tomate, conservas, azúcar, café, mermeladas, mayonesa, condimentos y esencias.
- Panificados y harinas: harinas, levadura, pan, tapas de empanadas y de tarta.
- Lácteos y fiambres: leche, quesos, crema, huevos, yogur, fiambres.
- Carnes: carne vacuna, pollo, cerdo, hamburguesas.
- Frutas y verduras: frutas y verduras frescas.
- Bebidas: gaseosas, jugos, aguas, aperitivos, cervezas, vinos.
- Golosinas y snacks: galletitas, alfajores, chocolates, caramelos, chicles, turrones, snacks.
- Limpieza: lavandina, detergente, jabón para ropa, suavizante, esponjas, limpiadores.
- Higiene personal: papel higiénico, shampoo, jabón de tocador, crema dental, toallitas, pañuelos descartables.
- Hogar: bolsas, papel de cocina, utensilios, lámparas, fósforos y artículos del hogar.
- Sin detalle: líneas genéricas como 'ALMACEN' o 'VENTAS VARIAS' o productos que no podés identificar.
13. receiptType: el tipo de comprobante tal cual figura impreso (por ejemplo 'Factura B' o 'Ticket'). Si no se lee, dejalo vacío.`;

// Si el modelo principal está saturado ("high demand"), se prueba con los siguientes
const MODELOS_TICKET = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
const modelosCache = {};
function getReceiptModel(nombre) {
  if (!modelosCache[nombre]) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    modelosCache[nombre] = getGenerativeModel(ai, {
      model: nombre,
      generationConfig: { responseMimeType: "application/json", responseSchema: receiptSchema }
    });
  }
  return modelosCache[nombre];
}

// ¿Es un error pasajero (saturación, límite, timeout) que vale la pena reintentar?
function esErrorTemporal(e) {
  const m = String((e && e.message) || e);
  return /\[(429|500|502|503|504)\b|high demand|overloaded|unavailable|demasiado|tardó/i.test(m);
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
  const t0 = performance.now();
  const seg = () => ((performance.now() - t0) / 1000).toFixed(1) + " s";

  const base64 = await imagenABase64(file);
  console.log("Foto preparada en " + seg() + " (" + Math.round(base64.length / 1024) + " KB)");

  // Paso de diagnóstico: pedir el permiso anti-abuso (App Check) antes de llamar a la IA
  if (appCheckInstance) {
    try {
      await Promise.race([
        getAppCheckToken(appCheckInstance, false),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo agotado (más de 20 segundos)")), 20000))
      ]);
      console.log("App Check OK en " + seg());
    } catch (e) {
      throw new Error("Falló el permiso anti-abuso (App Check) a los " + seg() + ": " + (e && e.message ? e.message : e));
    }
  }

  let resultado = null;
  let ultimoError = null;
  for (let i = 0; i < MODELOS_TICKET.length; i++) {
    const nombre = MODELOS_TICKET[i];
    try {
      console.log("Probando modelo " + nombre + " (intento " + (i + 1) + ")...");
      resultado = await Promise.race([
        getReceiptModel(nombre).generateContent([
          PROMPT_TICKET,
          { inlineData: { data: base64, mimeType: "image/jpeg" } }
        ]),
        new Promise((_, rej) => setTimeout(() => rej(new Error("La IA tardó demasiado (más de 45 segundos)")), 45000))
      ]);
      console.log("Gemini (" + nombre + ") respondió en " + seg());
      break;
    } catch (e) {
      ultimoError = e;
      console.warn("Falló " + nombre + ":", e && e.message ? e.message : e);
      if (!esErrorTemporal(e)) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!resultado) {
    throw new Error("Gemini está saturado en este momento. Probá de nuevo en unos minutos. (" + (ultimoError && ultimoError.message ? ultimoError.message : ultimoError) + ")");
  }
  const json = JSON.parse(resultado.response.text());

  const items = (json.items || []).map(it => {
    const presVal = num(it.presentationValue, 1) > 0 ? num(it.presentationValue, 1) : 1;
    const descLinea = Math.abs(num(it.discount));
    const lineTotal = num(it.lineTotal, num(it.quantity, 1) * num(it.unitPrice) - descLinea);
    return {
      rawDescription: it.rawDescription || "Ítem",
      canonicalProductName: it.canonicalName || it.rawDescription || "sin detalle",
      brand: it.brand || "",
      quantity: num(it.quantity, 1),
      unitPrice: num(it.unitPrice),
      discount: descLinea,
      lineTotal: lineTotal,
      presentationValue: presVal,
      presentationUnit: it.presentationUnit || "unidad",
      unitPriceNormalized: 0, // se calcula al reconciliar
      category: normalizarCategoria(it.category),
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
  return reconciliarTicket({
    storeName: json.storeName || "Comercio",
    receiptNumber: json.receiptNumber || "",
    receiptType: json.receiptType || "",
    date: fecha,
    totalPaid: totalPaid,
    subtotal: num(json.subtotal),
    discountsTotal: Math.abs(num(json.discountsTotal)),
    cashbackAmount: num(json.cashbackAmount),
    paymentMethod: json.paymentMethod || "efectivo/transferencia",
    items: items,
    doubtfulNotes: notas
  });
}

// -------------------------------------------------------------
// CONTROL MATEMÁTICO DEL TICKET (no confía a ciegas en la IA)
// -------------------------------------------------------------
function reconciliarTicket(t) {
  const plata = (n) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items = t.items;
  const total = t.totalPaid;
  const tol = Math.max(2, total * 0.005); // tolerancia: $2 o 0,5%
  const cerca = (a, b) => Math.abs(a - b) <= tol;

  const sumNeto = items.reduce((a, i) => a + i.lineTotal, 0);                 // líneas ya con su descuento
  const sumBruto = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);   // líneas sin descuento
  const sumDescLinea = items.reduce((a, i) => a + i.discount, 0);
  const dGlobal = t.discountsTotal;

  let ahorro = sumDescLinea + dGlobal;
  let cuadra = true;

  if (cerca(sumNeto - dGlobal, total)) {
    // Caso normal: líneas netas, y el descuento global se resta aparte
    ahorro = sumDescLinea + dGlobal;
  } else if (cerca(sumNeto, total)) {
    // Las líneas ya traen aplicado el descuento global
    ahorro = dGlobal > 0 ? Math.max(dGlobal, sumDescLinea) : sumDescLinea;
  } else if (cerca(sumBruto - sumDescLinea - dGlobal, total)) {
    // La IA calculó mal los importes de línea: se recalculan
    items.forEach(i => { i.lineTotal = i.quantity * i.unitPrice - i.discount; });
    ahorro = sumDescLinea + dGlobal;
  } else if (cerca(sumBruto - dGlobal, total)) {
    items.forEach(i => { i.lineTotal = i.quantity * i.unitPrice; i.discount = 0; });
    ahorro = dGlobal;
  } else if (cerca(sumBruto - sumDescLinea, total)) {
    items.forEach(i => { i.lineTotal = i.quantity * i.unitPrice - i.discount; });
    ahorro = sumDescLinea;
  } else {
    cuadra = false;
    t.doubtfulNotes.push(
      "La cuenta no cierra: las líneas suman " + plata(sumNeto) +
      (dGlobal > 0 ? ", menos descuentos globales " + plata(dGlobal) : "") +
      ", pero el total del ticket es " + plata(total) + ". Revisá productos y descuentos."
    );
  }

  // Precio normalizado por kg / litro / unidad (precio de UNA unidad dividido su contenido)
  items.forEach(i => {
    const cant = i.quantity > 0 ? i.quantity : 1;
    const contenido = i.presentationValue > 0 ? i.presentationValue : 1;
    i.unitPriceNormalized = (i.lineTotal / cant) / contenido;
  });

  t.discountsTotal = Math.round(ahorro * 100) / 100;       // ahorro total del ticket
  t.subtotal = Math.round((total + ahorro) * 100) / 100;   // precio de lista, antes de todos los descuentos
  t.reconciliado = cuadra;
  return t;
}

fileReceiptInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!datosListos()) { fileReceiptInput.value = ""; return; }
  const manualArchiveNumber = pedirNumeroManual(document.getElementById("scanArchiveInput"));
  if (!manualArchiveNumber) { fileReceiptInput.value = ""; return; }
  const repetido = buscarDuplicado({ manualArchiveNumber }, purchases);
  if (repetido) {
    alert("Ese número manual ya está cargado:\n\n" + resumenCompra(repetido.compra));
    fileReceiptInput.value = "";
    return;
  }
  if (!iniciarActividad("IA trabajando", `Leyendo el ticket ${manualArchiveNumber}… Podés seguir navegando.`)) return;
  scanLoadingIndicator.style.display = "block";
  try {
    const parsed = await leerTicketConGemini(file);
    parsed.manualArchiveNumber = manualArchiveNumber;
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
    terminarActividad();
  }
});

async function processParsedTicket(parsed) {
  if (!datosListos()) return;
  const manualArchiveNumber = numeroManual(parsed.manualArchiveNumber) || pedirNumeroManual(document.getElementById("scanArchiveInput"));
  if (!manualArchiveNumber || !permitirTicket({ ...parsed, manualArchiveNumber })) return;
  const actividadPropia = !actividadActual;
  if (actividadPropia && !iniciarActividad("Guardando ticket", `Número manual ${manualArchiveNumber}…`)) return;
  try {
    verificarContextoActividad();
    setEstadoHerramientas(`Guardando ticket ${manualArchiveNumber} y sus productos…`);
    modalScan.style.display = "none";
    const isPersonal = activeSpace === "personal";
    const hId = isPersonal ? "personal" : currentHousehold.id;
    const memberUids = isPersonal ? [currentUser.uid] : (currentHousehold ? currentHousehold.memberUids : [currentUser.uid]);

    // Chequeo matemático
    const sumLines = parsed.items.reduce((acc, i) => acc + i.lineTotal, 0);
    const mathDiff = Math.abs(sumLines - parsed.totalPaid);
    const isDoubtful = parsed.doubtfulNotes.length > 0 || (!parsed.reconciliado && mathDiff > 2.0);

    const purchaseRef = doc(collection(db, "purchases"));
    const purchase = {
      householdId: hId,
      storeName: parsed.storeName,
      receiptNumber: parsed.receiptNumber || "",
      receiptType: parsed.receiptType || "",
      date: parsed.date || serverTimestamp(),
      subtotal: parsed.subtotal || parsed.totalPaid,
      discountsTotal: parsed.discountsTotal || 0,
      totalPaid: parsed.totalPaid,
      cashbackAmount: parsed.cashbackAmount || 0,
      effectiveCost: (parsed.totalPaid - (parsed.cashbackAmount || 0)),
      paymentMethod: parsed.paymentMethod || "efectivo/transferencia",
      status: isDoubtful ? "a_revisar" : "confirmado",
      reviewNotes: isDoubtful ? (parsed.doubtfulNotes.length ? parsed.doubtfulNotes : [`Diferencia de sumas: líneas suman $${sumLines.toFixed(2)} vs total $${parsed.totalPaid.toFixed(2)}`]) : [],
      manualArchiveNumber,
      createdByUid: currentUser.uid,
      lastModifiedByUid: currentUser.uid,
      memberUids: memberUids,
      createdAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.set(purchaseRef, purchase);

    const savedItems = [];
    parsed.items.forEach(item => {
      const itemRef = doc(collection(db, "purchase_items"));
      savedItems.push({id:itemRef.id,...item});
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
        category: item.category || "Sin detalle",
        discount: item.discount || 0,
        isDoubtful: !!item.isDoubtful,
        memberUids: memberUids,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
    shopping.ticketGuardado({id:purchaseRef.id,storeName:parsed.storeName,date:parsed.date||new Date(),items:savedItems});
    document.getElementById("scanArchiveInput").value = "";
    alert(`¡Comprobante de ${parsed.storeName} registrado con éxito!`);
  } catch (err) {
    if (!actividadPropia) throw err;
    alert("No se pudo guardar el ticket.\n\nDetalle: " + err.message);
  } finally {
    if (actividadPropia) terminarActividad();
  }
}

// -------------------------------------------------------------
// INVITACIONES
// -------------------------------------------------------------
function renderSettingsMembers(reset = false) {
  const household = currentHousehold;
  const form = document.getElementById("householdNameForm");
  const owner = Boolean(household && currentUser?.uid === household.adminUid);
  document.getElementById("selectedHouseholdName").textContent = household?.name || "Espacio personal";
  form.hidden = !owner;
  document.getElementById("householdInviteControls").hidden = !owner;
  if (reset || form.dataset.householdId !== (household?.id || "")) {
    form.dataset.householdId = household?.id || "";
    document.getElementById("householdNameInput").value = household?.name || "";
    document.getElementById("householdNameStatus").textContent = "";
    document.getElementById("inviteResult").style.display = "none";
  }
  const container = document.getElementById("membersList");
  if (!household) {
    container.textContent = "Elegí un hogar para ver sus integrantes.";
    return;
  }
  container.innerHTML = Object.entries(household.members || {}).map(([uid, role]) => `
    <div style="display: flex; justify-content: space-between; padding: 4px 0;">
      <span>Usuario (${escapeHtml(uid.slice(0, 6))}...)</span>
      <strong style="color: var(--primary);">${escapeHtml(String(role).toUpperCase())}</strong>
    </div>
  `).join("");
}

document.getElementById("householdNameForm").addEventListener("submit", async event => {
  event.preventDefault();
  const household = currentHousehold;
  const uid = currentUser?.uid;
  const button = document.getElementById("btnSaveHouseholdName");
  if (!household || household.adminUid !== uid || button.disabled) return;
  const status = document.getElementById("householdNameStatus");
  const input = document.getElementById("householdNameInput");
  const name = input.value.trim();
  if (!name || name.length > 60) {
    status.textContent = "Escribí un nombre de hasta 60 caracteres.";
    return;
  }
  button.disabled = true;
  input.disabled = true;
  status.textContent = "Guardando nombre…";
  try {
    await updateDoc(doc(db, "households", household.id), { name });
    if (currentUser?.uid === uid && activeSpace === household.id) {
      userHouseholds = userHouseholds.map(h => h.id === household.id ? { ...h, name } : h);
      selectSpace(household.id);
      input.value = name;
      status.textContent = "Nombre guardado.";
    }
  } catch (error) {
    console.error("No se pudo cambiar el nombre del hogar:", error);
    if (currentUser?.uid === uid && activeSpace === household.id) {
      status.textContent = "No se pudo guardar el nombre. Volvé a intentar.";
    }
  } finally {
    button.disabled = false;
    input.disabled = false;
  }
});

document.getElementById("btnGenerateInvite").addEventListener("click", async () => {
  const household = currentHousehold;
  const uid = currentUser?.uid;
  const button = document.getElementById("btnGenerateInvite");
  if (!household || household.adminUid !== uid || button.disabled) return;
  const role = document.getElementById("inviteRoleSelect").value;
  const resDiv = document.getElementById("inviteResult");
  button.disabled = true;
  try {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const token = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => alphabet[byte % alphabet.length]).join("");
    await setDoc(doc(db, "invitations", token), {
      householdId: household.id,
      householdName: household.name,
      role,
      createdByUid: uid,
      isRevoked: false,
      createdAt: serverTimestamp()
    });
    if (currentUser?.uid !== uid || activeSpace !== household.id) return;
    resDiv.style.display = "block";
    resDiv.innerHTML = `<div>Código para ${escapeHtml(household.name)}</div>
      <strong style="font-size: 1.4rem; color: var(--primary)">${token}</strong>
      <div>Rol: ${escapeHtml(role)}</div>`;
  } catch (error) {
    console.error("No se pudo crear la invitación:", error);
    if (currentUser?.uid === uid && activeSpace === household.id) {
      resDiv.style.display = "block";
      resDiv.textContent = "No se pudo generar el código. Volvé a intentar.";
    }
  } finally {
    button.disabled = false;
  }
});

document.getElementById("btnJoinHousehold").addEventListener("click", async () => {
  const uid = currentUser?.uid;
  const button = document.getElementById("btnJoinHousehold");
  if (!uid || button.disabled || actividadActual) return;
  const input = document.getElementById("joinCodeInput");
  const status = document.getElementById("joinStatus");
  const code = input.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code)) {
    status.textContent = "Ingresá el código de invitación.";
    return;
  }
  button.disabled = true;
  status.textContent = "Abriendo hogar…";
  try {
    const inviteSnap = await getDocFromServer(doc(db, "invitations", code));
    if (currentUser?.uid !== uid) return;
    if (!inviteSnap.exists() || inviteSnap.data().isRevoked) {
      status.textContent = "El código no existe o fue revocado.";
      return;
    }
    const invite = inviteSnap.data();
    const hRef = doc(db, "households", invite.householdId);
    if (!userHouseholds.some(h => h.id === invite.householdId)) {
      try {
        await updateDoc(hRef, {
          memberUids: arrayUnion(uid),
          [`members.${uid}`]: invite.role,
          joinToken: code
        });
      } catch (error) {
        // Si otro dispositivo ya aceptó el código, la lectura de abajo confirma el acceso.
        if (error.code !== "permission-denied") throw error;
      }
    }
    if (currentUser?.uid !== uid) return;
    const joined = await getDocFromServer(hRef);
    if (currentUser?.uid !== uid) return;
    if (!joined.exists() || !joined.data().memberUids.includes(uid)) {
      throw new Error("La cuenta no figura entre los integrantes.");
    }
    const household = { id: joined.id, ...joined.data() };
    userHouseholds = [...userHouseholds.filter(h => h.id !== household.id), household];
    modalSettings.style.display = "none";
    input.value = "";
    status.textContent = "";
    selectSpace(household.id);
  } catch (error) {
    console.error("No se pudo usar la invitación:", error);
    if (currentUser?.uid === uid) status.textContent = "No se pudo abrir el hogar. Revisá el código y volvé a intentar.";
  } finally {
    button.disabled = false;
  }
});

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

