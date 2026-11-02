// El número escrito a mano identifica el ticket; no depende del orden de carga.
export function numeroManual(valor) {
  const texto = String(valor ?? "").trim().replace(/^#\s*/, "");
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, "") : "";
}

function textoComparable(valor) {
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function centavos(valor) {
  if (valor == null || String(valor).trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

// Los candidatos deben pertenecer al espacio que está abierto (hogar o personal).
// El total se compara sin depender del nombre del comercio: puede tener alias.
export function buscarDuplicado(ticket, existentes, excluirId = null) {
  const candidatos = existentes.filter(p => !excluirId || p.id !== excluirId);
  const numero = numeroManual(ticket.manualArchiveNumber ?? ticket.numero);
  let compra = numero && candidatos.find(p => numeroManual(p.manualArchiveNumber ?? p.numero) === numero);
  if (compra) return { compra, motivo: "numero" };

  const comprobante = textoComparable(ticket.receiptNumber);
  const comercio = textoComparable(ticket.storeName);
  compra = comprobante && comercio && candidatos.find(p => {
    const otroComercio = textoComparable(p.storeName);
    return otroComercio && (comercio === otroComercio || comercio.includes(otroComercio) || otroComercio.includes(comercio)) &&
      textoComparable(p.receiptNumber) === comprobante;
  });
  if (compra) return { compra, motivo: "comprobante" };

  const total = centavos(ticket.totalPaid);
  compra = total !== null && candidatos.find(p => centavos(p.totalPaid) === total);
  return compra ? { compra, motivo: "total" } : null;
}

// Auditoría histórica según el criterio confirmado para estos datos: total idéntico.
export function gruposPorTotal(existentes) {
  const grupos = new Map();
  for (const compra of existentes) {
    const total = centavos(compra.totalPaid);
    if (total === null) continue;
    if (!grupos.has(total)) grupos.set(total, []);
    grupos.get(total).push(compra);
  }
  return [...grupos.values()].filter(g => g.length > 1);
}
