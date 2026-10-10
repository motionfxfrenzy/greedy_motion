import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {engineVariables,declareVariables,stampCanvas,fillTextBlock,CANVAS} from '../backend/src/plan/composition.ts';
import {renderManifest} from '../backend/src/plan/render-manifest.ts';
const root=resolve(import.meta.dirname,'..');
const template=await readFile(join(root,'worker/templates/beat-plan/index.html'),'utf8');
const vec={axis:'x',dir:-1};
export const beats=[
 {id:'motion',role:'hook',kind:'kinetic',keyword:'Ideas in motion',energy:'high',render:{graphic:'particles'}},
 {id:'interface',role:'feature',kind:'ui',keyword:'Click to publish',energy:'medium',ui:{screen:'s1',action:'click',target:'Publish button'},render:{treatment:'clean'}},
 {id:'drawing',role:'feature',kind:'kinetic',keyword:'Draw the story',energy:'medium',render:{treatment:'doodle'}},
 {id:'lines',role:'success',kind:'kinetic',keyword:'Every line matters',energy:'medium',render:{treatment:'hairline'},success:true},
 {id:'ending',role:'cta',kind:'title',keyword:'Make it yours',energy:'calm',render:{treatment:'clean'}}
].map(b=>({producer:'hyperframes',line:null,on_screen:null,verb:null,success:false,motion:{entry:vec,exit:vec},transition_out:{type:b.role==='cta'?'end':'j-cut'},...b}));
for(const aspect of Object.keys(CANVAS)){
 const dir=join(root,'validation/mixed-renderer',aspect.replace(':','x'));await mkdir(join(dir,'vendor'),{recursive:true});await mkdir(join(dir,'shots'),{recursive:true});
 await cp(join(root,'worker/templates/product-launch/assets/screenshot.svg'),join(dir,'shots/s1.svg'));
 await cp(join(root,'node_modules/gsap/dist/gsap.min.js'),join(dir,'vendor/gsap.min.js'));
 await cp(join(root,'worker/fonts'),join(dir,'fonts'),{recursive:true});
 const plan={canvas:aspect,brand:{motion_profile:'smooth'},audio:{captions:'none'},beats};
 const timing={beats:beats.map((b,i)=>({id:b.id,start:i*3,end:(i+1)*3,actAt:i*3+1.2,successAt:b.success?i*3+1.6:null}))};
 const values=engineVariables({plan,timing,shots:{s1:'shots/s1.svg'},brandName:'Mixed Motion',look:'clean',screenSizes:{s1:{width:1600,height:1000}}});
 let html=fillTextBlock(declareVariables(stampCanvas(template,aspect),values,{asDefaults:true}),{});
 html=html.replace('</head>',`<style>${await readFile(join(root,'worker/fonts/fonts.css'),'utf8')}\n${await readFile(join(root,'worker/themes/blue-professional.css'),'utf8')}</style></head>`);
 await writeFile(join(dir,'index.html'),html);await writeFile(join(dir,'variables.json'),JSON.stringify(values));
 await writeFile(join(dir,'render-manifest.json'),JSON.stringify(await renderManifest(dir,JSON.parse(values.plan),{s1:'shots/s1.svg'},{}),null,2));
 console.log(dir);
}
