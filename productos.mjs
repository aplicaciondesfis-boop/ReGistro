const UNIDADES = { g: [0.001, "kg"], kg: [1, "kg"], ml: [0.001, "l"], l: [1, "l"], unidad: [1, "unidad"] };
const CAMPOS = ["canonicalProductName", "brand", "category", "quantity", "unitPrice", "discount", "lineTotal", "presentationValue", "presentationUnit", "unitPriceNormalized", "isDoubtful"];

export function camposProducto(item) {
  return Object.fromEntries(CAMPOS.map(campo => [campo, item[campo] ?? null]));
}

function numero(valor, etiqueta, permitirCero = false) {
  const texto = String(valor ?? "").trim().replace(",", ".");
  const n = texto === "" ? NaN : Number(texto);
  if (!Number.isFinite(n) || (permitirCero ? n < 0 : n <= 0)) {
    throw new Error(`${etiqueta}: ingresá un número ${permitirCero ? "igual o mayor que cero" : "mayor que cero"}.`);
  }
  return n;
}

export function calcularCorreccionProducto(datos) {
  const nombre = String(datos.canonicalProductName ?? "").trim();
  if (!nombre) throw new Error("Ingresá el nombre del producto.");
  const quantity = numero(datos.quantity, "Cantidad");
  const contenido = numero(datos.presentationValue, "Contenido por unidad");
  const conversion = UNIDADES[datos.presentationUnit];
  if (!conversion) throw new Error("Elegí gramos, kilos, mililitros, litros o unidades.");
  const presentationValue = contenido * conversion[0];
  const lineTotal = Math.round(numero(datos.lineTotal, "Total pagado", true) * 100) / 100;
  const discount = numero(datos.discount ?? 0, "Descuento", true);
  const unitPriceNormalized = lineTotal / (quantity * presentationValue);
  const unitPrice = (lineTotal + discount) / quantity;
  if (![presentationValue, unitPriceNormalized, unitPrice, quantity * presentationValue].every(Number.isFinite) || presentationValue <= 0) {
    throw new Error("Revisá la cantidad y el contenido: el cálculo no es válido.");
  }
  return {
    canonicalProductName: nombre,
    brand: String(datos.brand ?? "").trim(),
    category: String(datos.category ?? "").trim() || "Sin detalle",
    quantity, lineTotal, discount, unitPrice,
    presentationValue, presentationUnit: conversion[1], unitPriceNormalized,
    isDoubtful: false
  };
}

export function precioNormalizadoProducto(item) {
  const q = Number(item.quantity), contenido = Number(item.presentationValue), total = Number(item.lineTotal);
  if (item.lineTotal != null && Number.isFinite(total) && total >= 0 && q > 0 && contenido > 0) {
    const precio = total / (q * contenido);
    if (Number.isFinite(precio)) return precio;
  }
  return Number(item.unitPriceNormalized ?? item.unitPrice) || 0;
}
