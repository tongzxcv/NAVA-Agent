import http from 'node:http';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node test-tunnel-retirement.mjs <isolated tunnel-client.exe>');
const root = path.join(os.tmpdir(), 'nava-tunnel-retirement-' + Date.now());
mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, 'stub.cjs'), `const rl=require('node:readline').createInterface({input:process.stdin}); rl.on('line',s=>{ const q=JSON.parse(s); if(q.id===undefined)return; const result=q.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{content:[{type:'text',text:'OK'}]}; setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n'),q.params?.name==='slow'?1500:0); });`);
const queue=[], responses=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url.includes('/poll')) { await new Promise(r=>setTimeout(r,50)); res.end(JSON.stringify({commands:queue.splice(0)})); }
 else if(req.url.endsWith('/response')) { let body=''; for await(const b of req)body+=b; const p=JSON.parse(body); responses.set(p.request_id,p); res.end('{}'); }
 else res.end(JSON.stringify({id:'tunnel_00000000000000000000000000000000',name:'local fixture'}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const child=spawn(executable,['run','--control-plane.base-url',`http://127.0.0.1:${server.address().port}`,'--control-plane.tunnel-id','tunnel_00000000000000000000000000000000','--mcp.command',`"${process.execPath.replaceAll('\\','/')}" "${path.join(root,'stub.cjs').replaceAll('\\','/')}"`,'--health.listen-addr','127.0.0.1:18081','--profile-dir',root,'--log.file',path.join(root,'tunnel.log')],{windowsHide:true,env:{...process.env,TUNNEL_API_KEY:'local-fixture-only',CONTROL_PLANE_API_KEY:'local-fixture-only'},stdio:['ignore','pipe','pipe']});
let errors=''; child.stderr.on('data',b=>{errors+=b.toString()}); child.stdout.resume();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function call(label,id,method,params={},timeout='3s') {
 queue.push({request_id:label,shard_token:'fixture',command_type:'jsonrpc',channel:'main',created_at:new Date().toISOString(),response_timeout:timeout,jsonrpc:{jsonrpc:'2.0',id,method,params}});
 for(let i=0;i<45&&!responses.has(label)&&child.exitCode===null;i++)await delay(100);
 const p=responses.get(label); if(label !== 'timeout') assert.equal(p?.resp_code,200,label); console.log(JSON.stringify({label,childAlive:child.exitCode===null,response:p??null}));
}
try {
 await delay(1500);
 if(child.exitCode!==null)throw new Error(errors.slice(-2000));
 await call('initial',0,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
 assert.equal((await (await globalThis.fetch('http://127.0.0.1:18081/api/mcp-health')).json()).state,'live');
 await call('before',0,'tools/call',{name:'health'});
 await call('timeout',0,'tools/call',{name:'slow'},'300ms');
 await delay(1800);
 await call('same-id-after',0,'tools/call',{name:'health'});
 await call('same-id-again',0,'tools/call',{name:'health'});
 await call('different-id',99,'tools/call',{name:'health'});
 await call('same-id-final',0,'tools/call',{name:'health'});
} finally {
 child.kill(); await delay(500); server.closeAllConnections(); server.close();
}
