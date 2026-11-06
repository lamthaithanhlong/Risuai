const fs=require('fs');
for(const p of process.argv.slice(2)){const card=JSON.parse(fs.readFileSync(p,'utf8'));
 for(const s of card.data.extensions.risuai.triggerscript){const code=s.effect.filter(e=>e&&typeof e.code==='string').map(e=>e.code).join('\n');
  let n=0,fn=0;for(const l of code.split('\n')){const m=/^local\s+function\s+/.test(l);if(m){n++;continue}
   const m2=/^local\s+([A-Za-z_][\w, ]*?)\s*(=|$)/.exec(l);if(m2)n+=m2[1].split(',').length}
  console.log(p.split('/').slice(-4)[0].padEnd(24),String(code.length).padStart(7),'top-level locals ~',n)}}
