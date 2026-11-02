import test from "node:test";
import assert from "node:assert/strict";
import { numeroManual, buscarDuplicado, gruposPorTotal } from "../tickets.mjs";

test("el número manual se conserva como identificador numérico estable", () => {
  assert.equal(numeroManual(" #00142 "), "142");
  assert.equal(numeroManual("90071992547409931234"), "90071992547409931234");
  for (const valor of [null, "", "142 con birome", "1.5", "-2", "abc"]) assert.equal(numeroManual(valor), "");
});

test("el número manual tiene prioridad sobre comercio, fecha y total", () => {
  const compra = { id: "original", manualArchiveNumber: "#08", storeName: "Mercado Sol", totalPaid: 1001.23 };
  assert.deepEqual(buscarDuplicado({ numero: "8", storeName: "Otro", totalPaid: 50 }, [compra]), { compra, motivo: "numero" });
  assert.equal(buscarDuplicado({ manualArchiveNumber: "8" }, [compra], compra.id), null);
});

test("detecta alias de comercio con totales idénticos", () => {
  for (const [original, alias, total] of [
    ["SUPERMERCADO SOL", "Almacén de la esquina", 1001.23],
    ["FRIGORIFICO DE AVES EJEMPLO", "Pollería de la avenida", 2002.34],
    ["Mercado Norte", "Mercado Boulevard Norte", 3003.45],
    ["Supermercado Sol", "Almacén de la esquina", 4004.56]
  ]) {
    assert.equal(buscarDuplicado({ storeName: alias, totalPaid: total }, [{ storeName: original, totalPaid: total }])?.motivo, "total");
  }
});

test("compara centavos exactos y no confunde totales vacíos o distintos", () => {
  assert.equal(buscarDuplicado({ totalPaid: 100.01 }, [{ totalPaid: 100 }]), null);
  assert.equal(buscarDuplicado({ totalPaid: 0.1 + 0.2 }, [{ totalPaid: .3 }])?.motivo, "total");
  for (const totalPaid of [0, null, "", NaN, Infinity]) assert.equal(buscarDuplicado({ totalPaid }, [{ totalPaid }]), null);
});

test("el número fiscal requiere coincidencia de comercio y tolera formato", () => {
  const compras = [{ storeName: "DÍA", receiptNumber: "0007-00161006", totalPaid: 500 }];
  assert.equal(buscarDuplicado({ storeName: "DIA%", receiptNumber: "0007 00161006", totalPaid: 600 }, compras)?.motivo, "comprobante");
  assert.equal(buscarDuplicado({ storeName: "Vea", receiptNumber: "0007-00161006", totalPaid: 600 }, compras), null);
});

test("la auditoría agrupa todas las copias sin modificar los registros", () => {
  const datos = [{ id: "a", totalPaid: 10 }, { id: "b", totalPaid: 10 }, { id: "c", totalPaid: 10 }, { id: "d", totalPaid: 20 }];
  const copia = structuredClone(datos);
  assert.deepEqual(gruposPorTotal(datos).map(g => g.map(p => p.id)), [["a", "b", "c"]]);
  assert.deepEqual(datos, copia);
});
