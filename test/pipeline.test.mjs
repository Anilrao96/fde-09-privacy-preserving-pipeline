import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/pipeline.mjs';
async function fixture() {
 const s=createService({adminKey:'test-admin',secret:'test-secret',minimumGroupSize:3});
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 return {close:()=>new Promise(resolve=>s.close(resolve)),call:async(method,path,body,authorization='Bearer test-admin')=>{
 const r=await fetch(`http://127.0.0.1:${s.address().port}${path}`,{method,headers:{authorization,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json()};}};
}
const event=(id,subjectId,region='north',consent=true)=>({id,subjectId,region,consent,eventType:'signup'});
test('consent, replay, tenant isolation and distinct-subject suppression',async()=>{
 const f=await fixture();try{
 const body={batchId:'one',events:[event('1','alice'),event('2','bob'),event('3','cara'),event('4','dan','south'),event('5','dan','south'),event('6','dan','south'),event('7','erin','north',false)]};
 assert.equal((await f.call('POST','/tenants/acme/batches',body)).data.accepted,6);
 assert.equal((await f.call('POST','/tenants/acme/batches',body)).data.replayed,true);
 assert.equal((await f.call('POST','/tenants/acme/batches',{...body,events:[event('8','fred')]})).status,409);
 assert.equal((await f.call('POST','/tenants/acme/batches',{batchId:'two',events:[event('1','alice')]})).data.accepted,0);
 await f.call('POST','/tenants/acme/publications');
 assert.deepEqual((await f.call('GET','/tenants/acme/publications/latest?dimension=region')).data.groups,{north:3});
 assert.equal((await f.call('GET','/tenants/other/publications/latest?dimension=region')).status,404);
 assert.equal((await f.call('GET','/metrics',undefined,'test-admin')).status,401);
 assert.equal(JSON.stringify((await f.call('GET','/tenants/acme/audit')).data).includes('alice'),false);
 }finally{await f.close();}
});
test('erasure invalidates reports and prevents replay from restoring erased subjects',async()=>{
 const f=await fixture();try{
 const body={batchId:'one',events:[event('1','alice'),event('2','bob'),event('3','cara')]};
 await f.call('POST','/tenants/acme/batches',body);await f.call('POST','/tenants/acme/publications');
 assert.equal((await f.call('POST','/tenants/acme/erase',{subjectId:'alice'})).data.erased,1);
 assert.equal((await f.call('GET','/tenants/acme/publications/latest?dimension=region')).status,404);
 assert.equal((await f.call('POST','/tenants/acme/batches',body)).data.accepted,0);
 await f.call('POST','/tenants/acme/publications');assert.deepEqual((await f.call('GET','/tenants/acme/publications/latest?dimension=region')).data.groups,{});
 }finally{await f.close();}
});
test('invalid batches are atomic and errors do not echo raw data',async()=>{
 const f=await fixture();try{
 const result=await f.call('POST','/tenants/acme/batches',{batchId:'bad',events:[event('1','alice'),{...event('2','bob'),extra:'raw-secret'}]});
 assert.equal(result.status,400);assert.equal(JSON.stringify(result.data).includes('raw-secret'),false);
 assert.equal((await f.call('GET','/metrics')).data.ingested,0);
 assert.equal((await f.call('POST','/tenants/acme/batches',{batchId:'bad',events:[event('1','alice')]})).data.accepted,1);
 }finally{await f.close();}
});
