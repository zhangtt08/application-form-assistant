import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateProfile} from '../src/profile/schema.ts';
const require=createRequire(import.meta.url);
const {build}=require('esbuild');
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(dir);
await build({entryPoints:[path.join(dir,'import-client.js')],outfile:path.join(root,'dist/ztt-profile-import.js'),bundle:true,platform:'browser',format:'iife',target:'chrome114'});
const token=randomBytes(24).toString('hex');
const extensionId='idgekmcllilglnccdhcnnmokdaphibne';
const allowed=new Set([`chrome-extension://${extensionId}`,`extension://${extensionId}`]);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const differences=(a,b,p='')=>{
 if(stable(a)===stable(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differences(a[k],b[k],`${p}.${k}`)).slice(0,15);
 return [p];
};
const pack=JSON.parse(fs.readFileSync(path.join(dir,'三岗位资料库导入包.json'),'utf8'));
let completed=false;
const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin&& !allowed.has(origin)){res.writeHead(403);res.end();return;}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.searchParams.get('token')!==token){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type','application/json; charset=utf-8');
 try{
 if(req.method==='GET'&&u.pathname==='/package'){res.end(JSON.stringify(pack));return;}
 if(req.method==='GET'&&u.pathname==='/status'){res.end(JSON.stringify({completed}));return;}
 const chunks=[];let bytes=0;for await(const part of req){chunks.push(part);bytes+=part.length;if(bytes>15000000)throw Error('请求过大');}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(u.pathname==='/backup'){
   if(data.extensionId!==extensionId)throw Error('插件身份不匹配');
   const dest=path.join(dir,`导入前原资料库_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
   fs.writeFileSync(dest,JSON.stringify(data.original,null,2),'utf8');
   console.log('Original profile backup saved.');res.end('{"ok":true}');return;
 }
 if(u.pathname==='/receipt'){
   if(data.extensionId!==extensionId||data.ok!==true)throw Error('回执无效');
   for(const l of pack.libraries){
     const saved=data.store.libraries.find(x=>x.id===l.id);if(!saved)throw Error('缺少岗位库');
     const result=validateProfile({...data.store.shared,...saved.content});if(!result.ok)throw Error(result.errors.join(';'));
     const expected={...l.profile};delete expected.basic;delete expected.education;delete expected.sensitive;
     if(stable(saved.content)!==stable(expected)){console.log('Different paths: '+differences(saved.content,expected).join(', '));throw Error('岗位内容读回不一致');}
   }
   fs.writeFileSync(path.join(dir,'导入完成回执.json'),JSON.stringify(data,null,2),'utf8');completed=true;
   console.log(JSON.stringify({ok:true,verified:true,totalLibraries:data.store.libraries.length,imported:pack.libraries.map(l=>({name:l.name,projects:l.profile.projects.length})),backupKey:data.backupKey}));
   res.end('{"ok":true}');setTimeout(()=>server.close(),800);return;
 }
 if(u.pathname==='/error'){console.log(JSON.stringify(data));res.end('{"ok":true}');return;}
 res.writeHead(404);res.end('{"ok":false}');
 }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,message:String(e)}));console.log('Bridge error: '+String(e));}
});
server.listen(0,'127.0.0.1',()=>{const port=server.address().port;const url=`chrome-extension://${extensionId}/ztt-profile-import.html#bridge=${encodeURIComponent(`http://127.0.0.1:${port}`)}&token=${token}`;fs.writeFileSync(path.join(dir,'本次导入地址.txt'),url,'utf8');console.log(JSON.stringify({port,url}));});
