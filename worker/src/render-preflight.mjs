import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
export const RENDER_CAPABILITIES=Object.freeze({version:1,workerClass:'browser',compositor:'hyperframes',renderers:['dom','canvas2d','rough-svg','hairline-svg','media'],nativeRenderers:[],fps:30});
export class RenderContractError extends Error {}
const fail=message=>{throw new RenderContractError(message)};
/** Only backend-prepared beat plans require manifests. Legacy/editor compositions remain supported. */
export async function preflightRender(folder,{requireManifest=false}={}) {
  let text;
  try{text=await readFile(resolve(folder,'render-manifest.json'),'utf8')}catch(e){if(e.code==='ENOENT'&&!requireManifest)return {legacy:true};throw e}
  let m;try{m=JSON.parse(text)}catch{fail('Invalid render manifest JSON')}
  if(m?.version!==1||m.compositor!=='hyperframes'||m.workerClass!=='browser'||m.fps!==30)fail('Unsupported render contract or worker class');
  if(![m.canvas?.width,m.canvas?.height].every(x=>Number.isInteger(x)&&x>=2&&x<=3840&&x%2===0))fail('Invalid render dimensions');
  if(!Number.isInteger(m.totalFrames)||m.totalFrames<1||m.totalFrames>36000||!Array.isArray(m.scenes)||!m.scenes.length||m.scenes.length>128)fail('Invalid render duration/scenes');
  if(!m.files||typeof m.files!=='object'||Array.isArray(m.files)||!m.files['index.html']||!m.files['variables.json'])fail('Missing composition fingerprints');
  let end=0;const ids=new Set();
  for(const s of m.scenes){
    if(typeof s.id!=='string'||!s.id||ids.has(s.id)||s.startFrame!==end||!Number.isInteger(s.endFrame)||s.endFrame<=end)fail('Non-contiguous scene timeline');
    if(!RENDER_CAPABILITIES.renderers.includes(s.route?.renderer))fail('Unsupported scene renderer');
    if(s.route.renderer==='media'&&!s.asset)fail('Required scene footage is missing');
    if(s.asset&&!m.files[s.asset])fail('Scene asset has no fingerprint');
    ids.add(s.id);end=s.endFrame;
  }
  if(end!==m.totalFrames)fail('Scene duration does not match film duration');
  const base=await realpath(folder);
  for(const[file,info]of Object.entries(m.files)){
    if(!info||!Number.isSafeInteger(info.bytes)||info.bytes<0||!/^([a-f0-9]{64})$/.test(info.sha256??''))fail('Invalid asset fingerprint');
    if(!/^[a-zA-Z0-9_./-]+$/.test(file)||file.startsWith('/')||file.split('/').some(x=>!x||x==='..'||x==='.'))fail('Invalid asset path');
    const path=await realpath(resolve(folder,file));if(!path.startsWith(base+sep))fail('Asset escapes prepared project');
    const bytes=await readFile(path);
    if(bytes.length!==info.bytes||createHash('sha256').update(bytes).digest('hex')!==info.sha256)fail('Prepared scene asset changed: '+file);
  }
  return {legacy:false,manifest:m};
}
