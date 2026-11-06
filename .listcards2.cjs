const {openSaveStore,resolveBackend}=require('./server/node/saveStore.cjs');const {decodeSave,parseBlock}=require('./server/node/dbMerge.cjs');
const st=openSaveStore({saveDir:'save',backend:resolveBackend(),readonly:true});
const hex=s=>Buffer.from(s,'utf8').toString('hex');
for(const id of ['3e61bc67-e5ee-4fa3-bac5-baf0b1bd30a0','e4999783-e3a4-4bab-b94c-83c83c1e638d']){
 const raw=st.read(hex(`remotes/${id}.local.bin`)); if(!raw){console.log(id,'no remote file');continue}
 let bl=[];try{bl=decodeSave(raw)}catch(e){console.log(id,'decode',e.message)}
 for(const b of bl){let v=null;try{v=parseBlock(b)}catch(e){} if(v&&typeof v==='object') console.log(id.slice(0,8),b.name,'name=',v.name,'image=',v.image,'lore=',(v.globalLore||[]).length,'keys=',Object.keys(v).length); else console.log(id.slice(0,8),b.name,'type',b.type)}
 console.log(id.slice(0,8),'bytes',raw.length)}
