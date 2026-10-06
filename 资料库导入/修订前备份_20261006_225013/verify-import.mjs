import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProfile} from '../src/profile/schema.ts';
import {selectLibraryForDirection,profileForLibrary,repairProfileShape} from '../src/profile/libraryStore.ts';
import {resolveValue} from '../src/profile/profileResolver.ts';
const dir=path.dirname(fileURLToPath(import.meta.url));
const pack=JSON.parse(fs.readFileSync(path.join(dir,'三岗位资料库导入包.json'),'utf8'));
const candidate=process.argv.includes('--candidate');
const first=pack.libraries[0].profile;
const receipt=candidate?{store:{schemaVersion:2,shared:{basic:first.basic,education:first.education,sensitive:first.sensitive},libraries:pack.libraries.map(l=>({...l,content:Object.fromEntries(Object.entries(l.profile).filter(([key])=>!['basic','education','sensitive'].includes(key)))})),activeLibraryId:pack.libraries[0].id}}:JSON.parse(fs.readFileSync(path.join(dir,'导入完成回执.json'),'utf8'));
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const results=[];
for(const l of pack.libraries){
 const p=profileForLibrary(receipt.store,l.id);
 const v=validateProfile(p);if(!v.ok)throw Error(`${l.name}: schema`);
 const repaired=validateProfile(repairProfileShape(p));if(!repaired.ok)throw Error('repaired profile invalid');
 const rebuilt=repaired.profile;
 for(const key of ['projects','internships','campus','skills','content'])if(stable(rebuilt[key])!==stable(p[key]))throw Error(`${l.name}: repair removes ${key}`);
 for(const dir of l.directions){if(selectLibraryForDirection(receipt.store,dir).id!==l.id)throw Error(`route ${dir}`);}
 for(const e of [...p.projects,...p.internships,...p.campus]){
   for(const key of ['descriptionShort','descriptionMedium','descriptionLong','responsibilities','workContent','achievements','summary']){
     if(!e[key]||!e[key].startsWith('1. '))throw Error(`${l.name}: non-numbered ${key}`);
   }
   if(e.descriptionShort!==e.descriptionLong||e.descriptionMedium!==e.descriptionLong)throw Error(`${l.name}: shortened description`);
   for(const text of Object.values(e.variants))if(text!==e.descriptionLong)throw Error(`${l.name}: shortened role variant`);
 }
 for(const block of Object.values(p.content))if(block.short!==block.long||block.medium!==block.long)throw Error(`${l.name}: shortened content block`);
 if(Object.values(p.content.hobbies).some(Boolean))throw Error(`${l.name}: irrelevant hobbies`);
 if(/玩游戏|游戏体验|原神|鸣潮|明日方舟|赛博朋克|不冒充|不编造|不自称|不将接触|不以模糊|学习委员/.test(JSON.stringify(p)))throw Error(`${l.name}: irrelevant or editorial content`);
 const value=resolveValue('basic.name',p);
 if(value?.value!=='张天腾')throw Error('Name resolution');
 for(const [collection,field] of [['projects','project.description'],['internships','internship.description']]){
   for(let entryIndex=0;entryIndex<p[collection].length;entryIndex++){
     for(const maxLength of [null,120,350,2000]){
       for(const profileType of ['general',...l.directions]){
         const resolved=resolveValue(field,p,{entryIndex,maxLength,profileType});
         if(resolved?.value!==p[collection][entryIndex].descriptionLong)throw Error(`${l.name}: resolver did not use long content`);
       }
     }
   }
 }
 results.push({name:l.name,projects:p.projects.length,internships:p.internships.length,campus:p.campus.length,schema:true,routing:true,numbered:true,allDescriptionsUseLong:true,allVariantsUseLong:true,irrelevantContentRemoved:true,readShapePreserved:true});
}
fs.writeFileSync(path.join(dir,candidate?'导入前校验报告.json':'校验报告.json'),JSON.stringify({verifiedAt:new Date().toISOString(),extensionStorageReadback:!candidate,libraries:results},null,2),'utf8');
console.log(JSON.stringify(results,null,2));
