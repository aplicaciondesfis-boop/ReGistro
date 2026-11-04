import {normalizar,validarNecesidad} from "./compras.mjs?v=12";

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
          await guardar(job.names[index],job.options,job.scope);
          if(job.generation!==generation)break;
          s.pending--;s.saved++;onChange();
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
