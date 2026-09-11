export class AIRequestError extends Error {
  constructor(code,message){super(message);this.code=code;}
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
export async function logout(){await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});}
