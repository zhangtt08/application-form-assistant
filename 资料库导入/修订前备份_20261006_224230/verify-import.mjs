import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProfile} from '../src/profile/schema.ts';
import {selectLibraryForDirection,profileForLibrary,repairProfileShape} from '../src/profile/libraryStore.ts';
import {resolveValue} from '../src/profile/profileResolver.ts';
const dir=path.dirname(fileURLToPath(import.meta.url));
const receipt=JSON.parse(fs.readFileSync(path.join(dir,'导入完成回执.json'),'utf8'));
const pack=JSON.parse(fs.readFileSync(path.join(dir,'三岗位资料库导入包.json'),'utf8'));
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
 }
 const value=resolveValue('basic.name',p);
 if(value?.value!=='张天腾')throw Error('Name resolution');
 results.push({name:l.name,projects:p.projects.length,internships:p.internships.length,campus:p.campus.length,schema:true,routing:true,numbered:true,readShapePreserved:true});
}
fs.writeFileSync(path.join(dir,'校验报告.json'),JSON.stringify({verifiedAt:new Date().toISOString(),extensionStorageReadback:true,libraries:results},null,2),'utf8');
console.log(JSON.stringify(results,null,2));
