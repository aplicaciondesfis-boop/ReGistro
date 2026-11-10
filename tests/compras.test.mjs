import test from "node:test";
import assert from "node:assert/strict";
import {crearCatalogo,cotizar,encontrarComprados,aplicarCompra,promocionesAplicables,validarNecesidad} from "../compras.mjs";

const item=(id,purchaseId,name,lineTotal,presentationValue=1)=>({id,purchaseId,canonicalProductName:name,lineTotal,quantity:1,presentationValue,presentationUnit:"kg"});
const purchase=(id,storeName,date,totalPaid,cashbackAmount=0)=>({id,storeName,date,totalPaid,cashbackAmount,status:"confirmado"});

test("un pote registrado en kilos cotiza por unidad usando el contenido original",()=>{
  const c=crearCatalogo([purchase("p","Vea","2026-10-28",2889)],[{...item("i","p","Queso untable light",2889,.29),brand:"La Serenisima"}]);
  const q=cotizar([{name:"Queso untable",brand:"la serenisima",unit:"unidad",quantity:2}],c);
  assert.equal(q.known,1);
  assert.equal(q.lines[0].related,true);
  assert.equal(q.lines[0].best.pack.content,.29);
  assert.equal(Math.round(q.averageTotal),5778);
});

test("un precio de un producto parecido o de venta a granel es solo orientativo",()=>{
  const c=crearCatalogo([purchase("p","A","2026-10-28",2500)],[item("i","p","Repuesto de difusor",1500),item("j","p","Papa",1000)]);
  const q=cotizar([{name:"Difusor"},{name:"Papa",unit:"unidad",quantity:1}],c);
  assert.equal(q.lines[0].relatedOffer.name,"Repuesto de difusor");
  assert.equal(q.lines[1].relatedOffer.unit,"kg");
  assert.equal(q.known,0);
  assert.equal(q.averageTotal,0);
});

test("el presupuesto usa un kilo de referencia aunque la compra histórica sea medio kilo",()=>{
  const catalog=crearCatalogo([purchase("p","Tienda A","2026-11-01",5000)],[item("i","p","Queso",5000,.5)]);
  const q=cotizar([{name:"Queso",done:false}],catalog);
  assert.equal(q.lines[0].unit,"kg");assert.equal(q.lines[0].amount,1);assert.equal(q.best.total,10000);assert.equal(q.reference,true);
});
test("usa el último precio por comercio, sin descontar cashback",()=>{
  const c=crearCatalogo([purchase("a","Tienda A","2026-10-01",1000),purchase("b","Tienda A","2026-11-01",1200,240)], [item("a","a","Papa",1000),item("b","b","Papa",1200)]);
  assert.equal(c.length,1);assert.equal(c[0].price,1200);assert.equal(c[0].cashback,240);
});

test("el promedio toma un último precio por comercio y no descuenta reintegros",()=>{
  const c=crearCatalogo([
    purchase("a","Tienda A","2026-10-01",1000),
    purchase("b","Tienda A","2026-11-01",1200,240),
    purchase("c","Tienda B","2026-11-02",1800)
  ],[item("a","a","Papa",1000),item("b","b","Papa",1200),item("c","c","Papa",1800)]);
  const q=cotizar([{name:"Papa"}],c);
  assert.equal(q.lines[0].averagePrice,1500);
  assert.equal(q.lines[0].estimatedTotal,1500);
  assert.equal(q.averageTotal,1500);
  assert.equal(q.known,1);
});

test("el total promedio usa cantidades pendientes y conserva los precios faltantes como desconocidos",()=>{
  const c=[
    {key:"queso",unit:"kg",storeKey:"a",store:"A",price:10000,date:"2026-11-01"},
    {key:"queso",unit:"kg",storeKey:"b",store:"B",price:12000,date:"2026-11-01"},
    {key:"leche",unit:"l",storeKey:"a",store:"A",price:2000,date:"2026-11-01"}
  ];
  const q=cotizar([{name:"Queso",quantity:1,unit:"kg",fulfilled:.5},{name:"Leche"},{name:"Pan"},{name:"Queso",done:true}],c);
  assert.equal(q.lines[0].averagePrice,11000);
  assert.equal(q.lines[0].estimatedTotal,5500);
  assert.equal(q.lines[1].amount,1);
  assert.equal(q.lines[2].averagePrice,null);
  assert.equal(q.lines[2].estimatedTotal,null);
  assert.equal(q.averageTotal,7500);
  assert.equal(q.known,2);
  assert.equal(q.lines.length,3);
});
test("prorratea descuentos generales y combina líneas del mismo producto en un ticket",()=>{
  const c=crearCatalogo([purchase("p","Tienda","2026-11-01",800)], [item("a","p","Papa",1000),item("b","p","Papa",0)]);
  assert.equal(c[0].price,400);
});
test("recomienda por suma y cantidades; el detalle conserva las alternativas por producto",()=>{
  const c=[{key:"papa",name:"Papa",unit:"kg",storeKey:"a",store:"A",price:100,date:"2026-11-01"},{key:"papa",name:"Papa",unit:"kg",storeKey:"b",store:"B",price:120,date:"2026-11-01"},
  {key:"queso",name:"Queso",unit:"kg",storeKey:"a",store:"A",price:10000,date:"2026-11-01"},{key:"queso",name:"Queso",unit:"kg",storeKey:"b",store:"B",price:5000,date:"2026-11-01"}];
  const q=cotizar([{name:"Papa",quantity:10,unit:"kg"},{name:"Queso",quantity:1,unit:"kg"}],c);
  assert.equal(q.best.name,"B");assert.equal(q.best.total,6200);assert.equal(q.splitTotal,6000);assert.equal(q.lines[0].best.store,"A");
});
test("los precios faltantes no se cuentan como cero ni producen una recomendación completa",()=>{
  const c=[{key:"papa",name:"Papa",unit:"kg",storeKey:"a",store:"A",price:100,date:"2026-11-01"}];
  const q=cotizar([{name:"Papa"},{name:"Leche"}],c);assert.equal(q.best,null);assert.equal(q.known,1);assert.equal(q.stores[0].covered,1);assert.equal(q.stores[0].complete,false);
});
test("no mezcla marcas solicitadas ni unidades incompatibles",()=>{
  const c=[{key:"queso",unit:"kg",brand:"A",storeKey:"a",store:"A",price:100,date:"2026-11-01"},{key:"queso",unit:"unidad",brand:"B",storeKey:"b",store:"B",price:1,date:"2026-11-01"}];
  assert.equal(cotizar([{name:"Queso"}],c).known,0);assert.equal(cotizar([{name:"Queso",brand:"A"}],c).best.total,100);
});
test("los tickets antiguos no completan faltantes creados después",()=>{
  const needs=[{id:"n",name:"Papa",createdAt:new Date("2026-11-03T09:00:00")}];
  assert.equal(encontrarComprados(needs,{date:new Date("2026-10-31"),items:[item("i","p","Papa",1000)]}).length,0);
});
test("detecta compras parciales y no aplica dos veces el mismo ticket",()=>{
  const need={id:"n",name:"Papa",quantity:2,unit:"kg",fulfilled:0,receiptLinks:[]};const receipt={id:"p",date:new Date(),items:[item("i","p","Papa",1000,.5)]};
  const match=encontrarComprados([need],receipt)[0];const next=aplicarCompra(need,match,receipt);assert.equal(next.done,false);assert.equal(next.fulfilled,.5);
  assert.equal(aplicarCompra({...need,...next},match,receipt),null);
});
test("una línea no se reparte doble entre un faltante genérico y uno de marca",()=>{
  const receipt={date:new Date(),items:[{...item("i","p","Papa",1000),brand:"Marca A"}]};
  const found=encontrarComprados([{id:"a",name:"Papa"},{id:"b",name:"Papa",brand:"Marca A"}],receipt);
  assert.equal(found.length,1);assert.equal(found[0].need.id,"b");
});
test("un producto sin cantidad se completa tras confirmarlo y los beneficios se filtran por día",()=>{
  assert.equal(aplicarCompra({receiptLinks:[]},{comparable:true,quantity:.5,unit:"kg",lines:[{id:"i"}]},{id:"p"}).done,true);
  const promos=[{store:"Tienda",weekdays:[2],percent:20},{store:"Otra",weekdays:[]}];
  assert.equal(promocionesAplicables(promos,new Date("2026-11-03T12:00:00"),["Tienda"]).length,1);
  assert.equal(promocionesAplicables(promos,new Date("2026-11-04T12:00:00"),["Tienda"]).length,0);
});
test("los detalles son opcionales y las cantidades en gramos se guardan en kilos",()=>{
  assert.equal(validarNecesidad({name:"Queso"}).quantity,null);assert.equal(validarNecesidad({name:"Queso",quantity:500,unit:"g"}).quantity,.5);
  assert.throws(()=>validarNecesidad({name:"Queso",quantity:-1}));
});
