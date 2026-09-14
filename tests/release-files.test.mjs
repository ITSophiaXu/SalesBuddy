import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

test('部署和源码包包含从应用、服务与连接检查可达的全部本地模块',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),seen=new Set();
  function visit(file){
    if(seen.has(file))return;seen.add(file);assert.ok(existsSync(file),'missing '+file);
    const content=readFileSync(file,'utf8');
    for(const match of content.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))visit(resolve(dirname(file),match[1]));
  }
  for(const entry of ['app.js','server.js','scripts/check-copilot.mjs'])visit(resolve(root,entry));
  const docker=readFileSync(resolve(root,'Dockerfile'),'utf8'),ignore=readFileSync(resolve(root,'.dockerignore'),'utf8').split(/\r?\n/),pack=readFileSync(resolve(root,'scripts/package-release.ps1'),'utf8');
  for(const file of seen){
    const name=relative(root,file).replaceAll('\\','/');
    if(name.startsWith('node_modules/')){
      assert.equal(name,'node_modules/marked/lib/marked.esm.js');
      const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
      const lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8'));
      assert.equal(lock.packages['node_modules/marked'].version,manifest.dependencies.marked);
      assert.ok(docker.includes('npm ci'));
      assert.ok(ignore.includes('!package-lock.json'));
      continue;
    }
    if(name.includes('/')){assert.ok(name.startsWith('server/')||name==='scripts/check-copilot.mjs',name);assert.ok(docker.includes(name.startsWith('server/')?'COPY server ./server':'COPY '+name),name);continue;}
    assert.ok(ignore.includes('!'+name),'Docker context excludes '+name);
    assert.ok(docker.split(/\s+/).includes(name),'Docker COPY misses '+name);
    assert.ok(pack.includes("'"+name+"'"),'ZIP misses '+name);
  }
  for(const [,asset] of readFileSync(resolve(root,'index.html'),'utf8').matchAll(/href="([^"/]+\.css)"/g)){
    assert.ok(ignore.includes('!'+asset));assert.ok(docker.split(/\s+/).includes(asset));assert.ok(pack.includes("'"+asset+"'"));
  }
});
