const {LuaFactory}=require('wasmoon');const fs=require('fs');
(async()=>{const f=new LuaFactory();for(const p of process.argv.slice(2)){
 const card=JSON.parse(fs.readFileSync(p,'utf8'));const ts=card.data.extensions.risuai.triggerscript;
 for(const s of ts){const code=s.effect.filter(e=>e&&typeof e.code==='string').map(e=>e.code).join('\n');
  const L=await f.createEngine();L.global.set('SRC',code);
  const r=await L.doString("local fn,err=load(SRC,'card') if fn then return 'OK' else return err end");
  console.log(p.split('/').slice(-3).join('/').slice(0,70),'|',s.comment.slice(0,30),'|',code.length,'|',r);L.global.close();}}})();
