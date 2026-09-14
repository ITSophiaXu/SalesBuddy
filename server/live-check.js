import {normalizeChatRequest} from './chat.js';
import {normalizeRequest} from './protocol.js';
import {seedState} from '../data.js';
import {storeSubject} from '../workspace-model.js';
import {createPoster,buildPosterSVG} from '../poster.js';
import {validateProfileFacts} from '../customer-profile.js';

// Uses synthetic bundled records only; never a user's CRM or active browser data.
export async function runLiveCheck(generator) {
  const checks=[],sample=seedState();
  const report={ok:false,provider:'copilot',liveRequested:true,checkedAt:new Date().toISOString(),checks};
  const context={kind:'followup',prompt:'验证连接',customer:sample.customers[0],vehicles:sample.vehicles,knowledge:sample.knowledge,workspaceName:'Motive · 合成资料验证'};
  async function check(name,work){
    const begin=Date.now();
    try{const result=await work();checks.push({name,ok:true,elapsedMs:Date.now()-begin,...result});}
    catch(error){checks.push({name,ok:false,code:error.code||'LIVE_CHECK_FAILED',message:error.code?error.message:'结果未达到此项检查要求。'});throw error;}
  }
  try{
    await check('普通对话',async()=>{
      const result=await generator.chat(normalizeChatRequest({message:'你好，请用一句中文说明你怎样帮助汽车门店的销售。'}));
      if(result.engine!=='copilot'||result.mode!=='reply'||!result.reply?.trim())throw new Error('Expected real conversation reply');
      return {engine:result.engine,mode:result.mode};
    });
    await check('短话术直接回复',async()=>{
      const result=await generator.chat(normalizeChatRequest({context,message:'帮示例客户 Sarah 写一句简短的英文跟进话术，不要生成文档或任务。'}));
      if(result.engine!=='copilot'||result.mode!=='reply'||result.artifactRequest)throw new Error('Expected inline copy');
      return {engine:result.engine,mode:result.mode};
    });
    await check('销售对话整理客户画像',async()=>{
      const message='沟通记录：Sarah 说需要放两个儿童座椅。太太会一起试驾后决定。请整理成待确认的客户画像，不要制定方案。';
      const result=await generator.chat(normalizeChatRequest({context,message}));
      if(result.engine!=='copilot'||result.mode!=='profile'||result.artifactRequest)throw new Error('Expected profile proposal');
      const facts=validateProfileFacts(result.profileProposal?.facts,[message]);
      if(!facts.some(f=>f.field==='need')||!facts.some(f=>f.field==='decisionProcess'))throw new Error('Missing supported profile dimensions');
      return {engine:result.engine,mode:result.mode,facts:facts.length};
    });
    const store=storeSubject(sample,'US');let action;
    await check('营销方案识别为任务',async()=>{
      const result=await generator.chat(normalizeChatRequest({context:{...context,scope:'store',customer:store},message:'为美国门店制定家庭 SUV 营销方案，包含目标客群、英文邀请内容、活动海报和执行安排。日期、库存和优惠待核实。这是需要持续跟进的完整任务。'}));
      if(result.engine!=='copilot'||result.mode!=='artifact'||result.artifactRequest?.delivery!=='task'||!result.artifactRequest.needsPoster)throw new Error('Expected campaign task with poster');
      action=result.artifactRequest;return {engine:result.engine,mode:result.mode,delivery:action.delivery};
    });
    await check('真实方案与海报',async()=>{
      const artifact=await generator.generate(normalizeRequest({...context,scope:'store',customer:{...store,language:action.language},kind:action.kind,prompt:action.prompt,needsPoster:true}));
      if(artifact.engine!=='copilot'||!artifact.posterBrief?.headline||artifact.sections.length<3)throw new Error('Missing real deliverables');
      const poster=createPoster({customer:store,workspaceName:context.workspaceName,artifact});
      if(!buildPosterSVG(poster.poster).includes('<svg'))throw new Error('Poster rendering failed');
      return {engine:artifact.engine,sections:artifact.sections.length,poster:true};
    });
    report.ok=true;
  }catch(error){report.code=error.code||'LIVE_CHECK_FAILED';}
  report.connection=await generator.status();return report;
}
