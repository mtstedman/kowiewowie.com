// Compress the transport envelope, preserving the native checkpoint and hash.
export async function packCheckpoint(bytes){
 if(bytes.length<65536||typeof CompressionStream!=='function')return {bytes,encoding:'identity',decodedBytes:bytes.length};
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
 const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
 return compressed.length<bytes.length?{bytes:compressed,encoding:'gzip',decodedBytes:bytes.length}:{bytes,encoding:'identity',decodedBytes:bytes.length};
}
export async function unpackCheckpoint(bytes,encoding,decodedBytes){
 if(encoding==='identity')return bytes;
 if(encoding!=='gzip'||typeof DecompressionStream!=='function')throw Error('Checkpoint compression unavailable');
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>decodedBytes)throw Error('Checkpoint decompression limit');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 if(length!==decodedBytes)throw Error('Checkpoint decompression size');
 const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
