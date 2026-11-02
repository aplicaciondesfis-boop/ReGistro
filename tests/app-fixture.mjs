import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { numeroManual, buscarDuplicado, gruposPorTotal } from "../tickets.mjs";

const source = (await readFile(new URL("../app.js", import.meta.url), "utf8")).replace(/^import[\s\S]*?;\r?\n/gm, "");

// Ejecuta los mismos manejadores de carga, sustituyendo solo navegador/Firebase.
// Los documentos escritos quedan en memoria: estas pruebas no usan la base real.
export function crearApp() {
  const elementos = new Map();
  const creados = [];
  const avisos = [];
  const confirmaciones = [];
  const escrituras = [];
  let contador = 0;
  function elemento(id = "") {
    return { id, style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
      listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
      setAttribute() {}, appendChild() {}, focus() {}, click() {},
      querySelector(selector) { return get(id + selector); }, querySelectorAll() { return []; }
    };
  }
  function get(id) { if (!elementos.has(id)) elementos.set(id, elemento(id)); return elementos.get(id); }
  const context = vm.createContext({
    console: { ...console, error() {} }, numeroManual, buscarDuplicado, gruposPorTotal,
    document: { getElementById: get, createElement: tag => { const el = elemento("creado-" + creados.length); el.tag = tag; creados.push(el); return el; },
      body: elemento("body"), querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, window: {}, alert: msg => avisos.push(msg), confirm: msg => { confirmaciones.push(msg); return respuestas.shift() ?? true; }, prompt: () => null,
    setInterval() {}, setTimeout, clearTimeout,
    initializeApp: () => ({}), initializeAppCheck: () => ({}), ReCaptchaEnterpriseProvider: class {},
    getAuth: () => ({}), getFirestore: () => ({}), onAuthStateChanged() {},
    Schema: new Proxy({}, { get: () => () => ({}) }), getAI: () => ({}), GoogleAIBackend: class {}, getGenerativeModel: () => ({}),
    collection: (_db, name) => ({ collection: name }), doc: (base, name, id) => ({ collection: base.collection || name, id: id || "nuevo-" + ++contador }),
    serverTimestamp: () => new Date("2026-11-02T12:00:00Z"), Timestamp: { fromDate: date => date },
    writeBatch: () => {
      const lote = [];
      return { set: (ref, data) => lote.push({ ref, data }), commit: async () => {
        if (fallarEscritura) throw new Error("Fallo de prueba");
        escrituras.push(...lote);
      } };
    },
    updateDoc: async (ref, data) => escrituras.push({ ref, data })
  });
  const respuestas = [];
  let fallarEscritura = false;
  vm.runInContext(source, context);
  vm.runInContext('currentUser = {uid:"usuario"}; currentHousehold = {id:"hogar",memberUids:["usuario"]}; purchasesReady = true;', context);
  return { context, get, creados, avisos, confirmaciones, escrituras, respuestas,
    ejecutar: texto => vm.runInContext(texto, context),
    fallar: () => { fallarEscritura = true; },
    click: id => get(id).listeners.click(),
    prepararManual: (numero = "142", monto = "3500") => { get("manualArchiveInput").value = numero; get("manualAmountInput").value = monto; get("manualStoreSelect").value = "DIA"; get("manualCategorySelect").value = "Almacén"; get("manualPaymentMethodSelect").value = "efectivo"; }
  };
}
