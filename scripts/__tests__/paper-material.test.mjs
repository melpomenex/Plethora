import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const base=new URL('../../public/theme-materials/legal-pad/v1/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
test('paper assets retain original-resolution provenance, local packaging and byte/hash integrity',async()=>{
  const source=await readFile(new URL('../../assets/theme-materials/legal-pad/source-4096.png',import.meta.url));
  const original=await sharp(source).metadata();
  assert.equal(original.width,4096);assert.equal(original.height,4096);
  assert.equal(createHash('sha256').update(source).digest('hex'),manifest.source.sha256);
  assert.equal(manifest.source.license,'CC0-1.0');
  let total=0;
  for(const file of manifest.files){
    assert.match(file.name,/^[a-z0-9-]+\.(webp|png)$/);
    const bytes=await readFile(new URL(file.name,base));const info=await sharp(bytes).metadata();
    assert.equal(bytes.length,file.bytes);assert.equal(info.width,file.width);assert.equal(info.height,file.height);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.equal(info.hasAlpha,true);
    total+=bytes.length;
  }
  assert.equal(total,manifest.totalBytes);assert.ok(total<=2.5*1024*1024);
});
test('grain is not empty and material opacity stays bounded at every density',async()=>{
  for(const file of manifest.files){
    const {data,info}=await sharp(await readFile(new URL(file.name,base))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let nonzero=0,max=0;
    for(let i=3;i<data.length;i+=info.channels){max=Math.max(max,data[i]);if(data[i])nonzero++;}
    assert.ok(nonzero>0,`${file.name} must contain actual detail`);
    assert.ok(max<=(file.name.startsWith('grain')?8:3),`${file.name} exceeds opacity bounds`);
  }
});
