import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest();
export function createAuth({password = '',secure = false,sessionHours = 12,now = () => Date.now()} = {}) {
  const sessions = new Map(), failures = new Map(); const expected = hash(password); const ttl = sessionHours * 3600000;
  const cookie = (token,age) => `motive_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  function cleanup() { for(const [key,entry] of sessions) if(entry.expires<=now())sessions.delete(key);for(const [key,entry] of failures)if(entry.until<=now())failures.delete(key); }
  return {
    enabled:!!password,
    verify(req) {
      if (!password) return true; cleanup();
      const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('motive_session='))?.slice(15);
      const entry=token?sessions.get(hash(token).toString('hex')):null;
      return !!entry && entry.expires>now();
    },
    login(candidate,ip) {
      cleanup();const record=failures.get(ip);if(record?.count>=5)return {ok:false,limited:true};
      if(typeof candidate!=='string'||candidate.length>1000||!timingSafeEqual(hash(candidate),expected)) {
        if(failures.size>10000)failures.clear();
        failures.set(ip,{count:(record?.count||0)+1,until:record?.until||now()+15*60000});return {ok:false,limited:false};
      }
      failures.delete(ip);if(sessions.size>=1000)sessions.delete(sessions.keys().next().value);
      const token=randomBytes(32).toString('base64url');sessions.set(hash(token).toString('hex'),{expires:now()+ttl});
      return {ok:true,cookie:cookie(token,ttl/1000)};
    },
    logout(req) { const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('motive_session='))?.slice(15);if(token)sessions.delete(hash(token).toString('hex'));return cookie('',0); }
  };
}
