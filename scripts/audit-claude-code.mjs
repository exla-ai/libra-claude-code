#!/usr/bin/env node
// Real installed Claude Code, isolated fixture repo, local API only. No customer data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const plugin=path.resolve(option('--plugin-dir',path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));
const report=path.resolve(option('--report',path.join(os.tmpdir(),'libra-real-cli-audit.json')));
const work=fs.mkdtempSync(path.join(os.tmpdir(),'libra-real-cli-audit-'));
spawnSync('git',['init','--quiet'],{cwd:work});
spawnSync('git',['remote','add','origin','https://github.com/acme/libra-audit-fixture.git'],{cwd:work});
const requests=[];
const policy={rev:'audit',idleMs:600000,stopSettleMs:30000,doneOnShip:true,newsEveryMs:600000,activeWindowMs:7200000,contextMaxAgeMs:600000,heldMaxMs:86400000,investigationWatchMs:900000,watcherPollMs:45000,watcherMaxMs:1500000,feedbackAskEveryMs:86400000,quiet:false};
const server=http.createServer((req,res)=>{
 let body='';req.on('data',chunk=>{body+=chunk;if(body.length>1000000)req.destroy();});
 req.on('end',()=>{
  let data={};try{data=JSON.parse(body);}catch{}
  requests.push({url:req.url,hook:data.metadata?.hookEvent,contract:data.plugin?.contract,version:data.plugin?.version,phase:data.plugin?.state?.phase,events:(data.events||[]).map(e=>e.type)});
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({ok:true,sessionId:'audit',accepted:(data.events||[]).length,contract:2,policy,evaluated:[],notes:[],inbox:{prs:[]}}));
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,LIBRA_API_URL:`http://127.0.0.1:${server.address().port}`,LIBRA_API_TOKEN:'audit-only-not-a-live-key',LIBRA_PLUGIN_SELF_UPDATE:'0',LIBRA_HOOK_FLUSH:'inline'};
for(const name of ['CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','CLAUDE_AGENT_SDK_VERSION'])delete env[name];
let stdout='',stderr='',timedOut=false;
const child=spawn('claude',['--print','--plugin-dir',plugin,'--output-format','json','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Bash','--allowedTools','Bash','--max-turns','3','--setting-sources','project','Use Bash to run printf LIBRA_PLUGIN_AUDIT_OK, then reply with exactly LIBRA_PLUGIN_AUDIT_OK. Do not read or edit files.'],{cwd:work,env,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},90000);
const code=await new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('exit',resolve);});clearTimeout(timer);
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>server.close(resolve));
const checks={processSucceeded:code===0&&!timedOut,sessionStart:requests.some(r=>r.hook==='SessionStart'),prompt:requests.some(r=>r.hook==='UserPromptSubmit'),tool:requests.some(r=>['PreToolUse','PostToolUse'].includes(r.hook)),stop:requests.some(r=>r.hook==='Stop'),allContract2:requests.length>0&&requests.every(r=>r.contract===2&&r.version==='2.0.0'),expectedAnswer:stdout.includes('LIBRA_PLUGIN_AUDIT_OK')};
const result={verifiedAt:new Date().toISOString(),claudeVersion:spawnSync('claude',['--version'],{encoding:'utf8'}).stdout.trim(),plugin,code,timedOut,checks,requests,outputBytes:Buffer.byteLength(stdout),errorBytes:Buffer.byteLength(stderr),passed:Object.values(checks).every(Boolean)};
fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2),{mode:0o600});
// Raw CLI output can contain account metadata; only bounded local failure context remains private.
if(!result.passed){fs.writeFileSync(report+'.stderr',stderr,{mode:0o600});fs.writeFileSync(report+'.stdout',stdout,{mode:0o600});}
fs.rmSync(work,{recursive:true,force:true});
console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
