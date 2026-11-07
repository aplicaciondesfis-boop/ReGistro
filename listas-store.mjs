import {validarNecesidad,claveNecesidad,aplicarCompra,cotizar} from "./compras.mjs?v=18";

export function crearRepositorioListas(db,api,scope) {
  const base=[scope.kind,scope.id], meta=()=>({updatedAt:api.serverTimestamp(),lastModifiedByUid:scope.uid});
  const col=tipo=>api.collection(db,...base,tipo);
  const ref=(tipo,id)=>id?api.doc(col(tipo),id):api.doc(col(tipo));
  const dato=s=>s.exists()?{id:s.id,...s.data()}:null;
  const nuevo=()=>({createdAt:api.serverTimestamp(),createdByUid:scope.uid,...meta()});
  const clean=n=>Object.fromEntries(["name","brand","category","note","quantity","unit","done","cancelled","fulfilled","receiptLinks"].map(k=>[k,n[k]??null]));
  function nombreLista(name){name=String(name||"").trim();if(!name||name.length>100)throw Error("Escribí un nombre de lista de hasta 100 caracteres.");return name;}

  async function guardarNecesidad(input,id=null,newListName="",reutilizar=false) {
    const data=validarNecesidad(input), keyRef=ref("shopping_keys",claveNecesidad(data)), generated=ref("shopping_needs");
    const nuevaLista=newListName.trim()?{ref:ref("shopping_lists"),name:nombreLista(newListName)}:null;
    if(nuevaLista)data.listIds.push(nuevaLista.ref.id);
    if(data.listIds.length>30)throw Error("Un producto puede estar en hasta 30 listas.");
    return api.runTransaction(db,async tx=>{
      const key=dato(await tx.get(keyRef));
      const needRef=id?ref("shopping_needs",id):key?.activeNeedId?ref("shopping_needs",key.activeNeedId):generated;
      const old=dato(await tx.get(needRef));
      if(id&&(!old||old.done||old.cancelled))throw Error("El faltante cambió. Cerrá la ventana y revisá su estado.");
      if(id&&key?.activeNeedId&&key.activeNeedId!==id)throw Error("Ya existe otro faltante con ese nombre y marca.");
      if(reutilizar&&claveNecesidad(old)!==claveNecesidad(data))throw Error("El producto sugerido cambió. Volvé a revisar los faltantes.");
      const merge=reutilizar||!id&&old&&!old.done&&!old.cancelled;
      const next=merge?{...clean(old),listIds:[...new Set([...(old.listIds||[]),...data.listIds])]}:{...data,done:false,cancelled:false,fulfilled:old?.fulfilled||0,receiptLinks:old?.receiptLinks||[]};
      if(next.listIds.length>30)throw Error("Un producto puede estar en hasta 30 listas.");
      const oldKey=old?ref("shopping_keys",claveNecesidad(old)):null;
      if(oldKey&&oldKey.id!==keyRef.id)await tx.get(oldKey);
      const ids=[...new Set([...(old?.listIds||[]),...next.listIds])];
      const lists=await Promise.all(ids.filter(x=>x!==nuevaLista?.ref.id).map(async x=>({ref:ref("shopping_lists",x),data:dato(await tx.get(ref("shopping_lists",x)))})));
      if(lists.some(l=>data.listIds.includes(l.ref.id)&&l.data?.status!=="active"))throw Error("Una de las listas ya está finalizada o no existe.");
      tx.set(needRef,{...next,order:old?.order??Date.now(),...(old?{}:nuevo()),...meta()},{merge:true});
      tx.set(keyRef,{activeNeedId:needRef.id,...meta()});
      if(oldKey&&oldKey.id!==keyRef.id)tx.set(oldKey,{activeNeedId:null,...meta()});
      for(const l of lists){if(l.data?.status!=="active")continue;let order=(l.data.needIds||[]).filter(x=>x!==needRef.id);if(next.listIds.includes(l.ref.id))order=(l.data.needIds||[]).includes(needRef.id)?l.data.needIds:[...order,needRef.id];tx.update(l.ref,{needIds:order,...meta()});}
      if(nuevaLista)tx.set(nuevaLista.ref,{name:nuevaLista.name,status:"active",needIds:[needRef.id],...nuevo()});
      return {id:needRef.id,merged:!!merge,need:{id:needRef.id,...next}};
    });
  }

  function usarNecesidad(need,listIds,newListName) {
    return guardarNecesidad({name:need.name,brand:need.brand,listIds},need.id,newListName,true);
  }

  async function completar(id,done,cancelled=false) {
    return api.runTransaction(db,async tx=>{
      const r=ref("shopping_needs",id), n=dato(await tx.get(r));if(!n)throw Error("El producto ya no existe.");
      const k=ref("shopping_keys",claveNecesidad(n)), key=dato(await tx.get(k));
      if(cancelled){
        if(n.done)throw Error("El producto ya se marcó como comprado.");
        if(n.cancelled)return;
        tx.update(r,{cancelled:true,...meta()});
        if(key?.activeNeedId===id)tx.set(k,{activeNeedId:null,...meta()});
        return;
      }
      if(!done&&key?.activeNeedId&&key.activeNeedId!==id)throw Error("Ya hay otro pendiente de este producto. Usá el pendiente actual.");
      if(n.cancelled){
        if(done)throw Error("El producto se borró de la lista. Podés recuperarlo desde Historial.");
        tx.update(r,{cancelled:false,...meta()});
        tx.set(k,{activeNeedId:id,...meta()});
        return;
      }
      tx.update(r,{done,cancelled:false,fulfilled:done?(n.quantity??1):0,receiptLinks:done?(n.receiptLinks||[]):[],completedAt:done?api.serverTimestamp():null,completionSource:done?"manual":null,...meta()});
      if(!done||key?.activeNeedId===id)tx.set(k,{activeNeedId:done?null:id,...meta()});
    });
  }

  async function crearLista(name) {
    const r=ref("shopping_lists");await api.setDoc(r,{name:nombreLista(name),status:"active",needIds:[],...nuevo()});return r.id;
  }
  async function renombrar(id,name){await api.updateDoc(ref("shopping_lists",id),{name:nombreLista(name),...meta()});}

  async function mover(listId,id,delta,ordered) {
    if(listId){return api.runTransaction(db,async tx=>{const r=ref("shopping_lists",listId),l=dato(await tx.get(r));if(l?.status!=="active")throw Error("La lista ya está finalizada.");const ids=[...(l.needIds||[])],visible=ordered.filter(x=>ids.includes(x)),index=visible.indexOf(id),other=visible[index+delta],a=ids.indexOf(id),b=ids.indexOf(other);if(index<0||a<0||b<0)return;[ids[a],ids[b]]=[ids[b],ids[a]];tx.update(r,{needIds:ids,...meta()});});}
    const index=ordered.indexOf(id),other=ordered[index+delta];if(!other)return;
    await api.runTransaction(db,async tx=>{const a=ref("shopping_needs",id),b=ref("shopping_needs",other),aa=dato(await tx.get(a)),bb=dato(await tx.get(b));if(!aa||!bb)return;tx.update(a,{order:bb.order,...meta()});tx.update(b,{order:aa.order,...meta()});});
  }

  async function archivar(id,catalog) {
    await api.runTransaction(db,async tx=>{
      const r=ref("shopping_lists",id),l=dato(await tx.get(r));if(l?.status!=="active")throw Error("La lista ya está finalizada.");
      const ns=(await Promise.all((l.needIds||[]).map(x=>tx.get(ref("shopping_needs",x))))).map(dato).filter(n=>n&&!n.cancelled);
      const quote=cotizar(ns.map(n=>({...n,done:false,fulfilled:0})),catalog);
      tx.update(r,{status:"completed",closedAt:api.serverTimestamp(),snapshot:{needs:ns.map(clean),estimate:{total:quote.best?.total??null,store:quote.best?.name??null,splitTotal:quote.splitTotal,known:quote.known,reference:quote.reference}},...meta()});
    });
  }

  async function duplicar(id,providedName) {
    const listRef=ref("shopping_lists"), name=nombreLista(providedName);
    await api.runTransaction(db,async tx=>{
      const original=dato(await tx.get(ref("shopping_lists",id)));if(!original)throw Error("La lista no existe.");
      const source=(original.snapshot?.needs||(await Promise.all((original.needIds||[]).map(x=>tx.get(ref("shopping_needs",x))))).map(dato)).filter(n=>n&&!n.cancelled);
      if(source.length>150)throw Error("Esta lista es muy grande para duplicarla de una vez (máximo 150 productos).");
      const keys=await Promise.all(source.map(async n=>({source:n,ref:ref("shopping_keys",claveNecesidad(n)),key:dato(await tx.get(ref("shopping_keys",claveNecesidad(n))))})));
      const targets=await Promise.all(keys.map(async k=>{const r=k.key?.activeNeedId?ref("shopping_needs",k.key.activeNeedId):ref("shopping_needs");return {...k,target:r,existing:k.key?.activeNeedId?dato(await tx.get(r)):null};}));
      const needIds=[];
      for(const t of targets){const live=t.existing&&!t.existing.done&&!t.existing.cancelled;const r=live?t.target:ref("shopping_needs");needIds.push(r.id);
        if(live)tx.update(r,{listIds:[...new Set([...(t.existing.listIds||[]),listRef.id])],...meta()});
        else tx.set(r,{...validarNecesidad(t.source),listIds:[listRef.id],done:false,cancelled:false,fulfilled:0,receiptLinks:[],order:Date.now()+needIds.length,...nuevo()});
        tx.set(t.ref,{activeNeedId:r.id,...meta()});}
      tx.set(listRef,{name,status:"active",needIds,...nuevo()});
    });return listRef.id;
  }

  async function aplicarTicket(receipt,matches) {
    await api.runTransaction(db,async tx=>{
      const records=await Promise.all(matches.map(async m=>({match:m,ref:ref("shopping_needs",m.need.id),need:dato(await tx.get(ref("shopping_needs",m.need.id)))})));
      for(const r of records)if(r.need)await tx.get(ref("shopping_keys",claveNecesidad(r.need)));
      for(const r of records){if(!r.need||r.need.done||r.need.cancelled)continue;const change=aplicarCompra(r.need,r.match,receipt);if(!change)continue;
        tx.update(r.ref,{...change,completionSource:"ticket",completedAt:change.done?api.serverTimestamp():null,...meta()});
        if(change.done)tx.set(ref("shopping_keys",claveNecesidad(r.need)),{activeNeedId:null,...meta()});}
    });
  }

  async function guardarBeneficio(d,id=null) {
    const store=String(d.store||"").trim(),name=String(d.name||"").trim();if(!store||!name)throw Error("Indicá el comercio y el beneficio.");
    const percent=d.percent===""||d.percent==null?null:Number(d.percent);if(percent!==null&&(!Number.isFinite(percent)||percent<0||percent>100))throw Error("El porcentaje debe estar entre 0 y 100.");
    const value={store:store.slice(0,120),name:name.slice(0,120),type:d.type==="cashback"?"cashback":"discount",percent,weekdays:(d.weekdays||[]).filter(x=>Number.isInteger(x)&&x>=0&&x<=6),paymentMethod:String(d.paymentMethod||"").slice(0,120),note:String(d.note||"").slice(0,500),disabled:!!d.disabled,...meta()};
    if(id)await api.updateDoc(ref("shopping_promotions",id),value);else await api.setDoc(ref("shopping_promotions"),{...value,...nuevo()});
  }
  return {col,guardarNecesidad,usarNecesidad,completar,crearLista,renombrar,mover,archivar,duplicar,aplicarTicket,guardarBeneficio};
}
