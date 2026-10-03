import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.PIPELINE_URL ?? 'http://127.0.0.1:3009';
const key=process.env.PIPELINE_ADMIN_KEY ?? 'local-admin';
const tenant=`demo-${randomUUID().slice(0,8)}`;
async function call(method,path,body,status=200){
 const r=await fetch(`${base}/tenants/${tenant}${path}`,{method,headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,status);return data;
}
const event=(id,subjectId,region='north',consent=true)=>({id,subjectId,region,consent,eventType:'signup'});
const body={batchId:'demo',events:[event('1','alice'),event('2','bob'),event('3','cara'),event('4','dan','south'),event('5','erin','north',false)]};
assert.equal((await call('POST','/batches',body,201)).accepted,4);
assert.equal((await call('POST','/batches',body)).replayed,true);
await call('POST','/publications',undefined,201);
const before=await call('GET','/publications/latest?dimension=region');assert.deepEqual(before.groups,{north:3});
assert.equal((await call('POST','/erase',{subjectId:'alice'})).erased,1);
await call('GET','/publications/latest?dimension=region',undefined,404);
await call('POST','/publications',undefined,201);assert.deepEqual((await call('GET','/publications/latest?dimension=region')).groups,{});
console.log(JSON.stringify({tenant,consentedEvents:4,replayVerified:true,releasedRegions:before.groups,erasureVerified:true},null,2));
