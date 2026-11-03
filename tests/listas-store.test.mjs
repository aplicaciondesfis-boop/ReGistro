import test from "node:test";
import assert from "node:assert/strict";
import {crearRepositorioListas} from "../listas-store.mjs";

function memoria(){const data=new Map();let id=0,tail=Promise.resolve();
  const api={collection:(_db,...parts)=>({path:parts.join("/")}),doc:(c,name)=>({path:c.path+"/"+(name||"id"+(++id)),id:name||"id"+id}),serverTimestamp:()=>new Date("2026-11-03T12:00:00Z"),
    setDoc:async(r,d)=>data.set(r.path,structuredClone(d)),updateDoc:async(r,d)=>{if(!data.has(r.path))throw Error("missing");data.set(r.path,{...data.get(r.path),...structuredClone(d)});},
    runTransaction:(_db,fn)=>{const task=tail.then(async()=>{let wrote=false;const writes=[];const tx={get:async r=>{assert.equal(wrote,false,"Firestore exige todas las lecturas antes de escribir");const d=data.get(r.path);return{id:r.id,exists:()=>!!d,data:()=>structuredClone(d)};},set:(r,d,o)=>{wrote=true;writes.push([r,d,o?.merge]);},update:(r,d)=>{wrote=true;if(!data.has(r.path))throw Error("missing");writes.push([r,d,true]);}};const result=await fn(tx);for(const [r,d,merge]of writes)data.set(r.path,{...(merge?data.get(r.path):{}),...structuredClone(d)});return result;});tail=task.catch(()=>{});return task;}};
  const repo=crearRepositorioListas({},api,{kind:"households",id:"h",uid:"usuario"});return{repo,api,data,records:type=>[...data].filter(([p])=>p.startsWith("households/h/"+type+"/")).map(([path,d])=>({id:path.split("/").at(-1),...d}))};}

test("un faltante compartido se completa en todas las listas y se conserva para historial",async()=>{
  const m=memoria(),a=await m.repo.crearLista("Mensual"),b=await m.repo.crearLista("Limpieza");
  const n=await m.repo.guardarNecesidad({name:"Aceite",listIds:[a,b]});await m.repo.completar(n.id,true);
  assert.equal(m.records("shopping_needs").length,1);assert.equal(m.records("shopping_needs")[0].done,true);
  for(const l of m.records("shopping_lists"))assert.deepEqual(l.needIds,[n.id]);
});
test("dos altas concurrentes reutilizan el mismo pendiente y unen sus listas",async()=>{
  const m=memoria(),a=await m.repo.crearLista("A"),b=await m.repo.crearLista("B");
  const r=await Promise.all([m.repo.guardarNecesidad({name:"Aceite",listIds:[a]}),m.repo.guardarNecesidad({name:"ACEITE",listIds:[b]})]);
  assert.equal(r[0].id,r[1].id);assert.equal(m.records("shopping_needs").length,1);assert.equal(m.records("shopping_needs")[0].listIds.length,2);
});
test("crear lista durante la carga guarda ambos documentos y editar mantiene la referencia",async()=>{
  const m=memoria();const n=await m.repo.guardarNecesidad({name:"Papa"},null,"Verdulería");const l=m.records("shopping_lists")[0];assert.equal(l.name,"Verdulería");
  await m.repo.guardarNecesidad({name:"Papa negra",listIds:[l.id]},n.id);assert.equal(m.records("shopping_needs")[0].name,"Papa negra");assert.deepEqual(m.records("shopping_lists")[0].needIds,[n.id]);
});
test("el historial conserva su foto de la lista y reutilizar crea una planificación pendiente",async()=>{
  const m=memoria(),l=await m.repo.crearLista("Mes 1"),n=await m.repo.guardarNecesidad({name:"Papa",listIds:[l]});await m.repo.completar(n.id,true);await m.repo.archivar(l,[]);
  const before=structuredClone(m.records("shopping_lists")[0].snapshot);await m.repo.duplicar(l,"Mes 2");
  assert.deepEqual(m.records("shopping_lists")[0].snapshot,before);assert.equal(m.records("shopping_needs").filter(n=>!n.done).length,1);assert.equal(m.records("shopping_needs").filter(n=>n.done).length,1);
});
test("reutilizar una lista enlaza un pendiente que ya existe sin perder su cantidad",async()=>{
  const m=memoria(),l=await m.repo.crearLista("A"),n=await m.repo.guardarNecesidad({name:"Papa",quantity:2,unit:"kg",listIds:[l]});await m.repo.duplicar(l,"B");
  assert.equal(m.records("shopping_needs").length,1);assert.equal(m.records("shopping_needs")[0].quantity,2);assert.equal(m.records("shopping_needs")[0].listIds.length,2);
});
test("las compras parciales enlazadas no duplican cantidades al procesar de nuevo un ticket",async()=>{
  const m=memoria(),n=await m.repo.guardarNecesidad({name:"Papa",quantity:2,unit:"kg"});const match={need:{id:n.id},quantity:.5,unit:"kg",comparable:true,lines:[{id:"linea"}]};
  await m.repo.aplicarTicket({id:"p"},[match]);await m.repo.aplicarTicket({id:"p"},[match]);assert.equal(m.records("shopping_needs")[0].fulfilled,.5);
  await m.repo.aplicarTicket({id:"p2"},[{...match,quantity:1.5}]);assert.equal(m.records("shopping_needs")[0].done,true);
});
test("descartar es reversible",async()=>{
  const m=memoria(),n=await m.repo.guardarNecesidad({name:"Papa"});await m.repo.completar(n.id,false,true);assert.equal(m.records("shopping_needs")[0].cancelled,true);await m.repo.completar(n.id,false);assert.equal(m.records("shopping_needs")[0].cancelled,false);
});
test("las mismas necesidades personales se guardan separadas por propietario y del hogar",async()=>{
  const m=memoria();
  const a=crearRepositorioListas({},m.api,{kind:"users",id:"ana",uid:"ana"});
  const b=crearRepositorioListas({},m.api,{kind:"users",id:"bea",uid:"bea"});
  await a.guardarNecesidad({name:"Papa"});await b.guardarNecesidad({name:"Papa"});
  assert.equal([...m.data.keys()].filter(p=>p.startsWith("users/ana/shopping_needs/")).length,1);
  assert.equal([...m.data.keys()].filter(p=>p.startsWith("users/bea/shopping_needs/")).length,1);
  assert.equal(m.records("shopping_needs").length,0);
});
test("no se puede modificar la membresía de una lista finalizada desde el formulario",async()=>{
  const m=memoria(),l=await m.repo.crearLista("A");await m.repo.archivar(l,[]);await assert.rejects(m.repo.guardarNecesidad({name:"Papa",listIds:[l]}));assert.equal(m.records("shopping_needs").length,0);
});
