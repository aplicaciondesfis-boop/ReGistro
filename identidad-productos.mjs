const normalizar = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Equivalencias acordadas para este hogar. La descripción del ticket se conserva.
export const EQUIVALENCIAS_PRODUCTOS = [
  { nombre: "Harina común", nombres: ["Harina 000", "Harina 0000", "Harina 0000 con vitaminas"] },
  { nombre: "Harina para pizza", nombres: ["Harina con levadura", "Harina con levadura (pizza)"] },
  { nombre: "Azúcar común", nombres: ["Azúcar", "Azúcar común"] },
  { nombre: "Aceite en aerosol", nombres: ["Rocío vegetal", "Aceite en aerosol"] },
  { nombre: "Rollo de cocina", nombres: ["Papel cocina", "Papel de cocina", "Servilletas"] },
  { nombre: "Limpiador para pisos", nombres: ["Limpiador para piso", "Desodorante de piso", "Desodorante de pisos"] },
  { nombre: "Jabón de ropa", nombres: ["Jabón para ropa", "Jabón líquido de ropa", "Jabón líquido para ropa"] }
];
const nombresPrincipales = new Map(EQUIVALENCIAS_PRODUCTOS.flatMap(({nombre,nombres}) =>
  [nombre,...nombres].map(alias => [normalizar(alias),nombre])
));

export function identificarProducto(nombre) {
  const original = String(nombre ?? "").trim(), key = normalizar(original);
  let principal = nombresPrincipales.get(key) || original;
  if (/^harina (comun|(?:de trigo |tipo )?0000?(?: con vitaminas)?)$/.test(key)) principal = "Harina común";
  if (/^harina (con levadura(?: pizza)?|para pizza)$/.test(key)) principal = "Harina para pizza";
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
  if (a.key && a.key === b.key) return 1;
  if (["fideos", "queso untable"].includes(a.key) && b.familia === a.key) return .9;
  return 0;
}
