import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const fixture = fileURLToPath(new URL('./s4-real-stdio.mjs', import.meta.url));
const tests = [
  { query: 'แยกโปรเจกต์เพื่อทำงานพร้อมกัน', id: 'claude-skills/nava-workspace-isolation-auditor' },
  { query: 'ตรวจความปลอดภัยเนทีฟ', id: 'claude-skills/nava-native-security-verifier' },
  { query: 'ตรวจรับงานให้พร้อมปล่อยเวอร์ชัน', id: 'claude-skills/nava-project-acceptance-gate' },
  { query: 'ทดสอบออฟไลน์ ระบบย่อยอัตโนมัติของเกม', id: 'claude-skills/lumivara-offline-simulation-qa' },
];
const clients=tests.slice(0,2).map((_,i)=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fixture],stderr:'pipe'});
  const client=new Client({name:'s4-real-stdio-'+i,version:'1.0.0'}, { versionNegotiation:{mode:{pin:'2026-07-28'}} });
  return {transport,client};
});
const observed=[];
try {
  await Promise.all(clients.map(pair=>pair.client.connect(pair.transport)));
  for(const [i,item] of tests.entries()){
    const client=clients[i%2].client;
    const found=await client.callTool({name:'skill_match',arguments:{query:item.query}});
    assert.notEqual(found.isError,true,'MCP skill_match failed');
    assert.equal(found.structuredContent?.skills?.[0]?.id,item.id,'wrong top-match');
    const loaded=await client.callTool({name:'skill_load',arguments:{skillId:item.id}});
    assert.notEqual(loaded.isError,true,'MCP skill_load failed');
    assert.equal(loaded.structuredContent?.loaded,true);
    assert.equal(loaded.structuredContent?.skill?.id,item.id);
    assert.ok(typeof loaded.structuredContent?.skill?.content==='string' && loaded.structuredContent.skill.content.length>100);
    observed.push({query:item.query,selectedId:item.id,contentBytes:Buffer.byteLength(loaded.structuredContent.skill.content)});
  }
  const denied=await clients[0].client.callTool({name:'skill_load',arguments:{skillId:'../escape'}});
  assert.equal(denied.isError,true);
  const none=await clients[1].client.callTool({name:'skill_match',arguments:{query:'ช่วยสรุปอีเมลล่าสุด'}});
  assert.deepEqual(none.structuredContent?.skills,[]);
  process.stdout.write('S4_REAL_STDIO_PASS='+JSON.stringify({processes:2,matched:observed.length,observed,invalidDenied:true,unrelatedUnmatched:true})+'\n');
} finally {
  await Promise.allSettled(clients.map(pair=>pair.client.close()));
}
