import sharp from 'sharp';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requestState } from './requestState.js';
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_PRESETS } from '../lib/productImages.js';
interface Queryable { query: (sql:string,values?:any[])=>Promise<any> }
const urlFor=(id:string)=>`/api/product-images/${id}.webp`;
const imageId=(url:string)=>url.match(/^\/api\/product-images\/([a-f0-9]{32})\.webp$/)?.[1];
function localDirectory() {
  if (process.env.VERCEL) throw new Error('Durable photo storage is unavailable');
  return path.join(path.dirname(path.resolve(process.env.NIMTERA_DATA_FILE || '.data/store.json')),'product-images');
}
export async function normalizeProductImage(data:unknown):Promise<Buffer> {
  if (typeof data!=='string' || data.length>220000) throw new Error('Photo payload is too large. Choose a smaller image.');
  const match=data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('Only JPG, PNG and WebP photos are accepted.');
  const bytes=Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>MAX_PRODUCT_IMAGE_BYTES) throw new Error('Photo exceeds the optimized upload limit.');
  const source=sharp(bytes,{limitInputPixels:16000000,animated:false});
  const meta=await source.metadata();
  if (!['jpeg','png','webp'].includes(meta.format || '') || (meta.pages || 1)>1 || !meta.width || !meta.height) throw new Error('Choose a valid still photo.');
  const output=await source.rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
  if (output.length>MAX_PRODUCT_IMAGE_BYTES) throw new Error('Photo is too complex. Choose a smaller image.');
  return output; // Re-encoding strips metadata and never serves the original upload.
}
export async function saveProductImage(owner:string,bytes:Buffer):Promise<string> {
  const digest=createHash('sha256').update(bytes).digest('hex');
  const sql=requestState.getStore()?.sqlClient;
  if (sql) {
    const existing=await sql.query('SELECT id FROM nimtera_product_images WHERE owner_slug=$1 AND digest=$2',[owner,digest]);
    if (existing.rows[0]) return urlFor(existing.rows[0].id);
    const count=await sql.query('SELECT count(*)::int AS count FROM nimtera_product_images WHERE owner_slug=$1',[owner]);
    if (count.rows[0].count>=100) throw new Error('Your shop photo library has reached its 100-photo limit.');
    const id=randomBytes(16).toString('hex');
    await sql.query('INSERT INTO nimtera_product_images(id,owner_slug,digest,content) VALUES($1,$2,$3,$4)',[id,owner,digest,bytes]);
    return urlFor(id);
  }
  const dir=localDirectory();fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const files=fs.readdirSync(dir).filter(name=>name.endsWith('.json'));
  let count=0;
  for (const name of files) { const meta=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));if(meta.owner===owner) {count++;if(meta.digest===digest)return urlFor(name.slice(0,-5));} }
  if(count>=100)throw new Error('Your shop photo library has reached its 100-photo limit.');
  const id=randomBytes(16).toString('hex');fs.writeFileSync(path.join(dir,id+'.webp'),bytes,{mode:0o600});fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({owner,digest}),{mode:0o600});return urlFor(id);
}
export async function readProductImage(id:string,sql?:Queryable):Promise<Buffer|null> {
  if(!/^[a-f0-9]{32}$/.test(id))return null;
  sql ||= requestState.getStore()?.sqlClient;
  if(sql) {const result=await sql.query('SELECT content FROM nimtera_product_images WHERE id=$1',[id]);return result.rows[0]?Buffer.from(result.rows[0].content):null;}
  const file=path.join(localDirectory(),id+'.webp');return fs.existsSync(file)?fs.readFileSync(file):null;
}
export async function validProductImageUrl(url:string,owner:string):Promise<boolean> {
  if(PRODUCT_IMAGE_PRESETS.some(photo=>photo.url===url))return true;
  const id=imageId(url);if(!id)return false;
  const sql=requestState.getStore()?.sqlClient;
  if(sql)return Boolean((await sql.query('SELECT id FROM nimtera_product_images WHERE id=$1 AND owner_slug=$2',[id,owner])).rows[0]);
  const file=path.join(localDirectory(),id+'.json');return fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).owner===owner;
}
