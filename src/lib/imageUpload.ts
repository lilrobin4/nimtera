export async function optimizedPhoto(file:File):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Unsupported photo');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>16000000)throw new Error('Photo resolution too large');
    const canvas=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let blob:Blob|null=null;
    for(const quality of [.82,.7,.58,.45]) {blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob&&blob.size<=150000)break;}
    if(!blob||blob.size>150000)throw new Error('Photo too complex');
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob!);});
  } finally { bitmap.close(); }
}
