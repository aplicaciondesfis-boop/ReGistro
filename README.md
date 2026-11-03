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

## Corregir un producto

En **Productos**, desplegá un producto y tocá **Corregir** en la compra que corresponda. También está disponible desde el detalle del ticket y en **Planilla → Ítems**.

El formulario permite corregir nombre, marca, categoría, cantidad, contenido y total pagado. Acepta gramos y mililitros y guarda las medidas normalizadas en kg/l. Muestra el precio por kilo, litro o unidad antes de guardar y el efecto del reintegro si existe. Por ejemplo, un paquete de 500 g por $5.000 equivale a $10.000/kg, manteniendo el gasto en $5.000.

La corrección afecta solo a esa compra y conserva los valores anteriores de la última corrección. Si otro dispositivo modifica el producto mientras el formulario está abierto, se pide abrirlo de nuevo para evitar sobrescribirlo. Si se corrige el importe de la línea, el ticket pasa a revisión; su total pagado no cambia automáticamente.

## Listas de compras

La pestaña **Lista de compras** reúne faltantes generales, varias listas y el historial. El botón flotante **Anotar** permite cargar un nombre desde cualquier pantalla, seleccionar listas o crear una en ese momento. Cantidad, unidad, marca, categoría y nota son opcionales. El orden puede ser manual, con flechas, o por categorías.

Una necesidad se comparte entre sus listas: marcarla comprada resuelve todas sus referencias. Las compras parciales descuentan la cantidad que falta. Los productos comprados y descartados se conservan, y los descartados se pueden recuperar. Finalizar una lista guarda una instantánea para historial; reutilizarla crea una planificación pendiente y conserva la anterior.

Al guardar un ticket real, la app propone coincidencias con los faltantes y pide una confirmación conjunta. Los tickets anteriores a la creación del faltante se omiten. Las coincidencias aproximadas no vienen seleccionadas. Una línea de ticket se aplica a un único faltante y el mismo ticket no se suma dos veces.

La comparación usa el último precio de caja registrado por comercio, normalizado por kg/l/unidad. Sin cantidad definida se muestra una referencia de una unidad entera (por ejemplo, un kilo de queso), no una porción habitual. Para recomendar un comercio para toda la compra se exige cobertura completa; los subtotales incompletos se identifican. También muestra la alternativa de repartir la compra y las fechas de los precios.

Los beneficios son anotaciones configurables por comercio, día y medio de pago, con porcentaje opcional y notas para topes/vigencia. Los posibles descuentos y reintegros aparecen aparte: no se aplican de nuevo sobre un precio histórico que ya puede haber tenido descuentos. La app no verifica ofertas actuales.

Los datos se guardan en `households/{id}/shopping_*` para el hogar y `users/{uid}/shopping_*` para el espacio personal. Los documentos `shopping_keys` coordinan un único faltante activo por nombre y marca, incluso entre dispositivos. Las operaciones relacionadas usan transacciones.

`firestore.rules` incluye acceso por miembro del hogar o propietario del espacio personal y validación de los nuevos documentos. El ingreso de un miembro nuevo requiere una invitación válida; se impide enumerar invitaciones. Los roles de edición del resto del sistema siguen siendo un trabajo posterior. GitHub Pages publica los archivos de la app; las reglas se publican por separado en la base con ID configurado en app.js.

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
node --test tests/tickets.test.mjs tests/carga.test.mjs tests/publicacion.test.mjs tests/productos.test.mjs tests/compras.test.mjs tests/listas-store.test.mjs
```

El reconocimiento real con Firebase AI Logic se valida con tickets reales. Las reglas se comprobaron también en el simulador de Firebase (sin sesión, propietario y usuario ajeno); las operaciones autenticadas se revisan tras publicar. Los archivos de exportación de Claude, CSV personales y respaldos de Firestore no se deben subir al repositorio público.
