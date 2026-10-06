import {validateProfile} from '../src/profile/schema.ts';
const keys=['afa.profiles.v2','afa.profile.v1'];
const status=document.getElementById('status');
const result=document.getElementById('result');
const query=new URLSearchParams(location.hash.slice(1));
const base=query.get('bridge');
const token=query.get('token');
const send=async(route,data)=>{const response=await fetch(`${base}/${route}?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw new Error(`${route}: ${response.status}`);return response.json();};
const split=p=>({shared:{basic:p.basic,education:p.education,sensitive:p.sensitive},content:Object.fromEntries(Object.entries(p).filter(([k])=>!['basic','education','sensitive'].includes(k)))});
const mergeBlank=(old,newData)=>{const out={...newData,...old};for(const[k,v]of Object.entries(newData))if(!old?.[k])out[k]=v;return out;};
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
let original=null;
let changed=false;
async function main(){
 if(!base||!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)||!token)throw Error('缺少有效的本机导入服务');
 const response=await fetch(`${base}/package?token=${encodeURIComponent(token)}`);if(!response.ok)throw Error('无法读取导入包');
 const pack=await response.json();
 for(const l of pack.libraries){const v=validateProfile(l.profile);if(!v.ok)throw Error(`${l.name}: ${v.errors.join(';')}`);l.profile=v.profile;}
 original=await chrome.storage.local.get(keys);
 const oldName=original[keys[0]]?.shared?.basic?.name||original[keys[1]]?.basic?.name;
 if(oldName&&oldName!=='张天腾')throw Error('现有资料库姓名不同，未覆盖');
 await send('backup',{extensionId:chrome.runtime.id,original});
 const backupKey=`afa.profiles.backup.ztt.${Date.now()}`;
 await chrome.storage.local.set({[backupKey]:{createdAt:new Date().toISOString(),original}});
 const first=split(pack.libraries[0].profile);
 let store=original[keys[0]];
 if(store&&(!Array.isArray(store.libraries)||!store.shared))throw Error('原 v2 资料库结构异常；已备份，未覆盖');
 if(!store){
   const legacy=original[keys[1]];
   if(legacy){const valid=validateProfile(legacy);if(!valid.ok)throw Error('原单库资料结构不合法；已备份，未覆盖');const s=split(valid.profile);store={schemaVersion:2,shared:s.shared,libraries:[{id:'ztt_preserved_legacy',name:'原默认资料库',directions:[],note:'导入前单库资料保留',content:s.content,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],activeLibraryId:'ztt_preserved_legacy'};}
   else store={schemaVersion:2,shared:first.shared,libraries:[],activeLibraryId:''};
 }
 store=structuredClone(store);
 store.shared.basic=mergeBlank(store.shared.basic,first.shared.basic);
 store.shared.sensitive=mergeBlank(store.shared.sensitive,first.shared.sensitive);
 const oldEdu=store.shared.education||[];
 store.shared.education=first.shared.education.map(e=>mergeBlank(oldEdu.find(x=>x.school===e.school&&x.major===e.major),e));
 for(const e of oldEdu)if(!store.shared.education.some(x=>x.school===e.school&&x.major===e.major))store.shared.education.push(e);
 const now=new Date().toISOString();
 for(const l of pack.libraries){
   const prior=store.libraries.find(x=>x.id===l.id);
   const lib={id:l.id,name:l.name,directions:l.directions,note:l.note,content:split(l.profile).content,createdAt:prior?.createdAt||now,updatedAt:now};
   const ix=store.libraries.findIndex(x=>x.id===l.id);if(ix<0)store.libraries.push(lib);else store.libraries[ix]=lib;
 }
 store.activeLibraryId=pack.libraries[0].id;
 for(const l of store.libraries){const v=validateProfile({...store.shared,...l.content});if(!v.ok)throw Error(`合并后校验失败：${l.name}`);}
 const mirror={...store.shared,...store.libraries.find(x=>x.id===store.activeLibraryId).content};
 changed=true;
 await chrome.storage.local.set({[keys[0]]:store,[keys[1]]:mirror});
 const back=await chrome.storage.local.get(keys);
 if(stable(back[keys[0]])!==stable(store)||stable(back[keys[1]])!==stable(mirror))throw Error('保存后读回不一致');
 const receipt={ok:true,extensionId:chrome.runtime.id,backupKey,verifiedAt:now,store:back[keys[0]],mirror:back[keys[1]],importedIds:pack.libraries.map(l=>l.id)};
 await send('receipt',receipt);
 status.textContent='导入成功：已保存并读回验证，原资料库已备份。';
 result.textContent=pack.libraries.map(l=>`${l.name}\n项目 ${l.profile.projects.length} 条｜实习 ${l.profile.internships.length} 条｜校园 ${l.profile.campus.length} 条`).join('\n\n')+'\n\n返回插件“资料”页即可选择岗位库。';
}
main().catch(async error=>{
 if(changed&&original){for(const k of keys){if(k in original)await chrome.storage.local.set({[k]:original[k]});else await chrome.storage.local.remove(k);}}
 status.textContent='导入未完成；原资料已保留／恢复。';result.textContent=String(error);
 if(base&&token)try{await send('error',{ok:false,message:String(error)});}catch{}
});
