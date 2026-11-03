import test from "node:test";
import assert from "node:assert/strict";
import { calcularCorreccionProducto, precioNormalizadoProducto } from "../productos.mjs";
import { crearApp } from "./app-fixture.mjs";

const datos = () => ({ canonicalProductName: "Producto de ejemplo", quantity: 1, lineTotal: 5000, discount: 0, presentationValue: 500, presentationUnit: "g" });

test("un paquete de medio kilo se compara por kilo sin duplicar el gasto", () => {
  const entrada = datos();
  const resultado = calcularCorreccionProducto(entrada);
  assert.equal(resultado.presentationValue, .5);
  assert.equal(resultado.presentationUnit, "kg");
  assert.equal(resultado.unitPriceNormalized, 10000);
  assert.equal(resultado.lineTotal, 5000);
  assert.equal(entrada.presentationValue, 500);
});

test("normaliza varios envases, mililitros y compras a granel", () => {
  const liquido = calcularCorreccionProducto({ ...datos(), quantity: 3, lineTotal: 900, presentationValue: 250, presentationUnit: "ml" });
  assert.equal(liquido.presentationUnit, "l");
  assert.equal(liquido.unitPriceNormalized, 1200);
  assert.equal(calcularCorreccionProducto({ ...datos(), quantity: "0,25", lineTotal: 1000, presentationValue: 1, presentationUnit: "kg" }).unitPriceNormalized, 4000);
});

test("conserva descuentos y admite un producto bonificado", () => {
  const producto = calcularCorreccionProducto({ ...datos(), discount: 1000 });
  assert.equal(producto.unitPrice, 6000);
  assert.equal(producto.discount, 1000);
  assert.equal(producto.unitPriceNormalized, 10000);
  const gratis = calcularCorreccionProducto({ ...datos(), lineTotal: 0, discount: 1000 });
  assert.equal(precioNormalizadoProducto(gratis), 0);
});

test("rechaza cantidades, contenidos e importes inválidos", () => {
  for (const cambio of [{ quantity: 0 }, { quantity: -1 }, { presentationValue: 0 }, { lineTotal: "" }, { lineTotal: -1 }, { presentationUnit: "desconocida" }, { canonicalProductName: "" }, { quantity: Infinity }]) {
    assert.throws(() => calcularCorreccionProducto({ ...datos(), ...cambio }));
  }
});

function appConProducto() {
  const app = crearApp();
  app.ejecutar(`itemsReady = true;
    purchases = [{id:"ticket",householdId:"hogar",storeName:"Comercio",totalPaid:7000,cashbackAmount:0,status:"confirmado"}];
    purchaseItems = [{id:"item",purchaseId:"ticket",householdId:"hogar",rawDescription:"TEXTO ORIGINAL",canonicalProductName:"Producto",category:"Almacén",quantity:1,lineTotal:5000,unitPrice:5000,discount:0,presentationValue:1,presentationUnit:"kg",unitPriceNormalized:5000}];
    window.editarProducto("item");`);
  app.get("correctionContent").value = "500";
  app.get("correctionUnit").value = "g";
  return app;
}
const guardar = app => app.get("productCorrectionForm").listeners.submit({ preventDefault() {} });

test("el editor muestra el nuevo precio y guarda solo la compra elegida con su valor anterior", async () => {
  const app = appConProducto();
  app.get("productCorrectionForm").listeners.input();
  assert.match(app.get("productCorrectionPreview").textContent, /10\.000/);
  await guardar(app);
  assert.equal(app.escrituras.length, 2);
  const producto = app.escrituras[0];
  assert.equal(producto.ref.id, "item");
  assert.equal(producto.data.presentationValue, .5);
  assert.equal(producto.data.unitPriceNormalized, 10000);
  assert.equal(producto.data.lastManualCorrection.before.presentationValue, 1);
  assert.equal("rawDescription" in producto.data, false);
  const cabecera = app.escrituras[1].data;
  assert.equal("totalPaid" in cabecera, false);
  assert.equal("status" in cabecera, false);
  assert.equal(app.get("modalProductCorrection").style.display, "none");
});

test("cambiar el importe marca el ticket para revisar y conserva su total original", async () => {
  const app = appConProducto();
  app.get("correctionTotal").value = "5100";
  await guardar(app);
  const cabecera = app.escrituras[1].data;
  assert.equal(cabecera.status, "a_revisar");
  assert.match(cabecera.reviewNotes[0], /suma de productos/);
  assert.equal("totalPaid" in cabecera, false);
});

test("no pisa cambios recibidos desde otro dispositivo", async () => {
  const app = appConProducto();
  app.ejecutar("purchaseItems[0].quantity = 2;");
  await guardar(app);
  assert.equal(app.escrituras.length, 0);
  assert.match(app.get("productCorrectionError").textContent, /cambió mientras/);
  assert.equal(app.get("modalProductCorrection").style.display, "flex");
});

test("cancelar o cambiar de espacio no modifica ningún registro", async () => {
  const app = appConProducto();
  await app.click("btnCloseProductCorrection");
  assert.equal(app.escrituras.length, 0);
  const otro = appConProducto();
  otro.ejecutar('activeSpace = "personal";');
  await guardar(otro);
  assert.equal(otro.escrituras.length, 0);
  assert.match(otro.get("productCorrectionError").textContent, /Cambió la sesión o el espacio/);
});

test("un error de guardado conserva el formulario para reintentar", async () => {
  const app = appConProducto();
  app.fallar();
  await guardar(app);
  assert.equal(app.escrituras.length, 0);
  assert.equal(app.get("correctionContent").value, "500");
  assert.equal(app.get("modalProductCorrection").style.display, "flex");
  assert.equal(app.get("btnSaveProductCorrection").disabled, false);
  assert.equal(app.get("spaceSelector").disabled, false);
});

test("el comparador recalcula el precio con el contenido corregido y conserva el gasto", () => {
  const app = appConProducto();
  app.ejecutar("purchaseItems[0].presentationValue = 0.5;");
  assert.equal(app.ejecutar("agruparProductos()[0].avg"), 10000);
  assert.equal(app.ejecutar("agruparProductos()[0].gasto"), 5000);
});

test("el comparador no promedia kilos con unidades sueltas", () => {
  const app = appConProducto();
  app.ejecutar('purchaseItems.push({...purchaseItems[0],id:"segundo",quantity:1,presentationValue:0.5,lineTotal:5000}); purchaseItems.push({...purchaseItems[0],id:"tercero",presentationUnit:"unidad",lineTotal:100});');
  assert.equal(app.ejecutar("agruparProductos()[0].unidad"), "kg");
  assert.equal(app.ejecutar("agruparProductos()[0].avg"), 7500);
});
