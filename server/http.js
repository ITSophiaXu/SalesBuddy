import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createAuth} from './auth.js';
import {AppError,normalizeRequest} from './protocol.js';
import {draftArtifact} from '../domain.js';

const root = new URL('../',import.meta.url);
const files = new Map([
  ['/','index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js'],
  ['/domain.js','domain.js'],['/data.js','data.js'],['/ai-client.js','ai-client.js'],['/poster.js','poster.js'],['/cowork.js','cowork.js'],['/cowork-ui.js','cowork-ui.js'],['/cowork.css','cowork.css'],['/assets/favicon.svg','assets/favicon.svg']
]);
const mime = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml'};
function number(value,fallback,min,max) {const n=value==null||value===''?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid numeric server configuration');return n;}
export function configFromEnv(env) {
  return {host:env.HOST||'127.0.0.1',port:number(env.PORT,4173,1,65535),production:env.NODE_ENV==='production',
    provider:env.AI_PROVIDER||'copilot',authMode:env.MOTIVE_AUTH_MODE||'password',password:env.MOTIVE_PASSWORD||'',publicOrigin:env.PUBLIC_ORIGIN?.replace(/\/$/,'')||'',
    timeoutMs:number(env.COPILOT_TIMEOUT_MS,120000,1000,300000),maxConcurrent:number(env.MOTIVE_MAX_CONCURRENT,2,1,8)};
}
function json(res,status,body) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function loginPage(error='') {return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · Motive</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/styles.css"></head><body><main class="login-layout"><section class="login-card"><img src="/assets/favicon.svg" width="48" height="48" alt="Motive"><p class="eyebrow">AUTOMOTIVE COWORK</p><h1>让下一程，从这里开始。</h1><p class="muted">登录你的汽车营销协作空间。</p><form action="/login" method="post"><label class="field-label" for="password">工作区访问密码</label><input class="field" id="password" type="password" name="password" required autocomplete="current-password" autofocus maxlength="1000">${error?`<p class="login-error">${error}</p>`:''}<button class="btn primary" type="submit">进入工作区 →</button></form><p class="small muted">模型凭据保留在服务器，浏览器不会接收 GitHub 令牌。</p></section></main></body></html>`;}
async function body(req,max=400000) {let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>max){req.resume();throw new AppError('PAYLOAD_TOO_LARGE','请求过大，请减少本次引用的资料。',413);}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}

export function createApplication({config,generator}) {
  if(!['copilot','demo'].includes(config.provider))throw new Error('AI_PROVIDER must be copilot or demo');
  if(!['password','none'].includes(config.authMode))throw new Error('MOTIVE_AUTH_MODE must be password or none');
  const external=!['127.0.0.1','::1','localhost'].includes(config.host);
  if(config.authMode==='password'&&(config.production||external)&&config.password.length<16)throw new Error('A workspace password of at least 16 characters is required');
  if(config.production&&!config.publicOrigin)throw new Error('PUBLIC_ORIGIN is required in production');
  let origin;
  if(config.publicOrigin){origin=new URL(config.publicOrigin);if(origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash||!['http:','https:'].includes(origin.protocol))throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin');if(origin.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new Error('A public origin must use HTTPS');}
  const loopbackOrigin=origin&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname);
  if(config.authMode==='none'&&(config.production||external)&&!loopbackOrigin)throw new Error('Passwordless access is only allowed with a loopback PUBLIC_ORIGIN');
  const auth=createAuth({password:config.authMode==='password'?config.password:'',secure:origin?.protocol==='https:'});
  const quotas=new Map();
  function checkOrigin(req) {const expected=config.publicOrigin||`http://${req.headers.host}`;if(req.headers.origin&&req.headers.origin!==expected)throw new AppError('ORIGIN_DENIED','请求来源不匹配。',403);if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('ORIGIN_DENIED','不接受跨站请求。',403);}
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz'&&req.method==='GET')return json(res,200,{ok:true,service:'motive',version:'1.2.0'});
      const requestedHost=new URL(`http://${req.headers.host||'localhost'}`).hostname;
      if(origin?requestedHost!==origin.hostname:!['127.0.0.1','localhost','[::1]'].includes(requestedHost))throw new AppError('HOST_DENIED','主机名不匹配。',403);
      if(url.pathname==='/login') {
        if(!auth.enabled){res.writeHead(303,{'Location':'/','Cache-Control':'no-store'});return res.end();}
        if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(loginPage());}
        if(req.method!=='POST')throw new AppError('METHOD_NOT_ALLOWED','不支持的请求方法。',405);
        checkOrigin(req);const fields=new URLSearchParams(await body(req,4096));const result=auth.login(fields.get('password'),req.socket.remoteAddress);
        if(result.ok){res.writeHead(303,{'Location':'/','Set-Cookie':result.cookie,'Cache-Control':'no-store'});return res.end();}
        res.writeHead(result.limited?429:401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(loginPage(result.limited?'尝试次数过多，请 15 分钟后再试。':'密码不正确，请重试。'));
      }
      const publicFile=['/styles.css','/assets/favicon.svg'].includes(url.pathname)&&req.method==='GET';
      if(!publicFile&&!auth.verify(req)) {if(url.pathname.startsWith('/api/'))throw new AppError('LOGIN_REQUIRED','请先登录工作区。',401);res.writeHead(302,{'Location':'/login','Cache-Control':'no-store'});return res.end();}
      if(url.pathname==='/api/status'&&req.method==='GET'){
        const ai=config.provider==='demo'?{provider:'demo',ready:true,code:'DEMO',message:'当前明确使用本地模板演示，未调用大模型。',model:'本地场景模板'}:await generator.status({probe:true});
        return json(res,200,{...ai,authentication:auth.enabled,storage:'browser',scheduler:'browser',version:'1.2.0'});
      }
      if(url.pathname==='/api/logout'&&req.method==='POST'){checkOrigin(req);res.setHeader('Set-Cookie',auth.logout(req));return json(res,200,{ok:true});}
      if(url.pathname==='/api/generate'&&req.method==='POST'){
        checkOrigin(req);if(!(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('CONTENT_TYPE','请求必须为 JSON。',415);
        const key=createHash('sha256').update(req.headers.cookie||req.socket.remoteAddress||'local').digest('hex');const now=Date.now();
        for(const [k,v] of quotas)if(now-v.started>60000)quotas.delete(k);
        const quota=quotas.get(key)||{started:now,count:0};if(quota.count>=20)throw new AppError('RATE_LIMITED','请求过于频繁，请稍后再试。',429);quota.count++;quotas.set(key,quota);
        let input;try{input=JSON.parse(await body(req));}catch(error){if(error instanceof AppError)throw error;throw new AppError('INVALID_JSON','请求不是有效 JSON。');}
        const request=normalizeRequest(input);
        const controller=new AbortController();const onClose=()=>{if(!res.writableEnded)controller.abort();};res.once('close',onClose);
        try {
          let artifact;
          if(config.provider==='demo')artifact={...draftArtifact(request.kind,request.customer,request.vehicles,request.prompt,request.knowledge,{preferredVehicleId:request.preferredVehicleId,campaign:request.campaign,workspaceName:request.workspaceName,workflow:request.workflow,businessContext:request.businessContext,cohort:request.cohort,needsPoster:request.needsPoster}),engine:'demo',model:'本地场景模板'};
          else artifact=await generator.generate(request,{signal:controller.signal});
          if(!res.destroyed)json(res,200,{artifact,requestId});
        }finally{res.off('close',onClose);}
        return;
      }
      if(url.pathname.startsWith('/api/'))throw new AppError('NOT_FOUND','接口不存在或请求方法不正确。',404);
      if(!['GET','HEAD'].includes(req.method))throw new AppError('METHOD_NOT_ALLOWED','不支持的请求方法。',405);
      const file=files.get(url.pathname);if(!file)throw new AppError('NOT_FOUND','页面不存在。',404);
      const content=await readFile(new URL(file,root));
      res.writeHead(200,{'Content-Type':mime[file.split('.').pop()]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      const known=error instanceof AppError;if(!known)process.stderr.write(`[${requestId}] INTERNAL_ERROR\n`);
      if(!res.headersSent&&!res.destroyed)json(res,known?error.status:500,{error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'服务出现异常，请稍后重试。'},requestId});
      else if(!res.destroyed)res.end();
    }
  });
  server.requestTimeout=300000;server.headersTimeout=15000;
  return server;
}
