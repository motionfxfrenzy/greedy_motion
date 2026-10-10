// Compare a preserved pre-change project with the revised project, at every 30fps frame.
// Usage: node scripts/verify-sting-seeks.mjs <before-project> <after-project> <report.json>
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {withComposition} from '../.claude/skills/gm-skill-authoring/scripts/lib/hf_page.mjs';
const [before,after,report]=process.argv.slice(2);
if(!before||!after||!report)throw Error('Expected before-project after-project report.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=[], revised=[], differences=[];
await withComposition({project:before},async page=>{
 for(let frame=0;frame<Math.round(page.dims.d*30);frame++){await page.seek(frame/30);original.push(hash(await page.screenshot()));}
});
await withComposition({project:after},async page=>{
 for(let frame=0;frame<original.length;frame++){await page.seek(frame/30);const h=hash(await page.screenshot());revised.push(h);if(h!==original[frame])differences.push({pass:'forward-regression',frame});}
 for(const frame of Array.from({length:original.length},(_,i)=>i).reverse()){await page.seek(frame/30);if(hash(await page.screenshot())!==revised[frame])differences.push({pass:'reverse',frame});}
 // Fixed permutation coprime to the 358-frame film length.
 const order=Array.from({length:original.length},(_,i)=>i);let seed=12345;
 for(let i=order.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[order[i],order[j]]=[order[j],order[i]];}
 for(const frame of order){await page.seek(frame/30);if(hash(await page.screenshot())!==revised[frame])differences.push({pass:'shuffled',frame});}
});
await writeFile(report,JSON.stringify({frames:original.length,fps:30,differences,original,revised},null,2)+'\n');
console.log(JSON.stringify({frames:original.length,differences}));
process.exit(differences.length?1:0);
