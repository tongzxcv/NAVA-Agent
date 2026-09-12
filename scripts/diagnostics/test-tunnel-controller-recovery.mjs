import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repository = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(repository,'apps/desktop/package.json'));
const {build} = require('esbuild');
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node test-tunnel-controller-recovery.mjs <isolated tunnel-client.exe>');
const buildRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nava-recovery-build-'));
for (const [source,output] of [['tunnel-controller','controller'],['tunnel-connection-monitor','monitor']]) {
 await build({entryPoints:[path.join(repository,'apps/desktop/src/main',source+'.ts')],bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},outfile:path.join(buildRoot,output+'.mjs'),logLevel:'silent'});
}
const {TunnelController}=await import(pathToFileURL(path.join(buildRoot,'controller.mjs')).href);
const {TunnelConnectionMonitor}=await import(pathToFileURL(path.join(buildRoot,'monitor.mjs')).href);
const root=path.join(buildRoot,'fixture'); fs.mkdirSync(root,{recursive:true});
process.env.APPDATA=root;
const profile=path.join(root,'tunnel-client'); fs.mkdirSync(profile);
const marker=path.join(root,'hang');
const pidFile=path.join(root,'mcp.pid');
const stub=path.join(root,'stub.cjs');
fs.writeFileSync(stub,`const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); let hung=false; require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line); if(q.id===undefined)return; hung ||= fs.existsSync(${JSON.stringify(marker)}); if(hung)return; const result=q.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'recovery-fixture',version:'1'}}:{}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');}); process.stdin.on('end',()=>process.exit(0));`);
const cp=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json'); if(req.url.includes('/poll'))await new Promise(r=>setTimeout(r,100)); res.end(JSON.stringify(req.url.includes('/poll')?{commands:[]}:{id:'tunnel_00000000000000000000000000000000',name:'fixture'}));});
await new Promise(r=>cp.listen(0,'127.0.0.1',r));
const yaml=`config_version: 1
control_plane:
  base_url: http://127.0.0.1:${cp.address().port}
  tunnel_id: tunnel_00000000000000000000000000000000
  api_key: env:CONTROL_PLANE_API_KEY
health:
  listen_addr: 127.0.0.1:18082
log:
  level: info
  format: json
mcp:
  commands:
    - channel: main
      command: '"${process.execPath.replaceAll('\\','/')}" "${stub.replaceAll('\\','/')}"'
`;
fs.writeFileSync(path.join(profile,'lnwjud.yaml'),yaml);
fs.writeFileSync(path.join(profile,'lnwjud.runtime.secret'),'fixture-encrypted');
const authority=JSON.stringify({connectionEpoch:1,binding:'unchanged',pairing:'unchanged'});
fs.writeFileSync(path.join(root,'authority-fixture.json'),authority);
const controller=new TunnelController({getClientPath:()=>path.resolve(executable),setClientPath:()=>{},getDataPath:()=>root,isExternalTunnelRunning:async()=>false,decryptSecret:async()=>'local-fixture-only',maxAutoRestarts:()=>2});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const monitor=new TunnelConnectionMonitor(); const alerts=[];
const observe=(status,health,time)=>{const result=monitor.observe({...status,health},time);alerts.push(...result.alerts.map(a=>a.kind));return result;};
try {
 const start=await controller.start(); assert.equal(start.state,'running',start.message);
 await delay(1200);
 const first=Number(fs.readFileSync(pidFile,'utf8'));
 const healthy=await controller.gatewayHealth(); console.log('before',first,healthy.overall,healthy.requestPath); assert.equal(healthy.overall,'live'); controller.observeHealth(healthy);
 observe(await controller.status(),healthy,0);
 fs.writeFileSync(marker,'hang ping responses');
 for(const n of [0,6000,12000]) {const h=await controller.gatewayHealth(); console.log('failure',h.requestPath); assert.equal(h.requestPath.state,'unhealthy'); controller.observeHealth(h,Date.now()+n); observe(await controller.status(),h,n+1000);}
 fs.unlinkSync(marker);
 let recovered=false;
 for(let n=0;n<35;n++){await delay(500);const status=await controller.status();const h=await controller.gatewayHealth();const next=Number(fs.readFileSync(pidFile,'utf8')); if(next!==first&&h.overall==='live'){console.log('recovered',next,status.state,h.overall); observe(status,h,25000); recovered=true; break;}}
 assert(recovered,'controller did not automatically recover');
 assert.deepEqual(alerts,['lost','recovering','recovered']); console.log('notification-events',alerts);
 const second=Number(fs.readFileSync(pidFile,'utf8')); process.kill(second);
 let deathRecovered=false;
 for(let n=0;n<40;n++){await delay(500);const h=await controller.gatewayHealth(); controller.observeHealth(h);const next=Number(fs.readFileSync(pidFile,'utf8')); if(next!==second&&h.overall==='live'){console.log('child-death-recovered',second,'->',next);deathRecovered=true;break;}}
 assert(deathRecovered,'unexpected child death did not recover');
 assert.equal(fs.readFileSync(path.join(profile,'lnwjud.yaml'),'utf8'),yaml);
 assert.equal(fs.readFileSync(path.join(root,'authority-fixture.json'),'utf8'),authority);
 console.log('PASS: actual controller + tunnel + child automatic recovery; profile/epoch/binding fixture unchanged');
} finally {await controller.stop(); cp.closeAllConnections();cp.close();}
