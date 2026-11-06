const {openSaveStore,resolveBackend}=require('./server/node/saveStore.cjs');const crypto=require('crypto');
const st=openSaveStore({saveDir:'save',backend:resolveBackend(),readonly:true});
const hex=s=>Buffer.from(s,'utf8').toString('hex');
for(const id of ['04103f68-46fc-4384-8d2f-04781a0a4d27','22a987d8-4a13-4185-b24a-0308be8502fd','aa7f021d-b690-4f02-8e64-9e28aa0aff01','fc27f53b-773d-40af-a925-453157c837d5','3e61bc67-e5ee-4fa3-bac5-baf0b1bd30a0','e4999783-e3a4-4bab-b94c-83c83c1e638d']){
 const raw=st.read(hex(`remotes/${id}.local.bin`)); const j=JSON.parse(Buffer.from(raw).toString('utf8'));
 console.log(id.slice(0,8),'name=',j.name,'| image=',j.image,'| cold=',j.coldstorage||'-','| bytes',raw.length,'| keys',Object.keys(j).slice(0,12).join(','))}
