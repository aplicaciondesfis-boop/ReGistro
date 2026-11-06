function clave(tipo, scope) {
  return `finanzas-preferencias:${tipo}:${encodeURIComponent(scope.uid)}:${encodeURIComponent(scope.id)}`;
}

export function leerPreferencias(tipo, scope, storage) {
  if (!scope) return {};
  try {
    const saved = JSON.parse((storage || window.localStorage).getItem(clave(tipo, scope)));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function guardarPreferencias(tipo, scope, value, storage) {
  if (!scope) return false;
  try {
    (storage || window.localStorage).setItem(clave(tipo, scope), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function periodosMensuales(hoy) {
  const year = hoy.getFullYear(), month = hoy.getMonth(), day = hoy.getDate();
  const diasMesAnterior = new Date(year, month, 0).getDate();
  return [
    { inicio: new Date(year, month, 1), fin: new Date(year, month, day + 1) },
    { inicio: new Date(year, month - 1, 1), fin: new Date(year, month - 1, Math.min(day, diasMesAnterior) + 1) }
  ];
}
