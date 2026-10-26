import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CANVAS, type EnginePlan } from './composition.ts';

/** Export preparation gate; preview may still show placeholders, a final film may not. */
export async function renderManifest(dir: string, plan: EnginePlan, shots: Record<string,string>, clips: Record<string,{file:string}>) {
  let nextFrame = 0;
  const seen = new Set<string>();
  const assets = new Set(['index.html','variables.json']);
  const scenes = plan.beats.map(beat => {
    const startFrame = Math.round(beat.start*30), endFrame = Math.round(beat.end*30);
    if (!Number.isFinite(beat.start) || !Number.isFinite(beat.end) || startFrame !== nextFrame || endFrame <= startFrame || seen.has(beat.id)) throw new Error('Invalid or non-contiguous scene timing: '+beat.id);
    nextFrame=endFrame;seen.add(beat.id);
    let asset: string | undefined;
    if (beat.route.renderer === 'media') {
      if (!clips[beat.id]) throw new Error(`Scene ${beat.id} requires footage before export; graphic fallback is preview-only.`);
      asset='visuals/'+clips[beat.id]!.file;
    } else if (beat.kind === 'ui') {
      asset=beat.ui ? shots[beat.ui.screen] : undefined;
      if (!asset) throw new Error(`Scene ${beat.id} requires its screenshot before export.`);
    }
    if (asset) assets.add(asset);
    return {id:beat.id,startFrame,endFrame,route:beat.route,...(asset?{asset}:{}),transition:beat.transition_out,entry:beat.motion.entry,exit:beat.motion.exit};
  });
  if (!scenes.length) throw new Error('Cannot export an empty scene plan.');
  const files: Record<string,{sha256:string;bytes:number}> = {};
  for(const file of assets) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file) || file.startsWith('/') || file.split('/').some(x=>!x||x==='..'||x==='.')) throw new Error('Invalid scene asset path.');
    const bytes=await readFile(join(dir,file));
    files[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  return {version:1,compositor:'hyperframes',workerClass:'browser',fps:30,canvas:CANVAS[plan.canvas],totalFrames:nextFrame,scenes,files};
}
