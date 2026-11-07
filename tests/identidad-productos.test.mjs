import test from "node:test";
import assert from "node:assert/strict";
import {identificarProducto,coincidenciaProducto} from "../identidad-productos.mjs";
import {crearCatalogo,cotizar,encontrarComprados,claveNecesidad} from "../compras.mjs";
import {posiblesDuplicados} from "../listas-entrada.mjs";
import {crearApp} from "./app-fixture.mjs";

test("agrupa las harinas comunes acordadas y distingue las otras variedades",()=>{
  for(const name of ["Harina 000","HARINA 0000","Harina 0000 con vitaminas","Harina de trigo 0000"]){
    assert.equal(identificarProducto(name).nombre,"Harina común");
  }
  const names=["Harina común","Harina leudante","Harina con fibra","Harina integral","Harina con levadura (pizza)"];
  assert.equal(new Set(names.map(name=>identificarProducto(name).key)).size,5);
  assert.equal(coincidenciaProducto("Harina para pizza","Harina con levadura"),1);
  assert.equal(coincidenciaProducto("Harina integral","Harina con fibra"),0);
  assert.equal(claveNecesidad({name:"Harina 0000"}),"harina_200000_7C");
});

test("las compras anteriores alimentan el presupuesto por equivalencia y respetan marca y unidad",()=>{
  const purchases=[{id:"a",storeName:"A",date:"2026-10-01",totalPaid:1000},{id:"b",storeName:"B",date:"2026-11-01",totalPaid:1400}];
  const items=purchases.map((p,index)=>({id:p.id,purchaseId:p.id,canonicalProductName:index?"Harina 0000 con vitaminas":"Harina 000",brand:index?"Dos":"Una",quantity:1,presentationValue:1,presentationUnit:"kg",lineTotal:p.totalPaid}));
  const original=structuredClone(items);
  const catalog=crearCatalogo(purchases,items);
  const q=cotizar([{name:"Harina 0000"}],catalog);
  assert.equal(q.known,1);
  assert.equal(q.lines[0].averagePrice,1200);
  assert.equal(cotizar([{name:"Harina común",brand:"Dos"}],catalog).lines[0].averagePrice,1400);
  assert.equal(cotizar([{name:"Harina integral"}],catalog).known,0);
  assert.equal(cotizar([{name:"Harina común",unit:"l"}],catalog).known,0);
  assert.deepEqual(items,original);
});

test("los genéricos admiten variedades y los pedidos específicos mantienen su variedad",()=>{
  assert.equal(coincidenciaProducto("Fideos","Fideos mostachol"),.9);
  assert.equal(coincidenciaProducto("Fideos mostachol","Fideos tirabuzón tricolor"),0);
  assert.equal(coincidenciaProducto("Queso untable","Queso untable light"),.9);
  assert.equal(coincidenciaProducto("Queso untable light","Queso untable entero"),0);
  assert.equal(coincidenciaProducto("Jabón","Jabón de ropa"),0);
  const receipt={date:new Date(),items:[{id:"i",canonicalProductName:"Fideos mostachol",quantity:1,presentationValue:.5,presentationUnit:"kg"}]};
  const found=encontrarComprados([{id:"generico",name:"Fideos"},{id:"especifico",name:"Fideos mostachol"}],receipt);
  assert.equal(found.length,1);
  assert.equal(found[0].need.id,"especifico");
  assert.equal(encontrarComprados([{id:"integral",name:"Harina integral"}],{...receipt,items:[{...receipt.items[0],canonicalProductName:"Harina con fibra"}]}).length,0);
  assert.equal(posiblesDuplicados({name:"Harina 000"},[{id:"n",name:"Harina 0000 con vitaminas"}]).length,1);
});

test("el comparador agrupa equivalencias conservando las descripciones históricas",()=>{
  const app=crearApp();
  app.ejecutar(`purchaseItems=[
    {id:"a",canonicalProductName:"Harina 0000",presentationUnit:"kg",lineTotal:1000},
    {id:"b",canonicalProductName:"Harina 0000 con vitaminas",presentationUnit:"kg",lineTotal:1200},
    {id:"c",canonicalProductName:"Harina integral",presentationUnit:"kg",lineTotal:1400},
    {id:"d",canonicalProductName:"Harina con fibra",presentationUnit:"kg",lineTotal:1300}
  ];`);
  assert.equal(app.ejecutar("agruparProductos().length"),3);
  assert.equal(app.ejecutar('agruparProductos().find(g=>g.nombre==="Harina común").items.length'),2);
  assert.equal(app.ejecutar('purchaseItems[1].canonicalProductName'),"Harina 0000 con vitaminas");
});
