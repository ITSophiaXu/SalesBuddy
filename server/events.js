import {AppError} from './protocol.js';
import {progressEvent} from '../execution.js';

export function createEventStream(res,requestId){
  const started=Date.now();
  res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
  res.flushHeaders();
  const write=event=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify({...event,requestId})+'\n');};
  const heartbeat=setInterval(()=>write({type:'heartbeat'}),10000);
  heartbeat.unref();
  function emit(event){
    if(event.type==='progress'){
      const safe=progressEvent(event.stage,event.elapsedMs);
      if(safe)write(safe);
    }else if(event.type==='reply'&&typeof event.text==='string'&&event.text.length<=6000){
      write({type:'reply',text:event.text,reset:event.reset===true});
    }
  }
  emit(progressEvent('received',0));
  return {
    emit,
    demo(){emit(progressEvent('demo',Date.now()-started));},
    result(data){write({type:'result',data});res.end();},
    error(error){
      const known=error instanceof AppError;
      if(!known)process.stderr.write(`[${requestId}] INTERNAL_ERROR\n`);
      write({type:'error',error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'服务出现异常，请稍后重试。'}});
      res.end();
    },
    close(){clearInterval(heartbeat);}
  };
}
