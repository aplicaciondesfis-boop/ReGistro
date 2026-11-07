import * as firestore from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {crearCatalogo,cotizar,encontrarComprados,normalizar,pendiente,fechaDato,promocionesAplicables} from "./compras.mjs?v=18";
import {crearRepositorioListas} from "./listas-store.mjs?v=18";
import {crearEntradaRapida,posiblesDuplicados} from "./listas-entrada.mjs?v=18";
import {guardarPreferencias,leerPreferencias} from "./preferencias.mjs?v=16";

export function iniciarListas({db,getData,categorias}) {
  const root=document.getElementById("shoppingApp"),fab=document.getElementById("shoppingFab"),overlay=document.getElementById("shoppingModal"),body=document.getElementById("shoppingModalBody");
  const duplicateDialog=document.getElementById("shoppingDuplicate");
  const removeDialog=document.getElementById("shoppingRemove");
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=n=>"$ "+Number(n||0).toLocaleString("es-AR",{maximumFractionDigits:2});
  const date=d=>{const v=fechaDato(d);return v&&!isNaN(+v)?v.toLocaleDateString("es-AR"):"—";};
  const number=n=>Number(n||0).toLocaleString("es-AR",{maximumFractionDigits:3});
  let context=null,repo=null,needs=[],lists=[],promos=[],unsubs=[],ready=new Set(),error="",busy=false,mode="active",sort="manual",onlyLoose=false,dialog=null,catalog=[],queue=[],receipt=null,matches=[];
  let shoppingDate=new Date().toLocaleDateString("en-CA");
  let expanded=new Set(),quickSelections=new Map(),detailedDraft=null;
  let cardPrefs={},resolverDuplicado=null;
  let resolverBorrado=null;
  const recentNeeds=new Map();
  const colors=["Naranja","Verde","Azul","Violeta","Rosa"];
  const cardPref=id=>Object.hasOwn(cardPrefs,id)?cardPrefs[id]||{}:{};
  const activeLists=()=>lists.filter(l=>l.status==="active");
  const entrada=crearEntradaRapida({getScope:()=>repo,guardar:(name,options,target)=>guardarProducto(target,{name,listIds:options.listIds||[],category:catalog.find(p=>p.key===normalizar(name))?.category||"Sin detalle"}),onChange:()=>render()});

  function elegirDuplicado(input,candidates){
    duplicateDialog.returnValue="";
    duplicateDialog.querySelector("#shoppingDuplicateName").textContent=`«${input.name}» se parece a un producto que ya tenés pendiente.`;
    duplicateDialog.querySelector("#shoppingDuplicateExisting").innerHTML=candidates.map(n=>{
      const names=activeLists().filter(l=>n.listIds?.includes(l.id)).map(l=>l.name);
      return `<option value="${esc(n.id)}">${esc([n.name,n.brand,names.join(", ")].filter(Boolean).join(" · "))}</option>`;
    }).join("");
    duplicateDialog.showModal();
    return new Promise(resolve=>{resolverDuplicado=resolve;});
  }

  duplicateDialog.addEventListener("close",()=>{
    const id=duplicateDialog.querySelector("#shoppingDuplicateExisting").value;
    resolverDuplicado?.({choice:duplicateDialog.returnValue,id});
    resolverDuplicado=null;
  });

  removeDialog.addEventListener("close",()=>{
    resolverBorrado?.(removeDialog.returnValue==="delete");
    resolverBorrado=null;
  });

  async function borrarProducto(id){
    if(busy||entrada.isSaving()||!usable()){
      dialogError("Esperá a que termine el guardado y se sincronicen las listas.");
      return;
    }
    const need=needs.find(n=>n.id===id&&pendiente(n));
    if(!need)return;
    const target=repo;
    removeDialog.returnValue="";
    removeDialog.querySelector("#shoppingRemoveName").textContent=need.name;
    const names=activeLists().filter(l=>(l.needIds||[]).includes(id)).map(l=>l.name);
    removeDialog.querySelector("#shoppingRemoveScope").textContent=names.length
      ? `Se quitará de ${names.map(name=>`«${name}»`).join(", ")}. Podés recuperarlo desde Historial.`
      : "Se quitará de Productos a comprar. Podés recuperarlo desde Historial.";
    removeDialog.showModal();
    const accepted=await new Promise(resolve=>{resolverBorrado=resolve;});
    if(!accepted||target!==repo)return;
    await run(()=>target.completar(id,false,true),()=>{overlay.style.display="none";dialog=null;});
  }

  async function guardarProducto(target,input,id=null,newListName=""){
    const candidates=id?[]:posiblesDuplicados(input,[...needs,...recentNeeds.values()]);
    const selectedLists=new Set(input.listIds||[]);
    const enLista=n=>Number(n.listIds?.some(id=>selectedLists.has(id))||false);
    candidates.sort((a,b)=>enLista(b)-enLista(a)||a.name.localeCompare(b.name,"es"));
    let existing;
    if(candidates.length){
      const {choice,id:selected}=await elegirDuplicado(input,candidates);
      if(target!==repo||!["existing","new"].includes(choice))return false;
      if(choice==="existing")existing=candidates.find(n=>n.id===selected);
    }
    const result=existing
      ? await target.usarNecesidad(existing,input.listIds||[],newListName)
      : await target.guardarNecesidad(input,id,newListName);
    // Un pegado puede llegar al renglón siguiente antes que la escucha de Firestore.
    if(target===repo&&!needs.some(n=>n.id===result.id))recentNeeds.set(result.id,result.need);
    return result;
  }
  const action=(name,label,id="",cls="btn-chico")=>`<button type="button" class="${cls}" data-shopping-action="${name}" data-id="${esc(id)}" ${name==="discard"?`aria-label="Borrar ${esc(needs.find(n=>n.id===id)?.name||"producto")}" ${busy||entrada.isSaving()?"disabled":""}`:""}>${label}</button>`;
  const usable=()=>context&&ready.size===3&&!error;
  const dialogError=message=>{const e=body.querySelector("[data-shopping-error]");if(e&&overlay.style.display!=="none")e.textContent=message;else alert(message);};
  function close(){if(busy)return;overlay.style.display="none";dialog=null;processQueue();}
  function open(kind,html,id=""){dialog={kind,id};body.innerHTML=html;overlay.style.display="flex";}
  function scopeSame(s){return context&&s.uid===context.uid&&s.id===context.id&&s.kind===context.kind;}
  async function run(fn,after=()=>{}) {
    if(busy||entrada.isSaving()||!usable()){dialogError("Esperá a que termine el guardado y se sincronicen las listas.");return;}
    const scope={...context};busy=true;document.getElementById("shoppingStatus").textContent="Guardando…";
    body.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=true);
    try{const result=await fn();if(scopeSame(scope))after(result);}
    catch(e){console.error("Listas de compras:",e);if(scopeSame(scope))dialogError(e.message||"No se pudo guardar.");}
    finally{busy=false;document.getElementById("shoppingStatus").textContent="";body.querySelectorAll("button,input,select,textarea").forEach(e=>e.disabled=false);render();}
  }
  function ordered(ns,list=null){let result=[...ns];if(sort==="category")return result.sort((a,b)=>(a.category||"Sin detalle").localeCompare(b.category||"Sin detalle","es")||a.name.localeCompare(b.name,"es"));
    if(list){const ids=list.needIds||[];return result.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}return result.sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));}
  function rows(ns,listId="",history=false,compact=false) {
    const list=lists.find(l=>l.id===listId),items=ordered(ns,list);
    if(!items.length)return '<div class="vacio">Todavía no hay productos.</div>';
    const quote=cotizar(items,catalog);
    return `<ul class="shopping-items">${items.map((n,index)=>{
      const line=quote.lines.find(l=>l.need.id===n.id),best=line?.best;
      if(compact){
        const price=line?.averagePrice==null?'<span class="shopping-item-budget is-missing">Sin precio</span>':
          `<span class="shopping-item-budget"><strong>${money(line.averagePrice)}/${esc(line.unit)}</strong>${line.reference?'':`<small>${number(line.amount)} ${esc(line.unit)} · ${money(line.estimatedTotal)}</small>`}</span>`;
        return `<li class="shopping-item shopping-item-compact"><label class="shopping-check"><input type="checkbox" data-shopping-toggle="${esc(n.id)}"><span>${esc(n.name)}</span></label>${price}<div class="shopping-item-actions">${action("edit-need","Detalles",n.id)}${action("discard","Borrar",n.id,"btn-chico btn-peligro")}</div></li>`;
      }
      const names=(n.listIds||[]).map(id=>activeLists().find(l=>l.id===id)?.name).filter(Boolean);
      return `<li class="shopping-item ${n.done?"shopping-done":""}">
        <label class="shopping-check"><input type="checkbox" data-shopping-toggle="${esc(n.id)}" ${n.done?"checked":""} ${history||n.cancelled?"disabled":""}><span>${esc(n.name)}</span></label>
        <div class="shopping-item-meta">${n.quantity!=null?`${number(n.fulfilled||0)} / ${number(n.quantity)} ${esc(n.unit||"unidad")} · `:""}${esc(n.brand||"")}${n.note?" · "+esc(n.note):""}
          ${names.length?`<div>${names.map(name=>`<span class="shopping-tag">${esc(name)}</span>`).join(" ")}</div>`:""}
          ${n.cancelled?"Borrado":best?`<div>${money(best.price)}/${esc(line.unit)} · ${esc(best.store)} · ${date(best.date)}</div>`:n.done?"Comprado":"<div>Sin precio comparable registrado</div>"}
        </div>
        ${!history&&n.cancelled?`<div>${action("restore","Recuperar",n.id)}</div>`:!history&&!n.done?`<div class="shopping-row-actions" data-shopping-list="${esc(listId)}">${action("edit-need",compact?"Detalles":"Detalles / listas",n.id)}${action("discard","Borrar",n.id,"btn-chico btn-peligro")}${sort==="manual"?`${action("up","↑",n.id)}${action("down","↓",n.id)}`:""}</div>`:""}
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
  function composer(key){const s=entrada.state(key);return `<div class="shopping-composer" data-composer="${esc(key)}"><label class="form-label">Agregar productos<textarea class="form-input shopping-quick-entry" data-quick-entry="${esc(key)}" rows="2" placeholder="Escribí un producto por renglón">${esc(s.text)}</textarea></label><p class="shopping-entry-hint">Shift+Enter guarda y sigue en otro renglón. También podés pegar una lista.</p><div class="shopping-composer-bottom">${action("save-lines","Agregar lo escrito",key)}<span class="shopping-entry-status ${s.error?"shopping-entry-error":""}" role="status">${esc(s.error|| (s.pending?`Guardando ${s.pending}…`:s.saved?`${s.saved} guardado${s.saved===1?"":"s"}`:""))}</span></div></div>`;}
  const isLoose=n=>!(n.listIds||[]).some(id=>activeLists().some(l=>l.id===id));
  function card(l=null){
    const key=l?l.id:"loose",opened=expanded.has(key),all=needs.filter(n=>!n.cancelled&&(l?(l.needIds||[]).includes(n.id):isLoose(n))),pending=ordered(all.filter(pendiente),l),done=all.filter(n=>n.done).length;
    const title=l?.name||"Productos a comprar",prefs=l?cardPref(l.id):{},customColor=colors.indexOf(prefs.color);
    const color=customColor>=0?customColor:l?1+[...l.id].reduce((v,c)=>v+c.charCodeAt(0),0)%4:0;
    const budget=cotizar(pending,catalog),partial=budget.known<budget.lines.length;
    const totalLabel=budget.known||!pending.length?money(budget.averageTotal):"Sin precios";
    const coverage=partial?`${budget.known} de ${pending.length} con precio`:'Todos los pendientes con precio';
    return `<article class="shopping-note shopping-note-${color} ${opened?"is-expanded":""}" data-shopping-card="${esc(key)}"><div class="shopping-note-head"><div class="shopping-note-heading"><span class="shopping-note-kicker">${l?(prefs.pinned?"FIJADA":"MI LISTA"):"PRODUCTOS SUELTOS"}</span><div class="shopping-note-title"><h3>${esc(title)}</h3><span class="shopping-card-budget"><strong>${totalLabel}</strong><small>${partial?"Estimado parcial":"Estimado"}</small></span></div><p>${pending.length} pendiente${pending.length===1?"":"s"}${l?` · ${done} comprado${done===1?"":"s"}`:" · sin asignar a una lista"}</p>${pending.length?`<p class="shopping-budget-coverage">${coverage}</p>`:""}</div><button type="button" class="shopping-expand" data-shopping-action="expand-card" data-id="${esc(key)}" aria-expanded="${opened}" aria-controls="shopping-card-${esc(key)}" aria-label="${opened?"Contraer":"Expandir"} ${esc(title)}">${opened?"−":"+"}</button></div>
      <div id="shopping-card-${esc(key)}" class="shopping-note-content"><div class="shopping-note-products" data-card-scroll="${esc(key)}">${opened?rows(pending,l?.id||"",false,true):pending.length?`<ul class="shopping-preview">${pending.slice(0,3).map(n=>`<li class="shopping-preview-row"><label class="shopping-check"><input type="checkbox" data-shopping-toggle="${esc(n.id)}"><span>${esc(n.name)}</span></label>${action("discard","Borrar",n.id,"btn-chico btn-peligro")}</li>`).join("")}</ul>${pending.length>3?`<p class="shopping-preview-more">Y ${pending.length-3} más…</p>`:""}`:'<p class="shopping-note-empty">Anotá acá lo que necesitás comprar.</p>'}</div>${opened?composer("card:"+key):""}</div>
      ${opened&&pending.length?`<p class="shopping-budget-note">Promedio del último precio por comercio. ${budget.reference?"Sin cantidad, se estima 1 kg, 1 litro o 1 unidad.":"Se estima la cantidad pendiente."}</p>`:""}
      <div class="shopping-note-footer">${action("card-add","＋ Agregar productos",key,"shopping-text-button")}${l?action("open-list","Detalles y precios",l.id,"shopping-text-button"):action("compare-loose","Comparar precios","","shopping-text-button")}</div></article>`;
  }
  function rememberEditor(){const e=document.activeElement;return e?.matches("[data-quick-entry]")?{key:e.dataset.quickEntry,start:e.selectionStart,end:e.selectionEnd,length:e.value.length}:null;}
  function restoreEditor(focus){for(const e of document.querySelectorAll("[data-quick-entry]")){const value=entrada.state(e.dataset.quickEntry).text;if(e.value!==value)e.value=value;if(focus?.key===e.dataset.quickEntry){e.focus({preventScroll:true});const delta=focus.length-value.length;e.setSelectionRange(Math.max(0,focus.start-delta),Math.max(0,focus.end-delta));}}}
  function render(){
    const focus=rememberEditor(),scrolls=new Map([...root.querySelectorAll("[data-card-scroll]")].map(e=>[e.dataset.cardScroll,e.scrollTop]));
    if(!busy)document.getElementById("shoppingStatus").textContent=entrada.isSaving()?"Guardando productos…":"";
    fab.hidden=!context;fab.disabled=!usable()||busy;
    if(!context){root.innerHTML="";return;}
    if(error){root.innerHTML=`<div class="aviso aviso-warn">${esc(error)}</div>${action("retry","Volver a intentar","","btn-secondary")}`;return;}
    if(!usable()){root.innerHTML='<div class="vacio">Sincronizando tus listas…</div>';return;}
    const pending=needs.filter(pendiente),loose=pending.filter(isLoose),active=activeLists();
    root.innerHTML=`<div class="shopping-toolbar"><div><h2>Productos faltantes</h2><p class="card-meta">${pending.length} pendientes · ${loose.length} sueltos · compartidos en este espacio</p></div><div class="shopping-row-actions">${action("new-list","Crear nueva lista","","btn-secondary")}${action("add-need","＋ Anotar productos","","btn-primary")}</div></div>
      <div class="chips">${action("view-active","Faltantes y listas","","chip "+(mode==="active"?"active":""))}${action("view-history","Historial","","chip "+(mode==="history"?"active":""))}${action("view-benefits","Beneficios","","chip "+(mode==="benefits"?"active":""))}</div>
      ${mode==="active"?`<div class="shopping-toolbar"><label class="check-repetidos"><input type="checkbox" data-shopping-loose ${onlyLoose?"checked":""}> Solo productos sueltos</label><label class="card-meta">Orden <select class="filtro-select" data-shopping-sort><option value="manual" ${sort==="manual"?"selected":""}>Manual</option><option value="category" ${sort==="category"?"selected":""}>Por categoría</option></select></label>${action("compare-all","Comparar precios")}</div>
        <div class="shopping-notes-grid">${onlyLoose?"":active.filter(l=>cardPref(l.id).pinned).map(card).join("")}${card()}${onlyLoose?"":active.filter(l=>!cardPref(l.id).pinned).map(card).join("")}</div>`:
      mode==="history"?`<h2>Listas finalizadas</h2>${cards(lists.filter(l=>l.status==="completed").sort((a,b)=>(+fechaDato(b.closedAt)||0)-(+fechaDato(a.closedAt)||0)),true)}<h3>Comprados o borrados recientes</h3>${rows(needs.filter(n=>n.done||n.cancelled).sort((a,b)=>(+fechaDato(b.updatedAt)||0)-(+fechaDato(a.updatedAt)||0)).slice(0,20))}`:
      `<div class="shopping-toolbar"><h2>Descuentos y reintegros posibles</h2>${action("add-benefit","Anotar beneficio","","btn-primary")}</div><p class="card-meta">Guardá condiciones conocidas: días, comercio y medio de pago. Se muestran por separado en las recomendaciones.</p>${promos.map(p=>`<article class="card-grafico">${benefitHtml(p)}${action("edit-benefit","Editar",p.id)}</article>`).join("")||'<div class="vacio">Todavía no anotaste beneficios.</div>'}`}`;
    if(dialog?.kind==="list")showList(dialog.id);
    for(const e of root.querySelectorAll("[data-card-scroll]"))e.scrollTop=scrolls.get(e.dataset.cardScroll)||0;
    for(const e of body.querySelectorAll("[data-composer]")){const s=entrada.state(e.dataset.composer),status=e.querySelector("[role=status]");status.textContent=s.error||(s.pending?`Guardando ${s.pending}…`:s.saved?`${s.saved} guardado${s.saved===1?"":"s"}`:"");status.classList.toggle("shopping-entry-error",!!s.error);}
    restoreEditor(focus);
    processQueue();
  }
  const errorHtml='<p data-shopping-error class="correction-error" role="alert"></p>';
  function quickForm(listId="",existingKey=null){
    const key=existingKey||"modal:"+(listId||"loose");if(!quickSelections.has(key))quickSelections.set(key,[listId].filter(Boolean));
    const selected=quickSelections.get(key);
    open("quick",`<h2>Anotar productos</h2><p class="card-meta">Escribí uno por renglón. Cada salto de línea lo guarda y te deja seguir escribiendo.</p>${composer(key)}<fieldset class="correction-fields"><legend>Agregar a estas listas</legend>${activeLists().map(l=>`<label class="shopping-check"><input type="checkbox" data-quick-list="${esc(key)}" value="${esc(l.id)}" ${selected.includes(l.id)?"checked":""}>${esc(l.name)}</label>`).join("")||'<p class="card-meta">Por ahora se guardan en Productos a comprar.</p>'}</fieldset><div class="shopping-row-actions">${action("quick-new-list","Crear una lista",key)}${action("quick-details","Un producto con detalles",key)}</div><p class="card-meta">Podés ajustar cantidades, marcas y notas desde Detalles de cada producto.</p>`);
    dialog.key=key;const input=body.querySelector("[data-quick-entry]");input.focus();input.setSelectionRange(input.value.length,input.value.length);
  }
  function listNameForm(type,id="",returnKey=null){
    const current=lists.find(l=>l.id===id),name=type==="new"?"":type==="duplicate"?(current?.name||"Lista")+" (nueva)":current?.name||"";
    open("list-name",`<h2>${type==="rename"?"Renombrar lista":type==="duplicate"?"Reutilizar lista":"Crear nueva lista"}</h2><form data-shopping-form="list-name" data-operation="${type}" data-id="${esc(id)}"><label class="form-label">Nombre de la lista<input name="name" class="form-input" required maxlength="100" placeholder="Ej: Compra del mes" value="${esc(name)}"></label>${errorHtml}<div class="modal-actions"><button class="btn-primary">${type==="rename"?"Guardar nombre":"Crear lista"}</button></div></form>`,id);
    dialog.returnKey=returnKey;body.querySelector('[name="name"]').focus();
  }
  function optionsFor(key){if(key.startsWith("card:"))return{listIds:key==="card:loose"?[]:[key.slice(5)]};return{listIds:(quickSelections.get(key)||[]).filter(id=>activeLists().some(l=>l.id===id))};}
  function commitEditor(key,all=false){if(!usable()||busy){entrada.state(key).error="Esperá a que termine el guardado y se sincronicen las listas.";render();return;}return entrada.commit(key,{all,options:optionsFor(key)});}
  function needForm(id=null,listId="",initialName="",initialLists=null){
    const n=needs.find(x=>x.id===id)||{name:initialName},selected=n.listIds||initialLists||[listId].filter(Boolean),names=[...new Set(catalog.map(p=>p.name))].sort();
    const reference=id?cotizar([n],catalog).lines[0]:null,best=reference?.best;
    const priceInfo=id?`<p class="aviso shopping-detail-price">${best?`Último precio de referencia: <strong>${money(best.price)}/${esc(reference.unit)}</strong><br>${esc(best.store)} · ${date(best.date)}`:"Sin precio comparable registrado"}</p>`:"";
    const remove=id?action("discard","Borrar producto",id,"btn-secondary btn-peligro"):"";
    open("need",`<h2>${id?"Editar faltante":"Anotar producto"}</h2>${remove}${errorHtml}${priceInfo}<form data-shopping-form="need" data-id="${esc(id||"")}">
      <label class="form-label">Producto<input name="name" class="form-input" required maxlength="120" list="shoppingProducts" value="${esc(n.name||"")}" placeholder="Ej: queso cremoso"></label><datalist id="shoppingProducts">${names.map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist>
      <details ${n.quantity!=null||n.note||n.brand?"open":""}><summary>Agregar detalles</summary><div class="correction-grid">
        <label class="form-label">Cantidad prevista (opcional)<input name="quantity" type="number" step="any" min="0.000001" class="form-input" value="${n.quantity??""}"></label>
        <label class="form-label">Unidad<select name="unit" class="form-select">${[["","Según el producto"],["kg","Kilos"],["g","Gramos"],["l","Litros"],["ml","Mililitros"],["unidad","Unidades"]].map(([v,t])=>`<option value="${v}" ${n.unit===v?"selected":""}>${t}</option>`).join("")}</select></label>
        <label class="form-label">Marca (opcional)<input name="brand" class="form-input" maxlength="100" value="${esc(n.brand||"")}"></label>
        <label class="form-label">Categoría<select name="category" class="form-select"><option value="">Según el producto</option>${categorias.map(c=>`<option ${n.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
      </div><label class="form-label">Nota<textarea name="note" class="form-input" maxlength="500">${esc(n.note||"")}</textarea></label></details>
      <fieldset class="correction-fields"><legend>Incluir en listas (opcional)</legend>${activeLists().map(l=>`<label class="shopping-check"><input type="checkbox" name="listIds" value="${esc(l.id)}" ${selected.includes(l.id)?"checked":""}>${esc(l.name)}</label>`).join("")||'<p class="card-meta">Podés guardarlo como producto suelto.</p>'}</fieldset>
       <details><summary>Crear una lista en este momento</summary><label class="form-label">Nombre de la nueva lista<input name="newListName" class="form-input" maxlength="100" placeholder="Ej: Compra de noviembre"></label></details>
       <div class="modal-actions"><button class="btn-primary">Guardar producto</button></div></form>`,id||"");
    body.scrollTop=0;
    body.querySelector('[name="name"]').focus({preventScroll:true});
  }
  function showList(id){const l=lists.find(x=>x.id===id);if(!l)return;const ns=needs.filter(n=>(l.needIds||[]).includes(n.id)&&!n.cancelled);
    open("list",`<h2>${esc(l.name)}</h2><div class="shopping-toolbar">${action("add-to-list","＋ Agregar producto",id,"btn-primary")}${action("personalize","Personalizar lista",id)}${action("rename","Renombrar",id)}${action("duplicate","Reutilizar",id)}${action("archive","Finalizar y guardar historial",id)}</div><label class="form-label">Orden<select class="filtro-select" data-shopping-sort><option value="manual" ${sort==="manual"?"selected":""}>Manual</option><option value="category" ${sort==="category"?"selected":""}>Categoría</option></select></label>${rows(ns,id)}<details open><summary>Comparación de precios</summary>${quoteHtml(ns)}</details>${errorHtml}`,id);}

  function personalizeList(id){
    const list=activeLists().find(l=>l.id===id);
    if(!list)return;
    const prefs=cardPref(id);
    open("list-preferences",`<h2>Personalizar ${esc(list.name)}</h2><p class="card-meta">Esta vista se guarda para tu cuenta en este navegador.</p>
      <form data-shopping-form="list-preferences" data-id="${esc(id)}">
        <label class="form-label">Color de la tarjeta<select name="color" class="form-select"><option value="">Automático</option>${colors.map(color=>`<option ${prefs.color===color?"selected":""}>${color}</option>`).join("")}</select></label>
        <label class="shopping-check"><input name="pinned" type="checkbox" ${prefs.pinned?"checked":""}> Fijar arriba</label>
        ${errorHtml}<div class="modal-actions"><button class="btn-primary">Guardar preferencias</button></div>
      </form>`,id);
    body.scrollTop=0;
    body.querySelector('select[name="color"]').focus({preventScroll:true});
  }
  function benefitForm(id){const p=promos.find(x=>x.id===id)||{};open("benefit",`<h2>Anotar beneficio</h2><form data-shopping-form="benefit" data-id="${esc(id||"")}"><div class="correction-grid">
    <label class="form-label">Comercio<input name="store" class="form-input" required list="shoppingStores" value="${esc(p.store||"")}"></label><datalist id="shoppingStores">${[...new Set(catalog.map(x=>x.store))].map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist>
    <label class="form-label">Nombre<input name="name" class="form-input" required maxlength="120" value="${esc(p.name||"")}"></label>
    <label class="form-label">Tipo<select name="type" class="form-select"><option value="discount">Descuento en caja</option><option value="cashback" ${p.type==="cashback"?"selected":""}>Reintegro posterior</option></select></label>
    <label class="form-label">Porcentaje (vacío si es variable)<input name="percent" class="form-input" type="number" min="0" max="100" step="any" value="${p.percent??""}"></label></div>
    <fieldset class="correction-fields"><legend>Días (ninguno = todos)</legend><div class="shopping-toolbar">${dias.map((d,i)=>`<label class="shopping-check"><input type="checkbox" name="weekdays" value="${i}" ${p.weekdays?.includes(i)?"checked":""}>${d}</label>`).join("")}</div></fieldset>
    <label class="form-label">Medio de pago / tarjeta<input name="paymentMethod" class="form-input" maxlength="120" value="${esc(p.paymentMethod||"")}"></label><label class="form-label">Condiciones, topes y vigencia<textarea name="note" class="form-input" maxlength="500">${esc(p.note||"")}</textarea></label><label class="shopping-check"><input name="disabled" type="checkbox" ${p.disabled?"checked":""}> Inactivo</label>${errorHtml}<div class="modal-actions"><button class="btn-primary">Guardar beneficio</button></div></form>`);}

  async function click(e){const b=e.target.closest("[data-shopping-action]");if(!b)return;const a=b.dataset.shoppingAction,id=b.dataset.id;
    if(a==="retry"){cambiarEspacio(context);return;}if(a.startsWith("view-")){mode=a.slice(5);render();return;}
    if(a==="expand-card"||a==="card-add"){if(a==="expand-card"&&expanded.has(id))expanded.delete(id);else expanded.add(id);render();if(a==="card-add"){const input=[...root.querySelectorAll("[data-quick-entry]")].find(e=>e.dataset.quickEntry==="card:"+id);if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}return;}
    if(a==="save-lines"){await commitEditor(id,true);return;}
    if(a==="add-need"){quickForm();return;}if(a==="edit-need"){detailedDraft=null;needForm(id);return;}if(a==="add-to-list"){quickForm(id);return;}
    if(a==="quick-new-list"){listNameForm("new","",id);return;}
    if(a==="quick-details"){const text=entrada.state(id).text,name=text.trim().includes("\n")?"":text.trim();detailedDraft=name?{key:id,text}:null;needForm(null,"",name,optionsFor(id).listIds);return;}
    if(a==="open-list"){showList(id);return;}if(a==="add-benefit"||a==="edit-benefit"){benefitForm(id);return;}
    if(a==="personalize"){personalizeList(id);return;}
    if(a==="new-list"){listNameForm("new");return;}
    if(a==="rename"){listNameForm("rename",id);return;}
    if(a==="duplicate"){listNameForm("duplicate",id);return;}
    if(a==="archive"){if(confirm("¿Finalizar esta lista y conservarla en el historial? Los productos pendientes seguirán en Faltantes."))await run(()=>repo.archivar(id,catalog),()=>{overlay.style.display="none";dialog=null;});return;}
    if(a==="discard"){
      await borrarProducto(id);
      return;
    }
    if(a==="restore"){await run(()=>repo.completar(id,false));return;}
    if(a==="up"||a==="down"){const listId=b.closest("[data-shopping-list]")?.dataset.shoppingList||"",list=lists.find(l=>l.id===listId);const ns=list?needs.filter(n=>(list.needIds||[]).includes(n.id)&&pendiente(n)):needs.filter(n=>pendiente(n)&&isLoose(n));await run(()=>repo.mover(list?.id,id,a==="up"?-1:1,ordered(ns,list).map(n=>n.id)));return;}
    if(a==="compare-all"||a==="compare-loose"){open("quote",`<h2>${a==="compare-all"?"Comparar todos los faltantes":"Comparar productos sueltos"}</h2>${quoteHtml(needs.filter(n=>pendiente(n)&&(a==="compare-all"||isLoose(n))))}`);return;}
    if(a==="history-list"){const l=lists.find(x=>x.id===id),snapshot=l?.snapshot;open("history",`<h2>${esc(l?.name)}</h2><p>Finalizada el ${date(l?.closedAt)}</p>${action("duplicate","Reutilizar esta lista",id,"btn-primary")}${rows(snapshot?.needs||[],"",true)}<p class="card-meta">Estimación de la lista al cerrar: ${snapshot?.estimate?.total!=null?money(snapshot.estimate.total):"Sin compra completa comparable"}. Se conserva el registro original para análisis.</p>`);return;}
    if(a==="receipt-confirm"){const selected=[...body.querySelectorAll('[name="receiptNeed"]:checked')].map(x=>matches.find(m=>m.need.id===x.value)).filter(Boolean);const r=receipt;await run(()=>repo.aplicarTicket(r,selected),()=>{overlay.style.display="none";dialog=null;receipt=null;matches=[];});processQueue();}
  }
  for(const element of [root,body])element.addEventListener("click",e=>{click(e).catch(err=>dialogError(err.message));});
  for(const element of [root,body]){
    element.addEventListener("input",e=>{if(!e.target.matches("[data-quick-entry]"))return;const key=e.target.dataset.quickEntry;entrada.setText(key,e.target.value);if(!e.isComposing&&e.target.value.includes("\n"))commitEditor(key);});
    element.addEventListener("keydown",e=>{if(!e.target.matches("[data-quick-entry]")||e.key!=="Enter"||e.isComposing)return;e.preventDefault();const input=e.target,key=input.dataset.quickEntry;input.setRangeText("\n",input.selectionStart,input.selectionEnd,"end");entrada.setText(key,input.value);commitEditor(key);});
  }
  for(const element of [root,body])element.addEventListener("change",e=>{
    if(e.target.matches("[data-quick-list]")){const key=e.target.dataset.quickList;quickSelections.set(key,[...body.querySelectorAll("[data-quick-list]:checked")].filter(x=>x.dataset.quickList===key).map(x=>x.value));}
    if(e.target.matches("[data-shopping-toggle]"))run(()=>repo.completar(e.target.dataset.shoppingToggle,e.target.checked));
    if(e.target.matches("[data-shopping-sort]")){sort=e.target.value;guardarPreferencias("listas",context,{sort,cards:cardPrefs});render();}
    if(e.target.matches("[data-shopping-loose]")){onlyLoose=e.target.checked;render();}
    if(e.target.matches("[data-shopping-date]")){shoppingDate=e.target.value||shoppingDate;if(dialog?.kind==="list")showList(dialog.id);else if(dialog?.kind==="quote")open("quote",`<h2>Comparar todos los faltantes</h2>${quoteHtml(needs.filter(pendiente))}`);}
  });
  body.addEventListener("submit",e=>{const form=e.target.closest("[data-shopping-form]");if(!form)return;e.preventDefault();const f=new FormData(form),d=Object.fromEntries(f.entries()),id=form.dataset.id||null;
    if(form.dataset.shoppingForm==="list-preferences"){
      if(!activeLists().some(l=>l.id===id)){dialogError("Esta lista ya no está activa.");return;}
      const cards={...cardPrefs,[id]:{color:d.color,pinned:f.has("pinned")}};
      if(!guardarPreferencias("listas",context,{sort,cards})){dialogError("Este navegador no pudo guardar tus preferencias.");return;}
      cardPrefs=cards;
      showList(id);render();return;
    }
    if(form.dataset.shoppingForm==="list-name"){const op=form.dataset.operation,returnKey=dialog?.returnKey;run(()=>op==="new"?repo.crearLista(d.name):op==="rename"?repo.renombrar(id,d.name):repo.duplicar(id,d.name),newId=>{if(newId)expanded.add(newId);if(returnKey&&newId){quickSelections.set(returnKey,[...(quickSelections.get(returnKey)||[]),newId]);quickForm("",returnKey);}else{overlay.style.display="none";dialog=null;mode="active";}});return;}
    if(form.dataset.shoppingForm==="need"){d.listIds=f.getAll("listIds");const product=catalog.find(p=>p.key===normalizar(d.name));if(!d.unit&&d.quantity)d.unit=product?.unit||"unidad";if(!d.category&&product)d.category=product.category;
      run(()=>guardarProducto(repo,d,id,d.newListName||""),result=>{if(result===false)return;if(detailedDraft&&entrada.state(detailedDraft.key).text===detailedDraft.text)entrada.setText(detailedDraft.key,"");detailedDraft=null;overlay.style.display="none";dialog=null;});}
    else{d.weekdays=f.getAll("weekdays").map(Number);d.disabled=f.has("disabled");run(()=>repo.guardarBeneficio(d,id),()=>{overlay.style.display="none";dialog=null;});}
  });
  fab.addEventListener("click",()=>{if(usable())quickForm();});
  document.getElementById("shoppingModalClose").addEventListener("click",()=>{if(dialog?.kind==="receipt"){receipt=null;matches=[];}close();});

  function processQueue(){if(dialog||removeDialog.open||duplicateDialog.open||busy||entrada.isSaving()||getData().busy||!usable()||!queue.length)return;const next=queue.shift();if(next.scope!==context.kind+"/"+context.id)return processQueue();
    const found=encontrarComprados(needs,next).filter(m=>!(m.need.receiptLinks||[]).some(l=>l.purchaseId===next.id));if(!found.length)return processQueue();receipt=next;matches=found;
    open("receipt",`<h2>¿Compraste estos productos?</h2><p>Encontramos coincidencias en el ticket de ${esc(next.storeName)}. Confirmá cuáles cubren tus faltantes.</p>${found.map(m=>`<label class="shopping-check shopping-receipt-row"><input name="receiptNeed" type="checkbox" value="${esc(m.need.id)}" ${m.score===1&&m.comparable?"checked":""}><span><strong>${esc(m.need.name)}</strong><br>${m.lines.map(l=>esc(l.name)).join(", ")}<br>${m.comparable?`${number(m.quantity)} ${esc(m.unit)}`:"Cantidad no comparable: tildalo solo si cubre todo el pendiente."}${m.score<1?" · Coincidencia aproximada: revisar":""}</span></label>`).join("")}${errorHtml}<div class="modal-actions">${action("receipt-confirm","Confirmar productos comprados","","btn-primary")}</div>`);
  }
  function cambiarEspacio(next){unsubs.forEach(f=>f());unsubs=[];entrada.reset();expanded=new Set();quickSelections=new Map();detailedDraft=null;context=next?{...next}:null;needs=[];lists=[];promos=[];catalog=[];queue=[];ready=new Set();error="";dialog=null;receipt=null;overlay.style.display="none";repo=null;
    if(duplicateDialog.open)duplicateDialog.close("");
    if(removeDialog.open)removeDialog.close("");
    recentNeeds.clear();
    const prefs=leerPreferencias("listas",context);
    sort=prefs.sort==="category"?"category":"manual";
    cardPrefs=prefs.cards&&typeof prefs.cards==="object"?prefs.cards:{};
    if(context){const scope={...context};repo=crearRepositorioListas(db,firestore,scope);
      for(const type of ["shopping_needs","shopping_lists","shopping_promotions"])unsubs.push(firestore.onSnapshot(repo.col(type),{includeMetadataChanges:true},snap=>{
        if(!scopeSame(scope))return;const data=snap.docs.map(d=>({id:d.id,...d.data()}));if(type==="shopping_needs"){
          needs=data;
          for(const n of needs)recentNeeds.delete(n.id);
        }else if(type==="shopping_lists")lists=data;else promos=data;
        if(!snap.metadata.fromCache)ready.add(type);render();
      },err=>{if(!scopeSame(scope))return;error="No se pudieron sincronizar las listas. Revisá tu conexión y el acceso a este espacio.";console.error(err);render();}));}
    render();
  }
  function actualizarCatalogo(){const d=getData();catalog=crearCatalogo(d.purchases,d.items);render();}
  function ticketGuardado(data){if(!context)return;queue.push({...data,scope:context.kind+"/"+context.id});setTimeout(processQueue,0);}
  return {cambiarEspacio,actualizarCatalogo,ticketGuardado,procesarPendientes:processQueue};
}
