import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {requestChatResponse} from '../local/upstream-chat.mjs';

async function listen(handler,context) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  context.after(()=>{server.closeAllConnections();server.close();});
  return 'http://127.0.0.1:'+server.address().port;
}
test('upstream chat uses its explicit deadline instead of fetch header timers',async context=>{
  const url=await listen((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer fixture-only');
    setTimeout(()=>res.end('{"ok":true}'),100);
  },context);
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('fetch must not be used for upstream chat');};
  try {
    const result=await requestChatResponse(url,{authorization:'Bearer fixture-only',body:'{}',timeoutMs:1000});
    assert.equal(result.ok,true);
    assert.equal(result.body,'{"ok":true}');
  } finally {globalThis.fetch=original;}
});
test('native chat transport still rejects excessive duration and response size',async context=>{
  const slow=await listen((req,res)=>setTimeout(()=>res.end('{}'),150),context);
  await assert.rejects(requestChatResponse(slow,{authorization:'Bearer fixture-only',body:'{}',timeoutMs:30}));
  const large=await listen((req,res)=>res.end('x'.repeat(100)),context);
  await assert.rejects(requestChatResponse(large,{authorization:'Bearer fixture-only',body:'{}',maxBytes:30}),/安全大小/);
});
