const {openSaveStore,resolveBackend}=require('./server/node/saveStore.cjs');const {decodeSave,parseBlock}=require('./server/node/dbMerge.cjs');
const st=openSaveStore({saveDir:'save',backend:resolveBackend(),readonly:true});
const DB='64617461626173652f64617461626173652e62696e';const blocks=decodeSave(st.read(DB));
for(const b of blocks){ if(b.name==='root'||b.name.length<20) continue; let v=null; try{v=parseBlock(b)}catch(e){}
  console.log(b.name.slice(0,36), 'type',b.type, v?('name='+(v.name||'')+' image='+(v.image||'')+' lore='+((v.globalLore||[]).length)):'(remote/cold or unparsed)');}
