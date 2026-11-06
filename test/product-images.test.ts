import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { normalizeProductImage,saveProductImage,readProductImage,validProductImageUrl } from '../src/server/productImages';
import { emptyEnvelope,schemaSql,transaction,type SqlPool } from '../src/server/postgres';
import { PRODUCT_IMAGE_PRESETS } from '../src/lib/productImages';

test('18 photo presets exist locally and are valid raster images',async()=>{
 assert.equal(PRODUCT_IMAGE_PRESETS.length,18);
 for(const photo of PRODUCT_IMAGE_PRESETS) { const bytes=fs.readFileSync(new URL('../public'+photo.url,import.meta.url));assert.equal((await sharp(bytes).metadata()).format,'jpeg'); }
});
test('product photos are re-encoded, bounded and stripped of metadata; SVG/spoofed files rejected',async()=>{
 const bytes=await sharp({create:{width:1500,height:900,channels:3,background:'#eab308'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'Private merchant metadata'}}}).toBuffer();
 const normalized=await normalizeProductImage('data:image/jpeg;base64,'+bytes.toString('base64'));
 const meta=await sharp(normalized).metadata();assert.equal(meta.format,'webp');assert.ok(meta.width!<=1024);assert.equal(meta.exif,undefined);assert.ok(normalized.length<=160000);
 for(const input of ['data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64'),'data:image/png;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),'data:image/png;base64,AAAA','x'.repeat(220001),{}])await assert.rejects(normalizeProductImage(input));
});
test('SQL photos survive separate requests, are deduplicated and cannot be assigned by another merchant',async()=>{
 const db=new PGlite();await db.exec(schemaSql);await db.query("INSERT INTO nimtera_testnet_state(id,state) VALUES('testnet',$1::jsonb)",[JSON.stringify(emptyEnvelope({sellers:[],stores:[],orders:[],products:[],auditLogs:[]}))]);
 const pool:SqlPool={connect:async()=>({query:(sql,params)=>db.query(sql,params),release:()=>{}})};
 try {
  const raw=await sharp({create:{width:32,height:32,channels:3,background:'teal'}}).webp().toBuffer();
  const url=await transaction(pool,()=>saveProductImage('first-shop',raw));
  assert.match(url,/^\/api\/product-images\/[a-f0-9]{32}\.webp$/);
  assert.equal(await transaction(pool,()=>saveProductImage('first-shop',raw)),url);
  assert.equal(await transaction(pool,()=>validProductImageUrl(url,'first-shop')),true);
  assert.equal(await transaction(pool,()=>validProductImageUrl(url,'other-shop')),false);
  assert.equal(await transaction(pool,()=>validProductImageUrl('data:image/svg+xml;base64,AAAA','first-shop')),false);
  assert.equal(await transaction(pool,()=>validProductImageUrl(PRODUCT_IMAGE_PRESETS[0].url,'first-shop')),true);
  const restored=await transaction(pool,()=>readProductImage(url.split('/').pop()!.slice(0,-5)));assert.deepEqual(restored,raw);
  assert.equal((await db.query('SELECT id FROM nimtera_product_images')).rows.length,1);
  assert.equal(JSON.stringify((await db.query<any>("SELECT state FROM nimtera_testnet_state WHERE id='testnet'")).rows[0].state).includes(raw.toString('base64')),false);
 } finally {await db.close();}
});
