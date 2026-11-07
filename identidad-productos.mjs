const normalizar = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Equivalencias acordadas para este hogar. La descripción del ticket se conserva.
export const EQUIVALENCIAS_PRODUCTOS = [
  { nombre: "Harina común", nombres: ["Harina 000", "Harina 0000", "Harina 0000 con vitaminas"] },
  { nombre: "Harina para pizza", nombres: ["Harina con levadura", "Harina con levadura (pizza)"] },
  { nombre: "Azúcar común", nombres: ["Azúcar", "Azúcar común"] },
  { nombre: "Aceite en aerosol", nombres: ["Rocío vegetal", "Aceite en aerosol"] }
];

export function identificarProducto(nombre) {
  const original = String(nombre ?? "").trim(), key = normalizar(original);
  let principal = original;
  if (/^harina (comun|(?:de trigo |tipo )?0000?(?: con vitaminas)?)$/.test(key)) principal = "Harina común";
  if (/^harina (con levadura(?: pizza)?|para pizza)$/.test(key)) principal = "Harina para pizza";
  if (["azucar", "azucar comun"].includes(key)) principal = "Azúcar común";
  if (["rocio vegetal", "aceite en aerosol"].includes(key)) principal = "Aceite en aerosol";
  const identity = normalizar(principal);
  let familia = "";
  if (/^harina(?: |$)/.test(identity)) familia = "harina";
  if (/^fideos(?: |$)/.test(identity)) familia = "fideos";
  if (/^queso untable(?: |$)/.test(identity)) familia = "queso untable";
  return { key: identity, nombre: principal, familia };
}

// La relación es direccional. «Fideos» acepta mostachol, pero pedir mostachol
// conserva esa variedad. Las clases de harina requieren su equivalencia concreta.
export function coincidenciaProducto(solicitado, comprado) {
  const a = identificarProducto(solicitado), b = identificarProducto(comprado);
  if (a.key === b.key) return 1;
  if (["fideos", "queso untable"].includes(a.key) && b.familia === a.key) return .9;
  return 0;
}
