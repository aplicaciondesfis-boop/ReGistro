# Finanzas Hogar

Aplicación web de gastos personales y del hogar. Usa HTML, CSS y JavaScript sin compilación, Firebase Authentication, Firestore y Firebase AI Logic. Se publica con GitHub Pages y puede instalarse como PWA.

## Número manual del ticket

Cada ticket nuevo necesita el número único escrito a mano en el comprobante. Es distinto del número fiscal y del orden de carga. Se guarda en `manualArchiveNumber` y aparece en las tablas como **Nº manual**.

- La lectura de fotos y la carga manual exigen este número. Un número ya utilizado en el espacio actual bloquea la carga.
- En CSV, el número viene de `ticket_n`. Una fila sin número o con un número inválido impide importar el archivo.
- Los registros antiguos sin número muestran **Sin asignar**. Se puede completar desde el detalle de la compra; la app no inventa números.
- El control se realiza dentro del espacio abierto: hogar compartido o espacio personal.

## Control de duplicados

`tickets.mjs` comparte el control entre fotos, carga manual e importación. Compara primero el número manual, luego el comprobante fiscal con el comercio y finalmente el total exacto en centavos. Los nombres diferentes de un mismo comercio no impiden detectar totales iguales.

Un número manual o comprobante ya utilizado bloquea otra copia. Si una foto o carga manual coincide solo por total, se pide confirmar expresamente que es una compra distinta. En la importación CSV se omiten las coincidencias y se informa antes de guardar; también se comparan tickets del mismo archivo.

**Revisión y pendientes** agrupa los tickets con el mismo total para comparar fechas, comercios, productos y reintegros. Esta vista no decide qué copia conservar ni borra automáticamente. Antes de limpiar registros históricos se debe conservar un respaldo y revisar su detalle.

La prevención actual funciona en el cliente con los registros sincronizados del espacio abierto. Todavía no garantiza exclusividad si dos dispositivos guardan el mismo número al mismo tiempo; esa garantía requiere un mecanismo atómico compatible con las reglas de Firestore. Las reglas y los roles son un trabajo posterior a esta propuesta.

## Actividad de la IA

Un indicador en la esquina superior derecha muestra la lectura, categorización y guardado. Sigue visible al cerrar el modal o cambiar de pestaña. Durante una tarea se bloquean otras cargas y el cambio de espacio. Un error restaura los controles para reintentar.

## Archivos y comprobaciones

- `index.html`: estructura y formularios.
- `app.js`: Firebase, flujos de carga y pantallas.
- `tickets.mjs`: identificación y comparación de tickets, sin dependencias de Firebase.
- `styles.css`: diseño y adaptación a celular.
- `sw.js`: caché de la PWA; incluye el nuevo módulo.

Las pruebas usan datos ficticios y sustituyen Firebase por memoria; no escriben en la base real. Con Node.js instalado:

```sh
node --check app.js
node --check sw.js
node --test tests/tickets.test.mjs tests/carga.test.mjs tests/publicacion.test.mjs
```

La lectura real con Firebase AI Logic y las reglas de la base requieren validación adicional en un entorno autenticado. Los archivos de exportación de Claude, CSV personales y respaldos de Firestore no se deben subir al repositorio público.
