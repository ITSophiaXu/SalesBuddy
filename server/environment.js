import {readFile,access} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)));
export async function loadEnvironment({path=resolve(projectRoot,'.env'),env=process.env}={}) {
  let content;
  try{content=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return;throw new Error('无法读取服务端配置文件。');}
  if(content.length>65536)throw new Error('服务端配置文件过大。');
  for(const [key,value] of Object.entries(parseEnv(content)))if(env[key]===undefined)env[key]=value;
}
export async function findLocalCopilot({root=projectRoot}={}) {
  const directory=resolve(root,'node_modules','@github','copilot');
  try{
    const manifest=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));
    const bin=typeof manifest.bin==='string'?manifest.bin:manifest.bin?.copilot;
    if(!bin)return '';
    const path=resolve(directory,bin);await access(path);return path;
  }catch{return '';}
}
export async function copilotOptions(env=process.env,{root=projectRoot}={}) {
  let githubToken=env.COPILOT_GITHUB_TOKEN||env.GH_TOKEN||env.GITHUB_TOKEN||'';
  if(env.COPILOT_GITHUB_TOKEN_FILE){
    try{githubToken=(await readFile(env.COPILOT_GITHUB_TOKEN_FILE,'utf8')).trim();}catch{throw new Error('无法读取 Copilot 身份文件，请检查路径和服务账户权限。');}
    if(!githubToken)throw new Error('Copilot 身份文件为空。');
  }
  return {model:env.COPILOT_MODEL||'',cliPath:env.COPILOT_CLI_PATH||await findLocalCopilot({root}),githubToken};
}
