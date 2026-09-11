import {CopilotGenerator} from '../server/copilot.js';
import {normalizeRequest} from '../server/protocol.js';
import {seedState} from '../data.js';
const generator=new CopilotGenerator({model:process.env.COPILOT_MODEL||'',cliPath:process.env.COPILOT_CLI_PATH||'',githubToken:process.env.COPILOT_GITHUB_TOKEN||process.env.GH_TOKEN||''});
try {
  const status=await generator.status({probe:true});
  process.stdout.write(JSON.stringify(status,null,2)+'\n');
  if(!status.ready)process.exitCode=1;
  else if(process.argv.includes('--generate')){
    const sample=seedState();const request=normalizeRequest({kind:'followup',prompt:'准备两句话的英文跟进消息与中文审核要点。只使用虚构示例资料。',customer:sample.customers[0],vehicles:sample.vehicles,knowledge:sample.knowledge,workspaceName:'Atlas Motors'});
    const artifact=await generator.generate(request);
    process.stdout.write(JSON.stringify({ok:true,engine:artifact.engine,model:artifact.model,title:artifact.title,sections:artifact.sections.length},null,2)+'\n');
  }
} catch(error){process.stderr.write(`${error.code||'CHECK_FAILED'}: ${error.message}\n`);process.exitCode=1;}finally{await generator.stop();}
