import * as firestore from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {crearCatalogo,cotizar,encontrarComprados,normalizar,pendiente,fechaDato,promocionesAplicables} from "./compras.mjs?v=11";
import {crearRepositorioListas} from "./listas-store.mjs?v=11";

export function iniciarListas({db,getData,categorias}) {
  const root=document.getElementById("shoppingApp"),fab=document.getElementById("shoppingFab"),overlay=document.getElementById("shoppingModal"),body=document.getElementById("shoppingModalBody");
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=n=>"$ "+Number(n||0).toLocaleString("es-AR",{maximumFractionDigits:2});
  const date=d=>{const v=fechaDato(d);return v&&!isNaN(+v)?v.toLocaleDateString("es-AR"):"—";};
  const number=n=>Number(n||0).toLocaleString("es-AR",{maximumFractionDigits:3});
  let context=null,repo=null,needs=[],lists=[],promos=[],unsubs=[],ready=new Set(),error="",busy=false,mode="active",sort="manual",onlyLoose=false,dialog=null,catalog=[],queue=[],receipt=null,matches=[];
  let shoppingDate=new Date().toLocaleDateString("en-CA");
  const activeLists=()=>lists.filter(l=>l.status==="active");
  const action=(name,label,id="",cls="btn-chico")=>`<button type="button" class="${cls}" data-shopping-action="${name}" data-id="${esc(id)}">${label}</button>`;
  const usable=()=>context&&ready.size===3&&!error;
  const dialogError=message=>{const e=body.querySelector("[data-shopping-error]");if(e&&overlay.style.display!=="none")e.textContent=message;else alert(message);};
  function close(){if(busy)return;overlay.style.display="none";dialog=null;processQueue();}
  function open(kind,html,id=""){dialog={kind,id};body.innerHTML=html;overlay.style.display="flex";}
  function scopeSame(s){return context&&s.uid===context.uid&&s.id===context.id&&s.kind===context.kind;}
  async function run(fn,after=()=>{}) {
    if(busy||!usable()){dialogError("Esperá a que se sincronicen las listas.");return;}
    const scope={...context};busy=true;document.getElementById("shoppingStatus").textContent="Guardando…";
    body.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=true);
    try{await fn();if(scopeSame(scope))after();}
    catch(e){console.error("Listas de compras:",e);if(scopeSame(scope))dialogError(e.message||"No se pudo guardar.");}
    finally{busy=false;document.getElementById("shoppingStatus").textContent="";body.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=false);render();}
  }
  function ordered(ns,list=null){let result=[...ns];if(sort==="category")return result.sort((a,b)=>(a.category||"Sin detalle").localeCompare(b.category||"Sin detalle","es")||a.name.localeCompare(b.name,"es"));
    if(list){const ids=list.needIds||[];return result.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}return result.sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));}
  function rows(ns,listId="",history=false) {
    const list=lists.find(l=>l.id===listId),items=ordered(ns,list);
    if(!items.length)return '<div class="vacio">Todavía no hay productos.</div>';
    const quote=cotizar(items,catalog);
    return `<ul class="shopping-items">${items.map((n,index)=>{
      const line=quote.lines.find(l=>l.need.id===n.id),best=line?.best;
      const names=(n.listIds||[]).map(id=>activeLists().find(l=>l.id===id)?.name).filter(Boolean);
      return `<li class="shopping-item ${n.done?"shopping-done":""}">
        <label class="shopping-check"><input type="checkbox" data-shopping-toggle="${esc(n.id)}" ${n.done?"checked":""} ${history||n.cancelled?"disabled":""}><span>${esc(n.name)}</span></label>
        <div class="shopping-item-meta">${n.quantity!=null?`${number(n.fulfilled||0)} / ${number(n.quantity)} ${esc(n.unit||"unidad")} · `:""}${esc(n.brand||"")}${n.note?" · "+esc(n.note):""}
          ${names.length?`<div>${names.map(name=>`<span class="shopping-tag">${esc(name)}</span>`).join(" ")}</div>`:""}
          ${n.cancelled?"Descartado":best?`<div>${money(best.price)}/${esc(line.unit)} · ${esc(best.store)} · ${date(best.date)}</div>`:n.done?"Comprado":"<div>Sin precio comparable registrado</div>"}
        </div>
        ${!history&&n.cancelled?`<div>${action("restore","Recuperar",n.id)}</div>`:!history&&!n.done?`<div class="shopping-row-actions">${action("edit-need","Detalles / listas",n.id)}${sort==="manual"?`${action("up","↑",n.id)}${action("down","↓",n.id)}`:""}</div>`:""}
      </li>`;
    }).join("")}</ul>`;
  }
  function quoteHtml(ns) {
    const q=cotizar(ns,catalog);if(!q.lines.length)return '<div class="aviso">Todos los productos de esta lista ya están resueltos.</div>';
    const benefits=promocionesAplicables(promos,new Date(shoppingDate+"T12:00:00"),q.stores.map(s=>s.name));
    return `<div class="shopping-estimate">
      <h3>Precios de caja y comercios</h3>
      <p class="card-meta">${q.reference?"Referencia: 1 kg, 1 litro o 1 unidad en productos sin cantidad definida. Podés ajustar las cantidades en Detalles.":"Estimación según las cantidades pendientes."} Los precios muestran la fecha de tu última compra registrada.</p>
      ${q.best?`<div class="aviso"><strong>Una sola tienda: ${esc(q.best.name)} · ${money(q.best.total)}</strong></div>`:'<div class="aviso aviso-warn">Faltan precios para comparar la compra completa en un solo comercio.</div>'}
      <p>Compra repartida: <strong>${money(q.splitTotal)}</strong> · ${q.known}/${q.lines.length} productos con precio.${q.best?` Diferencia estimada: ${money(Math.max(0,q.best.total-q.splitTotal))}.`:""}</p>
      <div class="tabla-wrap"><table class="tabla mini"><thead><tr><th>Producto</th><th>Referencia / cantidad</th><th>Mejor dato</th><th>Precios por comercio</th></tr></thead><tbody>${q.lines.map(l=>`<tr><td>${esc(l.need.name)}</td><td>${number(l.amount)} ${esc(l.unit||"sin unidad comparable")}${l.reference?" (referencia)":""}</td><td>${l.best?`${money(l.best.price)}/${esc(l.unit)}<br>${esc(l.best.store)}`:"Sin datos"}</td><td>${l.offers.map(p=>`${esc(p.store)}: ${money(p.price)}/${esc(p.unit)} · ${date(p.date)}${p.cashback>0?" · ese ticket tuvo reintegro":""}`).join("<br>")||"—"}</td></tr>`).join("")}</tbody></table></div>
      <details><summary>Totales y cobertura por comercio</summary><div class="tabla-wrap"><table class="tabla mini"><thead><tr><th>Comercio</th><th>Productos con precio</th><th>Importe</th></tr></thead><tbody>${q.stores.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.covered}/${q.lines.length}</td><td>${money(s.total)} ${s.complete?"":"(parcial)"}</td></tr>`).join("")}</tbody></table></div></details>
      <label class="form-label">Fecha prevista de compra<input type="date" class="form-input" data-shopping-date value="${esc(shoppingDate)}"></label>
      <div class="aviso"><strong>Posibles descuentos y reintegros, aparte</strong><p class="card-meta">Información anotada por ustedes. Confirmá vigencia, medio de pago y topes. No se descuenta automáticamente del total de referencia.</p>${benefits.length?benefits.map(benefitHtml).join(""):'<p class="card-meta">No hay beneficios anotados para estos comercios y esta fecha.</p>'}</div>
    </div>`;
  }
  const dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  function benefitHtml(p){return `<p><strong>${esc(p.store)} · ${esc(p.name)}</strong>: ${p.percent==null?"porcentaje variable / a confirmar":number(p.percent)+"%"} ${p.type==="cashback"?"de reintegro":"de descuento"}${p.weekdays?.length?" · "+p.weekdays.map(d=>dias[d]).join(", "):""}${p.paymentMethod?" · "+esc(p.paymentMethod):""}${p.note?"<br>"+esc(p.note):""}${p.disabled?" · Inactivo":""}</p>`;}
  function cards(ls,history=false){if(!ls.length)return '<div class="vacio">Todavía no hay listas '+(history?"finalizadas":"creadas")+'.</div>';
    return `<div class="shopping-list-grid">${ls.map(l=>{const ns=history?l.snapshot?.needs||[]:needs.filter(n=>(l.needIds||[]).includes(n.id)&&!n.cancelled);const done=ns.filter(n=>n.done).length;return `<article class="card-grafico"><h3>${esc(l.name)}</h3><p>${done} de ${ns.length} comprados${history?" · "+date(l.closedAt):""}</p><progress value="${done}" max="${Math.max(1,ns.length)}" aria-label="Avance de ${esc(l.name)}"></progress><div class="shopping-row-actions">${action(history?"history-list":"open-list","Abrir",l.id)}${action("duplicate","Reutilizar",l.id)}</div></article>`;}).join("")}</div>`;
  }
  function render(){
    fab.hidden=!context;fab.disabled=!usable()||busy;
    if(!context){root.innerHTML="";return;}
    if(error){root.innerHTML=`<div class="aviso aviso-warn">${esc(error)}</div>${action("retry","Volver a intentar","","btn-secondary")}`;return;}
    if(!usable()){root.innerHTML='<div class="vacio">Sincronizando tus listas…</div>';return;}
    const pending=needs.filter(pendiente),loose=pending.filter(n=>!(n.listIds||[]).some(id=>activeLists().some(l=>l.id===id)));
    root.innerHTML=`<div class="shopping-toolbar"><div><h2>Productos faltantes</h2><p class="card-meta">${pending.length} pendientes · ${loose.length} sueltos · compartidos en este espacio</p></div>${action("add-need","＋ Anotar producto","","btn-primary")}</div>
      <div class="chips">${action("view-active","Faltantes y listas","","chip "+(mode==="active"?"active":""))}${action("view-history","Historial","","chip "+(mode==="history"?"active":""))}${action("view-benefits","Beneficios","","chip "+(mode==="benefits"?"active":""))}</div>
      ${mode==="active"?`<div class="shopping-toolbar"><label class="check-repetidos"><input type="checkbox" data-shopping-loose ${onlyLoose?"checked":""}> Solo productos sueltos</label><label class="card-meta">Orden <select class="filtro-select" data-shopping-sort><option value="manual" ${sort==="manual"?"selected":""}>Manual</option><option value="category" ${sort==="category"?"selected":""}>Por categoría</option></select></label>${action("compare-all","Comparar precios")}</div>
        ${rows(onlyLoose?loose:pending)}<div class="shopping-toolbar"><h2>Mis listas</h2>${action("new-list","Crear nueva lista de compra","","btn-primary")}</div>${cards(activeLists())}`:
      mode==="history"?`<h2>Listas finalizadas</h2>${cards(lists.filter(l=>l.status==="completed").sort((a,b)=>(+fechaDato(b.closedAt)||0)-(+fechaDato(a.closedAt)||0)),true)}<h3>Comprados o descartados recientes</h3>${rows(needs.filter(n=>n.done||n.cancelled).sort((a,b)=>(+fechaDato(b.updatedAt)||0)-(+fechaDato(a.updatedAt)||0)).slice(0,20))}`:
      `<div class="shopping-toolbar"><h2>Descuentos y reintegros posibles</h2>${action("add-benefit","Anotar beneficio","","btn-primary")}</div><p class="card-meta">Guardá condiciones conocidas: días, comercio y medio de pago. Se muestran por separado en las recomendaciones.</p>${promos.map(p=>`<article class="card-grafico">${benefitHtml(p)}${action("edit-benefit","Editar",p.id)}</article>`).join("")||'<div class="vacio">Todavía no anotaste beneficios.</div>'}`}`;
    if(dialog?.kind==="list")showList(dialog.id);
    processQueue();
  }
  const errorHtml='<p data-shopping-error class="correction-error" role="alert"></p>';
  function needForm(id=null,listId=""){
    const n=needs.find(x=>x.id===id)||{},selected=n.listIds||[listId].filter(Boolean),names=[...new Set(catalog.map(p=>p.name))].sort();
    open("need",`<h2>${id?"Editar faltante":"Anotar producto"}</h2><form data-shopping-form="need" data-id="${esc(id||"")}">
      <label class="form-label">Producto<input name="name" class="form-input" required maxlength="120" list="shoppingProducts" value="${esc(n.name||"")}" placeholder="Ej: queso cremoso"></label><datalist id="shoppingProducts">${names.map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist>
      <details ${n.quantity!=null||n.note||n.brand?"open":""}><summary>Agregar detalles</summary><div class="correction-grid">
        <label class="form-label">Cantidad prevista (opcional)<input name="quantity" type="number" step="any" min="0.000001" class="form-input" value="${n.quantity??""}"></label>
        <label class="form-label">Unidad<select name="unit" class="form-select">${[["","Según el producto"],["kg","Kilos"],["g","Gramos"],["l","Litros"],["ml","Mililitros"],["unidad","Unidades"]].map(([v,t])=>`<option value="${v}" ${n.unit===v?"selected":""}>${t}</option>`).join("")}</select></label>
        <label class="form-label">Marca (opcional)<input name="brand" class="form-input" maxlength="100" value="${esc(n.brand||"")}"></label>
        <label class="form-label">Categoría<select name="category" class="form-select"><option value="">Según el producto</option>${categorias.map(c=>`<option ${n.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
      </div><label class="form-label">Nota<textarea name="note" class="form-input" maxlength="500">${esc(n.note||"")}</textarea></label></details>
      <fieldset class="correction-fields"><legend>Incluir en listas (opcional)</legend>${activeLists().map(l=>`<label class="shopping-check"><input type="checkbox" name="listIds" value="${esc(l.id)}" ${selected.includes(l.id)?"checked":""}>${esc(l.name)}</label>`).join("")||'<p class="card-meta">Podés guardarlo como producto suelto.</p>'}</fieldset>
      <details><summary>Crear una lista en este momento</summary><label class="form-label">Nombre de la nueva lista<input name="newListName" class="form-input" maxlength="100" placeholder="Ej: Compra de noviembre"></label></details>${errorHtml}
      <div class="modal-actions">${id?action("discard","Descartar faltante",id,"btn-secondary"):""}<button class="btn-primary">Guardar producto</button></div></form>`,id||"");
    body.querySelector('[name="name"]').focus();
  }
  function showList(id){const l=lists.find(x=>x.id===id);if(!l)return;const ns=needs.filter(n=>(l.needIds||[]).includes(n.id)&&!n.cancelled);
    open("list",`<h2>${esc(l.name)}</h2><div class="shopping-toolbar">${action("add-to-list","＋ Agregar producto",id,"btn-primary")}${action("rename","Renombrar",id)}${action("duplicate","Reutilizar",id)}${action("archive","Finalizar y guardar historial",id)}</div><label class="form-label">Orden<select class="filtro-select" data-shopping-sort><option value="manual" ${sort==="manual"?"selected":""}>Manual</option><option value="category" ${sort==="category"?"selected":""}>Categoría</option></select></label>${rows(ns,id)}<details open><summary>Comparación de precios</summary>${quoteHtml(ns)}</details>${errorHtml}`,id);}
  function benefitForm(id){const p=promos.find(x=>x.id===id)||{};open("benefit",`<h2>Anotar beneficio</h2><form data-shopping-form="benefit" data-id="${esc(id||"")}"><div class="correction-grid">
    <label class="form-label">Comercio<input name="store" class="form-input" required list="shoppingStores" value="${esc(p.store||"")}"></label><datalist id="shoppingStores">${[...new Set(catalog.map(x=>x.store))].map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist>
    <label class="form-label">Nombre<input name="name" class="form-input" required maxlength="120" value="${esc(p.name||"")}"></label>
    <label class="form-label">Tipo<select name="type" class="form-select"><option value="discount">Descuento en caja</option><option value="cashback" ${p.type==="cashback"?"selected":""}>Reintegro posterior</option></select></label>
    <label class="form-label">Porcentaje (vacío si es variable)<input name="percent" class="form-input" type="number" min="0" max="100" step="any" value="${p.percent??""}"></label></div>
    <fieldset class="correction-fields"><legend>Días (ninguno = todos)</legend><div class="shopping-toolbar">${dias.map((d,i)=>`<label class="shopping-check"><input type="checkbox" name="weekdays" value="${i}" ${p.weekdays?.includes(i)?"checked":""}>${d}</label>`).join("")}</div></fieldset>
    <label class="form-label">Medio de pago / tarjeta<input name="paymentMethod" class="form-input" maxlength="120" value="${esc(p.paymentMethod||"")}"></label><label class="form-label">Condiciones, topes y vigencia<textarea name="note" class="form-input" maxlength="500">${esc(p.note||"")}</textarea></label><label class="shopping-check"><input name="disabled" type="checkbox" ${p.disabled?"checked":""}> Inactivo</label>${errorHtml}<div class="modal-actions"><button class="btn-primary">Guardar beneficio</button></div></form>`);}

  async function click(e){const b=e.target.closest("[data-shopping-action]");if(!b)return;const a=b.dataset.shoppingAction,id=b.dataset.id;
    if(a==="retry"){cambiarEspacio(context);return;}if(a.startsWith("view-")){mode=a.slice(5);render();return;}
    if(a==="add-need"){needForm();return;}if(a==="edit-need"){needForm(id);return;}if(a==="add-to-list"){needForm(null,id);return;}
    if(a==="open-list"){showList(id);return;}if(a==="add-benefit"||a==="edit-benefit"){benefitForm(id);return;}
    if(a==="new-list"){const name=prompt("Nombre de la nueva lista:","Compra del mes");if(name)await run(()=>repo.crearLista(name));return;}
    if(a==="rename"){const name=prompt("Nombre de la lista:",lists.find(l=>l.id===id)?.name||"");if(name)await run(()=>repo.renombrar(id,name));return;}
    if(a==="duplicate"){const name=prompt("Nombre de la nueva lista:",(lists.find(l=>l.id===id)?.name||"Lista")+" (nueva)");if(name)await run(()=>repo.duplicar(id,name),()=>{overlay.style.display="none";dialog=null;mode="active";});return;}
    if(a==="archive"){if(confirm("¿Finalizar esta lista y conservarla en el historial? Los productos pendientes seguirán en Faltantes."))await run(()=>repo.archivar(id,catalog),()=>{overlay.style.display="none";dialog=null;});return;}
    if(a==="discard"){if(confirm("¿Descartar este faltante de todas sus listas? Se conserva en el historial."))await run(()=>repo.completar(id,false,true),()=>{overlay.style.display="none";dialog=null;});return;}
    if(a==="restore"){await run(()=>repo.completar(id,false));return;}
    if(a==="up"||a==="down"){const list=dialog?.kind==="list"?lists.find(l=>l.id===dialog.id):null;const ns=list?needs.filter(n=>(list.needIds||[]).includes(n.id)&&!n.cancelled):needs.filter(n=>pendiente(n)&&(!onlyLoose||!(n.listIds||[]).some(x=>activeLists().some(l=>l.id===x))));await run(()=>repo.mover(list?.id,id,a==="up"?-1:1,ordered(ns,list).map(n=>n.id)));return;}
    if(a==="compare-all"){open("quote",`<h2>Comparar todos los faltantes</h2>${quoteHtml(needs.filter(pendiente))}`);return;}
    if(a==="history-list"){const l=lists.find(x=>x.id===id),snapshot=l?.snapshot;open("history",`<h2>${esc(l?.name)}</h2><p>Finalizada el ${date(l?.closedAt)}</p>${action("duplicate","Reutilizar esta lista",id,"btn-primary")}${rows(snapshot?.needs||[],"",true)}<p class="card-meta">Estimación de la lista al cerrar: ${snapshot?.estimate?.total!=null?money(snapshot.estimate.total):"Sin compra completa comparable"}. Se conserva el registro original para análisis.</p>`);return;}
    if(a==="receipt-confirm"){const selected=[...body.querySelectorAll('[name="receiptNeed"]:checked')].map(x=>matches.find(m=>m.need.id===x.value)).filter(Boolean);const r=receipt;await run(()=>repo.aplicarTicket(r,selected),()=>{overlay.style.display="none";dialog=null;receipt=null;matches=[];});processQueue();}
  }
  for(const element of [root,body])element.addEventListener("click",e=>{click(e).catch(err=>dialogError(err.message));});
  for(const element of [root,body])element.addEventListener("change",e=>{
    if(e.target.matches("[data-shopping-toggle]"))run(()=>repo.completar(e.target.dataset.shoppingToggle,e.target.checked));
    if(e.target.matches("[data-shopping-sort]")){sort=e.target.value;render();}
    if(e.target.matches("[data-shopping-loose]")){onlyLoose=e.target.checked;render();}
    if(e.target.matches("[data-shopping-date]")){shoppingDate=e.target.value||shoppingDate;if(dialog?.kind==="list")showList(dialog.id);else if(dialog?.kind==="quote")open("quote",`<h2>Comparar todos los faltantes</h2>${quoteHtml(needs.filter(pendiente))}`);}
  });
  body.addEventListener("submit",e=>{const form=e.target.closest("[data-shopping-form]");if(!form)return;e.preventDefault();const f=new FormData(form),d=Object.fromEntries(f.entries()),id=form.dataset.id||null;
    if(form.dataset.shoppingForm==="need"){d.listIds=f.getAll("listIds");const product=catalog.find(p=>p.key===normalizar(d.name));if(!d.unit&&d.quantity)d.unit=product?.unit||"unidad";if(!d.category&&product)d.category=product.category;
      run(()=>repo.guardarNecesidad(d,id,d.newListName||""),()=>{overlay.style.display="none";dialog=null;});}
    else{d.weekdays=f.getAll("weekdays").map(Number);d.disabled=f.has("disabled");run(()=>repo.guardarBeneficio(d,id),()=>{overlay.style.display="none";dialog=null;});}
  });
  fab.addEventListener("click",()=>{if(usable())needForm();});
  document.getElementById("shoppingModalClose").addEventListener("click",()=>{if(dialog?.kind==="receipt"){receipt=null;matches=[];}close();});

  function processQueue(){if(dialog||busy||getData().busy||!usable()||!queue.length)return;const next=queue.shift();if(next.scope!==context.kind+"/"+context.id)return processQueue();
    const found=encontrarComprados(needs,next).filter(m=>!(m.need.receiptLinks||[]).some(l=>l.purchaseId===next.id));if(!found.length)return processQueue();receipt=next;matches=found;
    open("receipt",`<h2>¿Compraste estos productos?</h2><p>Encontramos coincidencias en el ticket de ${esc(next.storeName)}. Confirmá cuáles cubren tus faltantes.</p>${found.map(m=>`<label class="shopping-check shopping-receipt-row"><input name="receiptNeed" type="checkbox" value="${esc(m.need.id)}" ${m.score===1&&m.comparable?"checked":""}><span><strong>${esc(m.need.name)}</strong><br>${m.lines.map(l=>esc(l.name)).join(", ")}<br>${m.comparable?`${number(m.quantity)} ${esc(m.unit)}`:"Cantidad no comparable: tildalo solo si cubre todo el pendiente."}${m.score<1?" · Coincidencia aproximada: revisar":""}</span></label>`).join("")}${errorHtml}<div class="modal-actions">${action("receipt-confirm","Confirmar productos comprados","","btn-primary")}</div>`);
  }
  function cambiarEspacio(next){unsubs.forEach(f=>f());unsubs=[];context=next?{...next}:null;needs=[];lists=[];promos=[];catalog=[];queue=[];ready=new Set();error="";dialog=null;receipt=null;overlay.style.display="none";repo=null;
    if(context){const scope={...context};repo=crearRepositorioListas(db,firestore,scope);
      for(const type of ["shopping_needs","shopping_lists","shopping_promotions"])unsubs.push(firestore.onSnapshot(repo.col(type),{includeMetadataChanges:true},snap=>{
        if(!scopeSame(scope))return;const data=snap.docs.map(d=>({id:d.id,...d.data()}));if(type==="shopping_needs")needs=data;else if(type==="shopping_lists")lists=data;else promos=data;
        if(!snap.metadata.fromCache)ready.add(type);render();
      },err=>{if(!scopeSame(scope))return;error="No se pudieron sincronizar las listas. Revisá tu conexión y el acceso a este espacio.";console.error(err);render();}));}
    render();
  }
  function actualizarCatalogo(){const d=getData();catalog=crearCatalogo(d.purchases,d.items);render();}
  function ticketGuardado(data){if(!context)return;queue.push({...data,scope:context.kind+"/"+context.id});setTimeout(processQueue,0);}
  return {cambiarEspacio,actualizarCatalogo,ticketGuardado,procesarPendientes:processQueue};
}
