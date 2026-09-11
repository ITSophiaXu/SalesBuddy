export class AIRequestError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
export function describeAIConnection(status={}) {
  if(status.ready)return {title:status.provider==='demo'?'本地演示模式':'Copilot 已连接',message:status.message||'',nextStep:''};
  const details={
    CHECKING:['正在检查 Copilot 连接','连接检查完成后会在这里显示结果。',''],
    NOT_CHECKED:['Copilot 尚未检查','检查连接后即可了解服务是否就绪。','点击“重新检查”获取当前状态。'],
    SDK_NOT_INSTALLED:['Copilot 服务组件未安装','缺少 Copilot SDK，暂时无法对话或生成成果。','请在运行 Motive 的电脑或服务器安装项目依赖，再检查连接；依赖就绪后，还需确认 Copilot CLI 和服务账户登录。'],
    COPILOT_AUTH_REQUIRED:['Copilot 尚未登录','服务已启动，但运行服务的账户还没有登录 Copilot。','请为运行 Motive 的账户完成 Copilot CLI 登录，再检查连接。浏览器中的 GitHub 登录不会自动用于服务端。'],
    COPILOT_UNAVAILABLE:['Copilot 服务未能启动','请检查服务端的 Copilot CLI、账户登录和网络连接。','请查看服务端运行记录，确认 Copilot CLI 路径、登录状态及网络后再检查连接。'],
    LOGIN_REQUIRED:['工作区需要登录','登录 Motive 工作区后才能检查模型连接。','请刷新页面并登录工作区。'],
    OFFLINE:['暂时无法连接对话服务','请确认 Motive 服务正在运行，然后重新检查。','请确认运行 Motive 的电脑或服务器可访问，再检查连接。']
  };
  const [title,message,nextStep]=details[status.code]||['Copilot 尚未连接',status.message||'暂时无法获取连接状态。','请稍后重新检查；若仍失败，请查看服务端运行记录。'];
  return {title,message,nextStep};
}
async function jsonResponse(response){
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw new AIRequestError(body?.error?.code||'SERVICE_ERROR',body?.error?.message||'服务暂时不可用，请稍后重试。');
  return body;
}
export async function getAIStatus(){
  try{return await jsonResponse(await fetch('/api/status',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)}));}
  catch(error){return {provider:'copilot',ready:false,code:error.code||'OFFLINE',message:error.message||'无法连接模型服务。',model:'Copilot',authentication:error.code==='LOGIN_REQUIRED'};}
}
export async function generateAIArtifact(payload,{signal}={}){
  const result=await jsonResponse(await fetch('/api/generate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(160000)]):AbortSignal.timeout(160000)}));
  if(!result?.artifact?.id||!Array.isArray(result.artifact.sections))throw new AIRequestError('INVALID_RESPONSE','服务返回了不完整的交付物。');
  return result.artifact;
}
export async function sendChatMessage(payload,{signal}={}){
  const result=await jsonResponse(await fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(160000)]):AbortSignal.timeout(160000)}));
  if(!['reply','clarify','artifact'].includes(result?.mode)||typeof result.reply!=='string'||(result.mode==='artifact'&&!result.artifactRequest))throw new AIRequestError('INVALID_RESPONSE','服务返回了不完整的对话。');
  return result;
}
export async function logout(){await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});}
