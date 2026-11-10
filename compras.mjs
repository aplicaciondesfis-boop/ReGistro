import {identificarProducto,coincidenciaProducto} from "./identidad-productos.mjs?v=18";

export const normalizar = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const claveNecesidad = n => encodeURIComponent(normalizar(n.name) + "|" + normalizar(n.brand)).replace(/%/g, "_");
export const fechaDato = valor => valor?.toDate ? valor.toDate() : valor instanceof Date ? valor : valor ? new Date(valor) : null;
export const unidadBase = u => ({g:"kg",kg:"kg",ml:"l",l:"l",unidad:"unidad"}[u] || "unidad");
export const factorUnidad = u => ["g","ml"].includes(u) ? .001 : 1;
export const pendiente = n => !n.done && !n.cancelled;

export function validarNecesidad(d) {
  const name = String(d.name || "").trim();
  if (!name || name.length > 120 || !normalizar(name)) throw Error("Escribí un nombre de hasta 120 caracteres, con letras o números.");
  const quantity = d.quantity === "" || d.quantity == null ? null : Number(String(d.quantity).replace(",", "."));
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000)) throw Error("La cantidad debe ser mayor que cero.");
  if (d.unit && !["g","kg","ml","l","unidad"].includes(d.unit)) throw Error("Elegí una unidad válida.");
  return { name, brand:String(d.brand||"").trim().slice(0,100), note:String(d.note||"").trim().slice(0,500), category:String(d.category||"Sin detalle"),
    quantity:quantity === null ? null : quantity * factorUnidad(d.unit), unit:d.unit ? unidadBase(d.unit) : "", listIds:[...new Set(d.listIds || [])] };
}

// El precio de caja distribuye descuentos generales pendientes entre las líneas.
// Los reintegros se conservan como información aparte, nunca se descuentan aquí.
export function crearCatalogo(purchases, items) {
  const compras = new Map(purchases.map(p => [p.id,p]));
  const sumas = new Map();
  items.forEach(i => sumas.set(i.purchaseId,(sumas.get(i.purchaseId)||0)+Number(i.lineTotal||0)));
  const precios = new Map(), agrupados = new Map();
  for (const i of items) {
    const p = compras.get(i.purchaseId);
    if (!p || p.status === "a_revisar" || i.isDoubtful) continue;
    const nombre = i.canonicalProductName || i.rawDescription;
    const identity = identificarProducto(nombre);
    const key = identity.key, storeKey = normalizar(p.storeName);
    if (!key || key === "sin detalle" || !storeKey) continue;
    const suma = sumas.get(p.id), factor = suma > Number(p.totalPaid)+.02 && p.totalPaid > 0 ? p.totalPaid/suma : 1;
    const quantity=Number(i.quantity||1);
    const content=Number(i.presentationValue||1)*factorUnidad(i.presentationUnit);
    const units=quantity*content;
    const cost=Number(i.lineTotal)*factor;
    if(!(units>0)||!Number.isFinite(units)||cost<0||!Number.isFinite(cost))continue;
    const date = fechaDato(p.date) || fechaDato(p.createdAt);
    if (!date || !Number.isFinite(+date)) continue;
    const unit=unidadBase(i.presentationUnit);
    const pack=unit!=="unidad"&&content!==1&&Number.isInteger(quantity)?{content,unit}:null;
    const record = { name:identity.nombre, key, brand:i.brand||"", category:i.category||"Sin detalle", unit, pack, store:p.storeName, storeKey,
      price:0, date:date.toISOString(), purchaseId:p.id, itemId:i.id||"", cashback:Number(p.cashbackAmount)||0, paymentMethod:p.paymentMethod||"" };
    const pk = [key,normalizar(i.brand),record.unit,storeKey].join("|");
    const ticketKey=p.id+"|"+pk, group=agrupados.get(ticketKey)||{record,pk,cost:0,units:0};
    if(group.record.pack?.content!==pack?.content)group.record.pack=null;
    group.cost+=cost;group.units+=units;agrupados.set(ticketKey,group);
  }
  for(const {record,pk,cost,units} of agrupados.values()){record.price=cost/units;if(record.price>0&&(!precios.has(pk)||record.date>precios.get(pk).date))precios.set(pk,record);}
  return [...precios.values()];
}

function buscarReferencia(need, catalog) {
  const requested=identificarProducto(need.name);
  const candidates=catalog.filter(offer=>{
    const name=offer.name||offer.key;
    if(coincidenciaProducto(need.name,name)>0)return true;
    const other=identificarProducto(name);
    if(requested.familia&&requested.familia===other.familia)return false;
    // Una variedad o un repuesto pueden orientar. Una mención dentro de un
    // ingrediente no identifica el producto que se está buscando.
    return requested.key.length>=4&&(other.key.startsWith(`${requested.key} `)||other.key===`repuesto de ${requested.key}`);
  });
  return candidates.sort((a,b)=>coincidenciaProducto(need.name,b.name||b.key)-coincidenciaProducto(need.name,a.name||a.key)||String(b.date||"").localeCompare(a.date||""))[0]||null;
}

export function cotizar(needs,catalog) {
  const lines = needs.filter(pendiente).map(need => {
    const brand=normalizar(need.brand);
    const conMarca=catalog.filter(p=>!brand||normalizar(p.brand)===brand);
    const posibles=conMarca.filter(p=>coincidenciaProducto(need.name,p.name||p.key)>0);
    const unidades = [...new Set(posibles.map(p=>p.unit))];
    const unit = need.unit || (unidades.length === 1 ? unidades[0] : "");
    const porTienda = new Map();
    for(const p of posibles){
      const offer=p.unit===unit?p:unit==="unidad"&&p.pack?{...p,unit,price:p.price*p.pack.content}:null;
      if(offer&&(!porTienda.has(p.storeKey)||p.date>porTienda.get(p.storeKey).date))porTienda.set(p.storeKey,offer);
    }
    const offers = [...porTienda.values()].sort((a,b)=>a.price-b.price);
    const amount = need.quantity == null ? 1 : Math.max(0,need.quantity-Number(need.fulfilled||0));
    const averagePrice = offers.length ? offers.reduce((total, offer)=>total+offer.price,0)/offers.length : null;
    const related=offers.some(p=>coincidenciaProducto(need.name,p.name||p.key)<1);
    return { need, unit, amount, reference:need.quantity==null, offers, best:offers[0]||null, related,
      relatedOffer:offers.length?null:buscarReferencia(need,conMarca),
      averagePrice, estimatedTotal:averagePrice==null?null:averagePrice*amount };
  });
  const keys = [...new Set(lines.flatMap(l=>l.offers.map(p=>p.storeKey)))];
  const stores = keys.map(key=>{
    const offers=lines.map(l=>l.offers.find(p=>p.storeKey===key));
    return {key,name:offers.find(Boolean).store,covered:offers.filter(Boolean).length,total:offers.reduce((s,p,i)=>s+(p?p.price*lines[i].amount:0),0),complete:offers.every(Boolean)};
  });
  const complete=stores.filter(s=>s.complete).sort((a,b)=>a.total-b.total);
  return {lines,stores:stores.sort((a,b)=>b.covered-a.covered||a.total-b.total),best:complete[0]||null,
    splitTotal:lines.reduce((s,l)=>s+(l.best?l.best.price*l.amount:0),0),known:lines.filter(l=>l.best).length,reference:lines.some(l=>l.reference),
    averageTotal:lines.reduce((total,line)=>total+(line.estimatedTotal??0),0)};
}

function semejanza(a,b) {
  const coincidence = coincidenciaProducto(a,b);
  if(coincidence)return coincidence;
  const requested = identificarProducto(a), purchased = identificarProducto(b);
  if(requested.familia && requested.familia === purchased.familia)return 0;
  a=normalizar(a);b=normalizar(b);
  if(a===b)return 1;
  const tokens=s=>s.split(" ").filter(x=>x.length>2).map(x=>x.endsWith("s")?x.slice(0,-1):x);
  const aa=tokens(a),bb=tokens(b);if(!aa.length||!bb.length)return 0;
  return aa.filter(x=>bb.includes(x)).length/Math.max(aa.length,bb.length);
}

// Cada línea del ticket se asigna a un único faltante, con preferencia por marca.
export function encontrarComprados(needs,receipt) {
  const fecha=fechaDato(receipt.date)||new Date(), dia=new Date(fecha.getFullYear(),fecha.getMonth(),fecha.getDate());
  const candidatos=needs.filter(n=>pendiente(n)&&(!fechaDato(n.createdAt)||fechaDato(n.createdAt)<new Date(+dia+86400000)));
  const grupos=new Map();
  receipt.items.forEach((item,index)=>{
    const elecciones=candidatos.map(n=>({need:n,score:semejanza(n.name,item.canonicalProductName||item.rawDescription)}))
      .filter(x=>x.score>=.65&&(!x.need.brand||normalizar(item.brand||item.rawDescription).includes(normalizar(x.need.brand))))
      .sort((a,b)=>b.score-a.score||Number(!!b.need.brand)-Number(!!a.need.brand));
    if(!elecciones.length)return;
    const {need,score}=elecciones[0], unit=unidadBase(item.presentationUnit);
    const g=grupos.get(need.id)||{need,score:1,quantity:0,unit,lines:[],comparable:true};
    g.score=Math.min(g.score,score);g.comparable=g.comparable&&g.unit===unit&&(!need.unit||need.unit===unit);
    g.quantity+=Number(item.quantity||1)*Number(item.presentationValue||1)*factorUnidad(item.presentationUnit);
    g.lines.push({id:item.id||String(index),name:item.rawDescription||item.canonicalProductName});grupos.set(need.id,g);
  });
  return [...grupos.values()];
}

export function aplicarCompra(need,match,receipt) {
  if ((need.receiptLinks||[]).some(l=>l.purchaseId===receipt.id)) return null;
  const fulfilled=Number(need.fulfilled||0)+(match.comparable?match.quantity:0);
  const done=need.quantity==null||!match.comparable||fulfilled+1e-6>=need.quantity;
  return {done,fulfilled:need.quantity==null?1:Math.min(need.quantity,done?need.quantity:fulfilled),
    receiptLinks:[...(need.receiptLinks||[]),{purchaseId:receipt.id,itemIds:match.lines.map(l=>l.id),quantity:match.quantity,unit:match.unit}]};
}

export function promocionesAplicables(promotions,date,stores) {
  const d=fechaDato(date)||new Date();
  return promotions.filter(p=>!p.disabled&&stores.some(s=>normalizar(s)===normalizar(p.store))&&(!p.weekdays?.length||p.weekdays.includes(d.getDay())));
}
