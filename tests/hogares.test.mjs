import test from "node:test";
import assert from "node:assert/strict";
import { crearApp } from "./app-fixture.mjs";

const user = { uid: "usuario" };
const own = { id: "propio", name: "Hogar Familiar", adminUid: "usuario", memberUids: ["usuario"], members: { usuario: "admin" } };
const shared = { id: "compartido", name: "Hogar Familiar", adminUid: "otra", memberUids: ["otra", "usuario"], members: { otra: "admin", usuario: "editor" } };

function emit(listener, records, fromCache = false) {
  return listener.recibir({
    empty: records.length === 0,
    metadata: { fromCache },
    docs: records.map(({ id, ...data }) => ({ id, data: () => data }))
  });
}

test("aceptar un código abre el hogar invitado aunque tenga el mismo nombre", async () => {
  const app = crearApp();
  await app.iniciarSesion(user);
  await emit(app.consultas[0], [own]);
  app.documentos.set("invitations/VALIDO12", { householdId: shared.id, role: "editor", isRevoked: false });
  app.documentos.set("households/compartido", shared);
  app.get("joinCodeInput").value = "valido12";
  await app.click("btnJoinHousehold");
  assert.equal(app.ejecutar("activeSpace"), shared.id);
  assert.equal(app.almacenamiento.get("finanzas-espacio:usuario"), shared.id);
  assert.equal(app.escrituras[0].ref.id, shared.id);
  assert.equal(app.escrituras[0].data["members.usuario"], "editor");
  const sharedQueries = app.consultas.slice(-3);
  assert.deepEqual(sharedQueries.map(q => q.collection), ["purchases", "purchase_items", "obligations"]);
  for (const q of sharedQueries) assert.deepEqual(q.filtros, [{ campo: "householdId", operador: "==", valor: shared.id }]);
  await emit(sharedQueries[0], [{ id: "antiguo", createdByUid: "otra", memberUids: ["otra"] }]);
  assert.equal(app.ejecutar("purchases[0].id"), "antiguo");
  app.get("spaceSelector").listeners.change({ target: { value: "personal" } });
  await emit(sharedQueries[0], [{ id: "atrasado", createdByUid: "otra" }]);
  assert.equal(app.ejecutar("purchases.length"), 0);
  assert.deepEqual(app.consultas.at(-3).filtros, [
    { campo: "householdId", operador: "==", valor: "personal" },
    { campo: "memberUids", operador: "array-contains", valor: "usuario" }
  ]);
});

test("un código ya usado abre el hogar sin cambiar el rol existente", async () => {
  const app = crearApp();
  await app.iniciarSesion(user);
  await emit(app.consultas[0], [own, shared]);
  app.documentos.set("invitations/VALIDO12", { householdId: shared.id, role: "lector", isRevoked: false });
  app.documentos.set("households/compartido", shared);
  app.get("joinCodeInput").value = "VALIDO12";
  await app.click("btnJoinHousehold");
  assert.equal(app.ejecutar("activeSpace"), shared.id);
  assert.equal(app.escrituras.length, 0);
});

test("una lista en caché incompleta conserva la elección hasta recibir el hogar compartido", async () => {
  const app = crearApp();
  app.almacenamiento.set("finanzas-espacio:usuario", shared.id);
  await app.iniciarSesion(user);
  await emit(app.consultas[0], [own], true);
  assert.equal(app.consultas.length, 1);
  assert.equal(app.almacenamiento.get("finanzas-espacio:usuario"), shared.id);
  await emit(app.consultas[0], [own, shared]);
  assert.equal(app.ejecutar("currentHousehold.id"), shared.id);
  await emit(app.consultas[1], [{ id: "cache" }], true);
  assert.equal(app.ejecutar("purchases.length"), 0);
});

test("renombrar actualiza el selector y mantiene la suscripción del hogar", async () => {
  const app = crearApp();
  await app.iniciarSesion(user);
  await emit(app.consultas[0], [own, shared]);
  app.click("btnSettings");
  app.get("householdNameInput").value = "  Nuestra casa  ";
  await app.get("householdNameForm").listeners.submit({ preventDefault() {} });
  assert.equal(app.escrituras[0].ref.id, own.id);
  assert.equal(app.escrituras[0].data.name, "Nuestra casa");
  assert.equal(app.get("summarySpaceLabel").textContent, "RESUMEN DE NUESTRA CASA");
  assert.equal(app.get("householdNameStatus").textContent, "Nombre guardado.");
  assert.ok(app.creados.some(option => option.textContent === "🏠 Nuestra casa (Tu hogar)"));
  assert.equal(app.consultas.length, 4);
  app.get("spaceSelector").listeners.change({ target: { value: shared.id } });
  assert.equal(app.get("householdNameForm").hidden, true);
  await app.get("householdNameForm").listeners.submit({ preventDefault() {} });
  assert.equal(app.escrituras.length, 1);
});
