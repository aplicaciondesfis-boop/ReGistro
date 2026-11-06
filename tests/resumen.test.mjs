import test from "node:test";
import assert from "node:assert/strict";
import { crearApp } from "./app-fixture.mjs";
import { periodosMensuales } from "../preferencias.mjs";

test("la comparación alinea los días y respeta meses más cortos y cambios de año", () => {
  const [marzo, febrero] = periodosMensuales(new Date(2028, 2, 31, 16));
  assert.deepEqual(marzo, { inicio: new Date(2028, 2, 1), fin: new Date(2028, 3, 1) });
  assert.deepEqual(febrero, { inicio: new Date(2028, 1, 1), fin: new Date(2028, 2, 1) });
  const [, diciembre] = periodosMensuales(new Date(2027, 0, 4, 16));
  assert.deepEqual(diciembre, { inicio: new Date(2026, 11, 1), fin: new Date(2026, 11, 5) });
});

test("el resumen compara costo real en los dos períodos con el mismo filtro de tienda", () => {
  const app = crearApp();
  app.ejecutar(`
    const mesDePrueba = periodosMensuales(new Date());
    purchases = [
      { id: "hoy", storeName: "DIA", date: mesDePrueba[0].inicio, totalPaid: 100, cashbackAmount: 10 },
      { id: "pasada", storeName: "DIA", date: mesDePrueba[1].inicio, totalPaid: 50 },
      { id: "fuera", storeName: "DIA", date: mesDePrueba[0].fin, totalPaid: 500 },
      { id: "otra", storeName: "Vea", date: mesDePrueba[1].inicio, totalPaid: 200 }
    ];
    ui.tienda = "DIA";
  `);
  app.click("btnCompararMeses");
  const comparison = app.get("resumenComparacion");
  assert.equal(comparison.hidden, false);
  assert.match(comparison.innerHTML, /\$ 90/);
  assert.match(comparison.innerHTML, /\$ 50/);
  assert.match(comparison.innerHTML, /\+\$ 40/);
  assert.doesNotMatch(comparison.innerHTML, /\$ 200|\$ 500/);
  assert.match(app.get("resumenCount").textContent, /^1 registros/);
});

test("las vistas y el orden se recuperan solo para la cuenta y el hogar que los guardó", () => {
  const app = crearApp();
  app.ejecutar('dataScope = {uid:"ana",id:"hogar"}; cargarPreferenciasResumen(dataScope);');
  app.get("resumenOrdenGraficos").listeners.click({ target: { closest: () => ({ dataset: { grafico: "medio", mover: "-1" } }) } });
  app.get("resumenOrdenGraficos").listeners.change({ target: { dataset: { resumenGrafico: "tienda" }, checked: false } });
  app.click("btnCompararMeses");
  app.get("resumenNombreVista").value = "Mi comparación";
  app.get("resumenGuardarVista").listeners.submit({ preventDefault() {} });
  app.ejecutar('cargarPreferenciasResumen({uid:"bea",id:"hogar"}); renderResumen();');
  assert.doesNotMatch(app.get("resumenVistasGuardadas").innerHTML, /Mi comparación/);
  assert.match(app.get("resumenGraficos").innerHTML, /Total pagado por tienda/);
  app.ejecutar('cargarPreferenciasResumen({uid:"ana",id:"personal"});');
  assert.doesNotMatch(app.get("resumenVistasGuardadas").innerHTML, /Mi comparación/);
  app.ejecutar('cargarPreferenciasResumen(dataScope); renderResumen();');
  assert.match(app.get("resumenVistasGuardadas").innerHTML, /Mi comparación/);
  assert.doesNotMatch(app.get("resumenGraficos").innerHTML, /Total pagado por tienda/);
  assert.equal(app.ejecutar("resumenPrefs.orden[0]"), "medio");
  app.get("resumenVistasGuardadas").listeners.click({ target: { closest: () => ({ dataset: { abrirVista: "0" } }) } });
  assert.equal(app.get("resumenComparacion").hidden, false);
});
