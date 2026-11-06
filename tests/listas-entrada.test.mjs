import test from "node:test";
import assert from "node:assert/strict";
import {separarProductos,crearEntradaRapida,posiblesDuplicados} from "../listas-entrada.mjs";

test("avisa sobre un nombre genérico y conserva variantes y marcas distintas",()=>{
  const needs=[{name:"Aceite de girasol",brand:"Marca A"},{name:"Aceite de oliva",brand:"Marca B"},{name:"Aceite de maíz",done:true},{name:"Aceite de coco",cancelled:true}];
  assert.deepEqual(posiblesDuplicados({name:"ACEÍTES"},needs),needs.slice(0,2));
  assert.deepEqual(posiblesDuplicados({name:"Aceite",brand:"Marca B"},needs),[needs[1]]);
  assert.deepEqual(posiblesDuplicados({name:"Aceite de oliva",brand:"Marca B"},needs),[]);
  assert.deepEqual(posiblesDuplicados({name:"Aceite de lino"},needs),[]);
});

test("omitir una sugerencia conserva el resto del pegado y cuenta solo lo guardado",async()=>{
  const scope={},saved=[];
  const entrada=crearEntradaRapida({getScope:()=>scope,guardar:name=>name==="Aceite"?false:saved.push(name)});
  entrada.setText("a","Aceite\nPan\nLeche");
  assert.equal(await entrada.commit("a"),true);
  assert.deepEqual(saved,["Pan"]);
  assert.equal(entrada.state("a").saved,1);
  assert.equal(entrada.state("a").text,"Leche");
  assert.equal(entrada.isSaving(),false);
});

test("separar renglones conserva el último borrador y limpia listas pegadas sin duplicarlas",()=>{
  assert.deepEqual(separarProductos("• Leche\r\n- Pan\n1. LECHÉ\nHue"),{names:["Leche","Pan"],rest:"Hue"});
  assert.deepEqual(separarProductos("Leche\nPan",true),{names:["Leche","Pan"],rest:""});
  assert.throws(()=>separarProductos("Pan\n!!!\n"));
});
test("seguir escribiendo durante un guardado conserva el texto y las listas de cada envío",async()=>{
  const scope={},saved=[];let release;
  const entrada=crearEntradaRapida({getScope:()=>scope,guardar:async(name,opts)=>{if(name==="Pan")await new Promise(r=>release=r);saved.push({name,...opts});}});
  entrada.setText("a","Pan\n");const first=entrada.commit("a",{options:{listIds:["mensual"]}});
  entrada.setText("a","Leche\nHuevos");const second=entrada.commit("a",{options:{listIds:["otra"]}});
  assert.equal(entrada.state("a").text,"Huevos");release();await Promise.all([first,second]);
  assert.deepEqual(saved,[{name:"Pan",listIds:["mensual"]},{name:"Leche",listIds:["otra"]}]);assert.equal(entrada.state("a").text,"Huevos");assert.equal(entrada.isSaving(),false);
});
test("si falla una alta se conservan solo los renglones pendientes y el nuevo borrador",async()=>{
  const scope={},saved=[];let fail=true;
  const entrada=crearEntradaRapida({getScope:()=>scope,guardar:async name=>{if(name==="Pan"&&fail)throw Error("Sin conexión");saved.push(name);}});
  entrada.setText("a","Leche\nPan\nHuevos");await entrada.commit("a",{all:true});
  assert.deepEqual(saved,["Leche"]);assert.equal(entrada.state("a").text,"Pan\nHuevos");assert.equal(entrada.state("a").error,"Sin conexión");assert.equal(entrada.isSaving(),false);
  fail=false;await entrada.commit("a",{all:true});assert.deepEqual(saved,["Leche","Pan","Huevos"]);assert.equal(entrada.state("a").text,"");
});
test("una línea inválida no guarda las anteriores ni borra el texto",async()=>{
  const scope={},saved=[],entrada=crearEntradaRapida({getScope:()=>scope,guardar:async name=>saved.push(name)});
  const text="Leche\n"+"a".repeat(121);entrada.setText("a",text);assert.equal(await entrada.commit("a",{all:true}),false);
  assert.deepEqual(saved,[]);assert.equal(entrada.state("a").text,text);
});
test("cambiar de hogar cancela los renglones aún no enviados sin mezclarlos con el nuevo espacio",async()=>{
  let scope={id:"a"},release;const saved=[];
  const entrada=crearEntradaRapida({getScope:()=>scope,guardar:async(name,_opts,target)=>{await new Promise(r=>release=r);saved.push([target.id,name]);}});
  entrada.setText("a","Leche\nPan");const pending=entrada.commit("a",{all:true});scope={id:"b"};entrada.reset();release();await pending;
  assert.deepEqual(saved,[["a","Leche"]]);assert.equal(entrada.state("a").text,"");assert.equal(entrada.isSaving(),false);
});
