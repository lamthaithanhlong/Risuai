const {openSaveStore,resolveBackend}=require('./server/node/saveStore.cjs');
const st=openSaveStore({saveDir:'save',backend:resolveBackend(),readonly:true});
const hex=s=>Buffer.from(s,'utf8').toString('hex');
const j=JSON.parse(Buffer.from(st.read(hex('remotes/22a987d8-4a13-4185-b24a-0308be8502fd.local.bin'))).toString('utf8'));
const gl=j.globalLore||[];const m5=gl.find(e=>/Module 05/.test(e.comment||''));
console.log('lore',gl.length,'m05 len',m5&&m5.content.length,'has inner NPC line:',m5&&/\[\[NPC\|/.test(m5.content),'chats',(j.chats||[]).length,'msgs',(j.chats||[]).map(c=>(c.message||[]).length).join(','));
const ts=(j.triggerscript||[]);console.log('scripts',ts.map(s=>s.comment+':'+(s.effect||[]).reduce((a,e)=>a+(e.code||'').length,0)).join(' | '));
console.log('desc',(j.desc||'').length,'Evelyn in desc',/Evelyn/.test(j.desc||''),'lorebudget',j.loreSettings&&j.loreSettings.tokenBudget);
