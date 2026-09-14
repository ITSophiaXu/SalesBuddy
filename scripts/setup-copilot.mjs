import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {copyFile,readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {loadEnvironment,findLocalCopilot,projectRoot} from '../server/environment.js';

process.chdir(projectRoot);
const say=text=>process.stdout.write(text+'\n');
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:projectRoot,stdio:'inherit',shell:false});child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
async function check(){return run(process.execPath,['scripts/check-copilot.mjs','--live']);}
try{
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('请安装 Node.js 22 或更新版本（包含 npm）：https://nodejs.org/');
  if(!existsSync('.env'))await copyFile('.env.example','.env');
  await loadEnvironment();
  const mode=process.argv[2]||'install';
  if(mode==='install'){
    say('1/3 安装本项目的 Copilot SDK 与 CLI，版本会锁定在 package-lock.json。');
    let npmScript=process.env.npm_execpath;
    const candidates=[npmScript,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')].filter(Boolean);
    if(process.platform==='win32'){
      const paths=spawnSync('where.exe',['npm.cmd'],{encoding:'utf8',windowsHide:true}).stdout||'';
      for(const path of paths.trim().split(/\r?\n/).filter(Boolean))candidates.push(join(dirname(path),'node_modules','npm','bin','npm-cli.js'));
    }
    npmScript=candidates.find(p=>p.endsWith('npm-cli.js')&&existsSync(p));
    const code=npmScript?await run(process.execPath,[npmScript,'install','--no-audit','--no-fund']):process.platform!=='win32'?await run('npm',['install','--no-audit','--no-fund']):null;
    if(code===null)throw new Error('没有找到 npm。请安装包含 npm 的完整 Node.js 22+，重新打开终端后运行此安装程序。');
    if(code!==0)throw new Error('依赖安装未完成。请检查 npm 软件包源与网络；安装程序没有修改系统代理或全局配置。');
  }
  say('2/3 检查真实模型连接。只使用代码包中的虚构示例，不读取门店客户。');
  let result=await check();
  if(result!==0){
    const report=JSON.parse(await readFile(resolve(projectRoot,'runtime','copilot-check.json'),'utf8'));
    if(report.code==='COPILOT_AUTH_REQUIRED'&&process.stdin.isTTY){
      const cli=await findLocalCopilot();if(!cli)throw new Error('找不到项目内的 Copilot CLI，请重新安装依赖。');
      say('需要你完成账户登录。即将打开 Copilot CLI；按提示登录，或输入 /login。完成后输入 /exit 返回验证。');
      await run(cli.endsWith('.js')||cli.endsWith('.mjs')?process.execPath:cli,cli.endsWith('.js')||cli.endsWith('.mjs')?[cli]:[]);
      result=await check();
    }
  }
  if(result!==0)throw new Error('尚未通过真实调用检查。原因见上方结果和 runtime/copilot-check.json；请修正后运行 npm run verify:copilot。');
  say('3/3 已通过真实对话、短话术、客户画像、方案和海报检查。双击“启动Motive.cmd”或运行 npm start，然后打开 http://127.0.0.1:4173。');
}catch(error){say('安装或连接尚未完成：'+error.message);process.exitCode=1;}
