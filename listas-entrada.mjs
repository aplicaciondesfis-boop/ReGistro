import {claveNecesidad,normalizar,pendiente,validarNecesidad} from "./compras.mjs?v=20";
import {coincidenciaProducto,identificarProducto} from "./identidad-productos.mjs?v=18";

export function posiblesDuplicados(input, needs) {
  const brand = normalizar(input.brand), key = claveNecesidad(input);
  const activos = needs.filter(pendiente);
  // La misma clave ya se reutiliza al guardar. El aviso cubre nombres o marcas distintos.
  if (activos.some(n => claveNecesidad(n) === key)) return [];

  const words = name => normalizar(name).split(" ").map(word => word.replace(/([a-z]{4,})s$/, "$1"));
  const requested = words(input.name);
  return activos.filter(n => {
    const otherBrand = normalizar(n.brand);
    if (brand && otherBrand && brand !== otherBrand) return false;
    if(coincidenciaProducto(input.name,n.name)||coincidenciaProducto(n.name,input.name))return true;
    const a=identificarProducto(input.name),b=identificarProducto(n.name);
    if(a.familia&&a.familia===b.familia)return false;
    const existing = words(n.name);
    const [short, long] = requested.length <= existing.length ? [requested, existing] : [existing, requested];
    return short[0].length >= 3 && short.every((word, index) => word === long[index]);
  });
}

export function separarProductos(text,all=false) {
  const lines=String(text||"").replace(/\r\n?/g,"\n").split("\n"),rest=all?"":lines.pop();
  const names=[],seen=new Set();
  for(const line of lines){
    const name=line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/,"").trim();
    if(!name)continue;
    validarNecesidad({name});
    const key=normalizar(name);if(!seen.has(key)){seen.add(key);names.push(name);}
  }
  return {names,rest};
}

// Conserva el borrador mientras llegan cambios del servidor y serializa las altas.
// Un fallo devuelve solo los renglones que todavía no se pudieron guardar.
export function crearEntradaRapida({getScope,guardar,onChange=()=>{}}) {
  let states=new Map(),jobs=[],running=false,generation=0;
  const state=key=>{if(!states.has(key))states.set(key,{text:"",pending:0,saved:0,error:""});return states.get(key);};
  async function drain(){
    if(running)return;running=true;
    try{while(jobs.length){
      const job=jobs.shift(),s=job.state;
      if(job.generation!==generation||job.scope!==getScope()){job.resolve(false);continue;}
      let index=0;
      try{
        for(;index<job.names.length;index++){
          if(job.generation!==generation||job.scope!==getScope())break;
          const saved = await guardar(job.names[index],job.options,job.scope);
          if(job.generation!==generation)break;
          s.pending--;
          if(saved!==false)s.saved++;
          onChange();
        }
        job.resolve(index===job.names.length);
      }catch(e){
        if(job.generation===generation&&job.scope===getScope()){
          const remaining=job.names.slice(index);s.pending-=remaining.length;
          s.text=remaining.join("\n")+(s.text?"\n"+s.text:"");
          s.error=e.message||"No se pudo guardar. Tus productos siguen escritos para reintentar.";
          onChange();
        }
        job.resolve(false);
      }
    }}finally{running=false;onChange();}
  }
  function commit(key,{all=false,options={}}={}){
    const s=state(key),scope=getScope();if(!scope)return Promise.resolve(false);
    let parsed;try{parsed=separarProductos(s.text,all);}catch(e){s.error=e.message;onChange();return Promise.resolve(false);}
    if(!parsed.names.length){if(parsed.rest!==s.text){s.text=parsed.rest;onChange();}return Promise.resolve(true);}
    s.text=parsed.rest;s.error="";s.pending+=parsed.names.length;
    const result=new Promise(resolve=>jobs.push({state:s,names:parsed.names,options:structuredClone(options),scope,generation,resolve}));
    onChange();drain();return result;
  }
  return {state,setText:(key,text)=>{state(key).text=text;},commit,
    isSaving:()=>[...states.values()].some(s=>s.pending>0),
    reset:()=>{generation++;for(const job of jobs)job.resolve(false);jobs=[];states=new Map();}};
}
