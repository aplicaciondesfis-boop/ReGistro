import test from "node:test";
import assert from "node:assert/strict";
import { crearApp } from "./app-fixture.mjs";

test("la carga manual exige número y bloquea un ID ya usado sin escribir", async () => {
  const app = crearApp();
  app.prepararManual("");
  await app.click("btnSaveManualExpense");
  assert.equal(app.escrituras.length, 0);
  app.ejecutar('purchases = [{id:"viejo",manualArchiveNumber:"142",totalPaid:20}];');
  app.prepararManual("#00142");
  await app.click("btnSaveManualExpense");
  assert.equal(app.escrituras.length, 0);
  assert.match(app.avisos.at(-1), /ya está cargado/);
});

test("la carga manual guarda el ID normalizado y sus productos en el mismo lote", async () => {
  const app = crearApp();
  app.prepararManual("#00142");
  await app.click("btnSaveManualExpense");
  assert.equal(app.escrituras.length, 2);
  assert.equal(app.escrituras[0].data.manualArchiveNumber, "142");
  assert.equal(app.escrituras[1].data.purchaseId, app.escrituras[0].ref.id);
  assert.equal(app.ejecutar("actividadActual"), null);
  assert.equal(app.get("btnSaveManualExpense").disabled, false);
});

test("el mismo monto con otro comercio pide confirmación y cancelar no escribe", async () => {
  const app = crearApp();
  app.ejecutar('purchases = [{id:"viejo",storeName:"Mercado Sol",totalPaid:3500}];');
  app.prepararManual();
  app.respuestas.push(false);
  await app.click("btnSaveManualExpense");
  assert.equal(app.confirmaciones.length, 1);
  assert.equal(app.escrituras.length, 0);
});

test("un fallo al guardar restaura los controles y conserva el número para reintentar", async () => {
  const app = crearApp();
  app.prepararManual();
  app.fallar();
  await app.click("btnSaveManualExpense");
  assert.equal(app.ejecutar("actividadActual"), null);
  assert.equal(app.get("btnSaveManualExpense").disabled, false);
  assert.equal(app.get("manualArchiveInput").value, "142");
});

test("la lectura mantiene el indicador al cerrar el modal y guarda el ID capturado", async () => {
  const app = crearApp();
  let completar;
  app.context.lectura = new Promise(resolve => { completar = resolve; });
  app.ejecutar("leerTicketConGemini = async () => await lectura;");
  app.get("scanArchiveInput").value = "143";
  const tarea = app.get("fileReceiptInput").listeners.change({ target: { files: [{}] } });
  assert.equal(app.ejecutar("actividadEl.hidden"), false);
  await app.click("btnCloseScanModal");
  assert.equal(app.get("modalScan").style.display, "none");
  assert.equal(app.ejecutar("actividadEl.hidden"), false);
  completar({ storeName: "Comercio", totalPaid: 200, doubtfulNotes: [], reconciliado: true,
    items: [{ rawDescription: "Producto", canonicalProductName: "Producto", quantity: 1, unitPrice: 200, lineTotal: 200 }] });
  await tarea;
  assert.equal(app.escrituras[0].data.manualArchiveNumber, "143");
  assert.equal(app.ejecutar("actividadEl.hidden"), true);
  assert.equal(app.get("spaceSelector").disabled, false);
});

test("la lectura rechaza números repetidos antes de consumir IA", async () => {
  const app = crearApp();
  app.ejecutar('purchases = [{id:"viejo",manualArchiveNumber:"8",totalPaid:100}]; leerTicketConGemini = () => { throw Error("No debe llamar IA"); };');
  app.get("scanArchiveInput").value = "8";
  await app.get("fileReceiptInput").listeners.change({ target: { files: [{}] } });
  assert.equal(app.escrituras.length, 0);
  assert.match(app.avisos.at(-1), /ya está cargado/);
});

test("el importador omite alias ya cargados y duplicados dentro del archivo", async () => {
  const app = crearApp();
  app.ejecutar('purchases = [{id:"viejo",storeName:"SUPERMERCADO SOL",totalPaid:1001.23}];');
  app.ejecutar("window.importarPlanilla()");
  const input = app.creados.at(-1);
  const cab = "ticket_n;fecha;comercio;total_pagado_ticket;producto_nombre;importe_linea;cantidad;precio_unitario";
  input.files = [{ text: async () => cab + "\n8;9/10/2026;Almacén de la esquina;1001.23;Producto;1001.23;1;1001.23\n30;1/11/2026;Comercio;100;Producto;100;1;100\n31;1/11/2026;Otro nombre;100;Producto;100;1;100" }];
  await input.onchange();
  const compras = app.escrituras.filter(e => e.ref.collection === "purchases");
  assert.equal(compras.length, 1);
  assert.equal(compras[0].data.manualArchiveNumber, "30");
  assert.equal(app.ejecutar("actividadActual"), null);
});

test("una planilla con números inválidos no escribe parcialmente", () => {
  const app = crearApp();
  assert.throws(() => app.ejecutar('armarTicketsDePlanilla([{ticket_n:"abc"}])'), /número manual válido/);
  assert.throws(() => app.ejecutar('armarTicketsDePlanilla([{ticket_n:""}])'), /no tiene número manual/);
  assert.equal(app.escrituras.length, 0);
});

test("no permite borrar un ticket mientras sus productos no están cargados", async () => {
  const app = crearApp();
  app.ejecutar('purchases = [{id:"viejo",manualArchiveNumber:"8",totalPaid:100}]; itemsReady = false;');
  await app.ejecutar('window.deletePurchase("viejo")');
  assert.equal(app.escrituras.length, 0);
  assert.equal(app.confirmaciones.length, 0);
  assert.match(app.avisos.at(-1), /todos los productos/);
});

test("una carga no empieza con datos de compras todavía sin verificar", async () => {
  const app = crearApp();
  app.prepararManual();
  app.ejecutar("purchasesReady = false;");
  await app.click("btnSaveManualExpense");
  assert.equal(app.escrituras.length, 0);
  assert.equal(app.ejecutar("actividadActual"), null);
});

test("categorización muestra actividad y libera los controles si falla la IA", async () => {
  const app = crearApp();
  let fallar;
  app.context.categorias = new Promise((_resolve, reject) => { fallar = reject; });
  app.ejecutar('purchaseItems = [{id:"item",canonicalProductName:"Producto",category:""}]; pedirCategoriasIA = async () => await categorias;');
  const tarea = app.ejecutar("window.categorizarPendientes()");
  assert.equal(app.ejecutar("actividadEl.hidden"), false);
  assert.equal(app.get("spaceSelector").disabled, true);
  fallar(new Error("Servicio de prueba no disponible"));
  await tarea;
  assert.equal(app.ejecutar("actividadEl.hidden"), true);
  assert.equal(app.get("spaceSelector").disabled, false);
  assert.equal(app.escrituras.length, 0);
});

test("una lectura no guarda en otro espacio si el contexto cambia durante la espera", async () => {
  const app = crearApp();
  let completar;
  app.context.lectura = new Promise(resolve => { completar = resolve; });
  app.ejecutar("leerTicketConGemini = async () => await lectura;");
  app.get("scanArchiveInput").value = "144";
  const tarea = app.get("fileReceiptInput").listeners.change({ target: { files: [{}] } });
  app.ejecutar('activeSpace = "personal";');
  completar({ storeName: "Comercio", totalPaid: 200, doubtfulNotes: [], items: [{lineTotal:200}] });
  await tarea;
  assert.equal(app.escrituras.length, 0);
  assert.match(app.avisos.at(-1), /Cambió la sesión o el espacio/);
});
