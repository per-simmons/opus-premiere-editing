'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const {read,fingerprint}=require('./engine.cjs');
function paths(directory,id){if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))throw new Error('Invalid request ID');return {command:path.join(directory,'command-'+id+'.json'),journal:path.join(directory,'journal',id+'.json'),response:path.join(directory,'response-'+id+'.json')};}
function status(directory,id){const p=paths(directory,id);return read(p.journal)||read(p.response)||(fs.existsSync(p.command)?{id,status:'queued'}:{id,status:'unknown'});}
function submit(directory,id,script,domain){
  const p=paths(directory,id),old=read(p.journal),hash=fingerprint(script);
  if(old){if(old.hash!==hash)throw new Error('Request ID conflict');return old;}
  const pending=read(p.command);
  if(pending){if(fingerprint(pending.script)!==hash)throw new Error('Request ID conflict');return {id,status:'queued'};}
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const tmp=p.command+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  const fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({id,script,domain,timestamp:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(tmp,p.command);}finally{fs.unlinkSync(tmp);}
  return {id,status:'queued'};
}
module.exports={submit,status};
// Never delete requests or generate replacement IDs on timeout. Poll status independently.
if(require.main===module){
  const [directory,action,id,input]=process.argv.slice(2);
  if(!directory || !['status','submit','submit-legacy'].includes(action) || !id)throw new Error('Usage: node client.cjs DIRECTORY status ID | DIRECTORY submit ID DOMAIN-REQUEST.json | DIRECTORY submit-legacy ID REVIEWED.jsx');
  if(action==='status')console.log(JSON.stringify(status(directory,id),null,2));
  else if(action==='submit-legacy'){console.log(JSON.stringify(submit(directory,id,fs.readFileSync(input,'utf8')),null,2));}
  else{const request=JSON.parse(fs.readFileSync(input,'utf8'));const script=require('./domain.cjs').compile(request.command,request.guard);console.log(JSON.stringify(submit(directory,id,script,request),null,2));}
}
