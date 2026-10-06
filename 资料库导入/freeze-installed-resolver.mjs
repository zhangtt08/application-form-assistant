// 已安装 dist 使用旧描述结构；隔离正在编辑的源码，只验证这次资料写入。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(dir);
const installed=fs.readFileSync(path.join(root,'dist/sidepanel.js'),'utf8');
for(const key of ['descriptionShort','descriptionMedium','descriptionLong'])if(!installed.includes(key))throw Error('Installed schema changed; re-check before importing');
const source=execFileSync('git',['show','HEAD:src/profile/profileResolver.ts'],{cwd:root,encoding:'utf8'});
if(!source.includes('chooseVariant'))throw Error('Committed resolver is not the installed legacy format');
const {build}=createRequire(import.meta.url)('esbuild');
await build({stdin:{contents:source,sourcefile:'installed-profile-resolver.ts',resolveDir:path.join(root,'src/profile'),loader:'ts'},outfile:path.join(dir,'installed-profile-resolver.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
console.log(JSON.stringify({verificationTarget:'installed-legacy-extension',committedSourceSha256:createHash('sha256').update(source).digest('hex')}));
