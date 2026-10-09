import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unpack,index,statistics,crossings,sampledMinutes,clock} from '../web/data.js';
const data=unpack(JSON.parse(readFileSync(new URL('../docs/data/replay.json',import.meta.url),'utf8')));
const stats=statistics(data,30,20);
test('decoded browser data match full precision Python event within quantization tolerance',()=>{
  const truth=JSON.parse(readFileSync(new URL('../artifacts/at-1407.json',import.meta.url),'utf8'));
  Object.values(truth.series).forEach((v,j)=>{
    const b=(2*391+277)*8+j;
    assert.ok(Math.abs(data.values[index(30,2,277,j)]-v.value)<=1e-5);
    assert.ok(Math.abs(stats.z[b]-v.z)<.025);
    assert.equal(stats.count[b],v.count);
  });
  assert.ok(stats.z[(2*391+277)*8+1]>3);
});
test('browser baseline excludes current session and future sessions',()=>{
  const before=statistics(data,20,20);
  const modified={...data,values:data.values.slice()};
  modified.values.fill(1000,index(20,0,0,0));
  const after=statistics(modified,20,20);
  assert.deepEqual(before.mean,after.mean);assert.deepEqual(before.std,after.std);
});
test('half-day holes, insufficient history and expiry survive binary encoding',()=>{
  assert.ok(Number.isNaN(data.values[index(8,2,300,1)]));
  assert.ok(Number.isNaN(data.values[index(30,0,390,1)]));
  assert.ok(statistics(data,7,30).z.every(Number.isNaN));
  assert.equal(stats.count[(2*391+277)*8+1],19);
});
test('sampling and threshold crossings are causal',()=>{
  assert.deepEqual(sampledMinutes(391,300,12),[0,5,10]);
  assert.deepEqual(sampledMinutes(391,30,2),[0,.5,1,1.5,2]);
  assert.equal(clock(277.5),'14:07:30');
  const alerts=crossings(stats,2,391);
  assert.ok(alerts.some(c=>c.j===1&&c.threshold===3&&c.m>=270));
  assert.ok(!alerts.filter(c=>c.m<270).some(c=>c.j===1&&c.threshold===3));
});
