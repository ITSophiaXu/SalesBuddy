import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {CopilotGenerator} from '../server/copilot.js';
import {loadEnvironment,copilotOptions,projectRoot} from '../server/environment.js';
import {runLiveCheck} from '../server/live-check.js';

const live=process.argv.includes('--live')||process.argv.includes('--generate');
let generator;
let report={ok:false,provider:'copilot',liveRequested:live,checkedAt:new Date().toISOString(),checks:[]};
try {
  await loadEnvironment();generator=new CopilotGenerator(await copilotOptions());
  const status=await generator.status({probe:true});report.connection=status;
  if(!status.ready){report.code=status.code;report.message=status.message;process.exitCode=1;}
  else if(live){report=await runLiveCheck(generator);if(!report.ok)process.exitCode=1;}
  else{report.ok=true;report.message='身份检查通过；请运行 npm run verify:copilot 验证真实对话和成果生成。';}
}catch(error){report.code=error.code||'CHECK_FAILED';report.message='连接检查未完成，请检查配置和运行环境。';process.exitCode=1;}
finally{
  if(generator)await generator.stop().catch(()=>{});
  const reportPath=process.env.MOTIVE_CHECK_REPORT||(process.env.NODE_ENV==='production'?resolve(tmpdir(),'motive-copilot-check.json'):resolve(projectRoot,'runtime','copilot-check.json'));
  try{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
  catch{process.stderr.write('检查报告未能写入文件；完整结果见下方输出。\n');}
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
