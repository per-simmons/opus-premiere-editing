#!/usr/bin/env node
'use strict';
// Stdio MCP facade only. No host connection, UI control, generic script tool or auto retry.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const client=require('./client.cjs');
const {compile}=require('./domain.cjs');
const {read,fingerprint}=require('./engine.cjs');
const requestIdSchema={type:'string',minLength:1,maxLength:120,pattern:'^[A-Za-z0-9_-]+$'};
const trackSchema={type:'array',maxItems:100,uniqueItems:true,items:{type:'integer',minimum:0,maximum:999}};
const guardSchema={type:'object',additionalProperties:false,required:['projectPath','sequenceId','timebase','videoTracks','audioTracks'],properties:{projectPath:{type:'string',minLength:2,maxLength:4096,pattern:'^/'},sequenceId:{type:'string',minLength:1,maxLength:120},timebase:{type:'string',pattern:'^[1-9][0-9]{0,17}$'},videoTracks:trackSchema,audioTracks:trackSchema}};
const statusSchema={type:'object',additionalProperties:false,required:['requestId'],properties:{requestId:requestIdSchema}};
const domainSchema={type:'object',additionalProperties:false,required:['requestId','guard'],properties:{requestId:requestIdSchema,guard:guardSchema}};
const tools=[
 {name:'premiere_request_status',description:'Read a stable request ID from local files only. No Premiere command is sent. Returns compact metadata and the local full-result path; uncertain is not cancellation.',inputSchema:statusSchema},
 {name:'premiere_snapshot',description:'Submit one read-only native sequence snapshot with exact project/sequence/timebase/occupied-track guards. Supply a stable caller-chosen request ID. Returns queued immediately; use request_status. Repeated IDs never automatically resubmit.',inputSchema:domainSchema},
 {name:'premiere_save_checkpoint',description:'Submit one save of the currently open project, only after exact project/active-sequence/timebase/occupied-track guards pass inside Premiere. Supply a stable caller-chosen request ID; no retries. This does not verify saved-file durability.',inputSchema:domainSchema}
];
function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new Error('Invalid '+label+' fields');}
function validate(args,needsGuard){
 object(args,needsGuard?['requestId','guard']:['requestId'],'arguments');
 if(typeof args.requestId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(args.requestId))throw new Error('Invalid requestId');
 if(!needsGuard)return;
 const g=args.guard;object(g,['projectPath','sequenceId','timebase','videoTracks','audioTracks'],'guard');
 if(typeof g.projectPath!=='string'||g.projectPath.length<2||g.projectPath.length>4096||!path.isAbsolute(g.projectPath)||g.projectPath.includes('\0'))throw new Error('Invalid absolute projectPath');
 if(typeof g.sequenceId!=='string'||!g.sequenceId.trim()||g.sequenceId.length>120||/[\u0000-\u001f]/.test(g.sequenceId))throw new Error('Invalid sequenceId');
 if(typeof g.timebase!=='string'||!/^[1-9][0-9]{0,17}$/.test(g.timebase))throw new Error('timebase must be an exact positive tick string');
 for(const key of ['videoTracks','audioTracks']){const a=g[key];if(!Array.isArray(a)||a.length>100||a.some((n,i)=>!Number.isInteger(n)||n<0||n>999||(i>0&&n<=a[i-1])))throw new Error(key+' must contain ascending unique track indices');}
}
function brief(value,max=500){return String(value).slice(0,max);}
function summary(directory,id,receipt){
 const record=client.status(directory,id),response=record.response || record;
 const result=response.result;
 const out={requestId:id,status:record.status || (response.success===false?'failed':'unknown')};
 const journal=path.join(directory,'journal',id+'.json'),file=path.join(directory,'response-'+id+'.json');
 if(fs.existsSync(journal))out.detailPath=journal;else if(fs.existsSync(file))out.detailPath=file;
 if(receipt && out.status==='unknown'){out.status='submission-unresolved';out.requiresInspection=true;}
 if(['running','uncertain','submission-unresolved'].includes(out.status))out.retrySafe=false;
 if(response.error)out.error=brief(response.error);
 if(result && typeof result==='object'&&!Array.isArray(result)){
   out.snapshot={};const m=out.snapshot;
   for(const k of ['project','sequenceId','name','timebase'])if(result[k]!==undefined)m[k]=brief(result[k],k==='project'?4096:200);
   if(Array.isArray(result.video))m.videoClips=result.video.length;
   if(Array.isArray(result.audio))m.audioClips=result.audio.length;
   if(/^\d+$/.test(String(result.end))){m.endTicks=String(result.end);m.durationSeconds=Number(result.end)/254016000000;if(/^[1-9][0-9]*$/.test(String(result.timebase)))m.durationFrames=Number(result.end)/Number(result.timebase);}
   if(Object.hasOwn(result,'saveReturn')){m.saveReturn=['number','boolean','string'].includes(typeof result.saveReturn)?brief(result.saveReturn):null;m.savedFileVerified=false;}
 }
 return out;
}
class Adapter {
 constructor(directory){if(!path.isAbsolute(directory))throw new Error('Spool must be an absolute path');this.directory=directory;}
 invoke(name,args){
   if(!tools.some(t=>t.name===name))throw new Error('Unknown tool');
   const domainCall=name!=='premiere_request_status';validate(args,domainCall);
   const id=args.requestId,receiptPath=path.join(this.directory,'mcp-requests',id+'.json');
   const old=read(receiptPath);
   if(!domainCall)return summary(this.directory,id,old);
   const domain={command:name==='premiere_snapshot'?'snapshot':'save_checkpoint',guard:args.guard};
   // Deterministic property order avoids conflicts from argument-key order alone.
   domain.guard={projectPath:args.guard.projectPath,sequenceId:args.guard.sequenceId,timebase:args.guard.timebase,videoTracks:args.guard.videoTracks,audioTracks:args.guard.audioTracks};
   const script=compile(domain.command,domain.guard),hash=fingerprint(script);
   if(old){if(old.hash!==hash)throw new Error('Request ID conflict: use status to inspect original request');return summary(this.directory,id,old);}
   const lane=read(path.join(this.directory,'lane-v2.json'));
   if(lane)return {requestId:id,status:'not-submitted',blockedBy:brief(lane.id,120),reason:'Host lane unresolved; inspect that request status. No new command queued.'};
   fs.mkdirSync(path.dirname(receiptPath),{recursive:true,mode:0o700});
   const receipt={id,hash,command:domain.command,createdAt:new Date().toISOString()};
   // Publish a permanent intent before submission; a crash never triggers automatic resubmission.
   const temp=receiptPath+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
   const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(receipt));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   let won=true;
   try{fs.linkSync(temp,receiptPath);}catch(e){if(e.code!=='EEXIST')throw e;won=false;}finally{fs.unlinkSync(temp);}
   if(!won){const other=read(receiptPath);if(!other||other.hash!==hash)throw new Error('Request ID conflict');return summary(this.directory,id,other);}
   try{client.submit(this.directory,id,script,domain);}catch(e){throw new Error('Submission unresolved; inspect stable ID '+id+'. '+brief(e.message));}
   return summary(this.directory,id,receipt);
 }
}
function sdkRoot(){return process.env.PREMIERE_MCP_SDK_ROOT || path.join(os.homedir(),'mcp-servers/premiere-pro/node_modules/@modelcontextprotocol/sdk');}
async function loadSdk(relative){return import(pathToFileURL(path.join(sdkRoot(),'dist',relative)).href);}
async function main(){
 const directory=process.env.PREMIERE_V2_TEMP_DIR || path.join(os.homedir(),'.premiere-mcp-bridge-v2');
 const adapter=new Adapter(directory);
 const [{Server},{StdioServerTransport},types]=await Promise.all([loadSdk('server/index.js'),loadSdk('server/stdio.js'),loadSdk('types.js')]);
 const server=new Server({name:'pat-premiere-bridge-v2',version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(types.ListToolsRequestSchema,async()=>({tools}));
 server.setRequestHandler(types.CallToolRequestSchema,async request=>{
   try{const result=adapter.invoke(request.params.name,request.params.arguments);return {content:[{type:'text',text:JSON.stringify(result)}],isError:['failed','rejected','conflict'].includes(result.status)};}
   catch(e){return {content:[{type:'text',text:JSON.stringify({error:brief(e.message)})}],isError:true};}
 });
 await server.connect(new StdioServerTransport());
}
module.exports={Adapter,tools,loadSdk,validate};
if(require.main===module)main().catch(e=>{process.stderr.write('Premiere MCP startup failed: '+brief(e.message)+'\n');process.exitCode=1;});
