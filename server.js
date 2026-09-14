import { readFile } from 'node:fs/promises';
import { createApplication, configFromEnv } from './server/http.js';
import { CopilotGenerator } from './server/copilot.js';
import {loadEnvironment,copilotOptions} from './server/environment.js';

await loadEnvironment();
const config = configFromEnv(process.env);
if (process.env.MOTIVE_PASSWORD_FILE) config.password = (await readFile(process.env.MOTIVE_PASSWORD_FILE,'utf8')).trim();
const generator = new CopilotGenerator({...await copilotOptions(),timeoutMs:config.timeoutMs,maxConcurrent:config.maxConcurrent});
const server = createApplication({config,generator});
server.listen(config.port,config.host,()=>process.stdout.write(`Motive listening on ${config.host}:${config.port}; provider=${config.provider}\n`));
server.on('error',error=>{process.stderr.write(`Motive failed to start (${error.code || 'SERVER_ERROR'}).\n`);process.exitCode=1;});
let closing=false;
async function shutdown() {
  if(closing)return;closing=true;
  server.close();
  const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();
  try {await generator.stop();}finally{server.closeAllConnections();clearTimeout(timeout);}
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
