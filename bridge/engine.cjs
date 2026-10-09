'use strict';
// Compatibility protocol: command-ID.json {id,script} -> response-ID.json.
// A timeout is NOT cancellation. Keep the durable lane until the callback resolves.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ID = /^[A-Za-z0-9_-]{1,120}$/;
function atomic(file, value) {
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function fingerprint(script) { return crypto.createHash('sha256').update(script).digest('hex'); }
class Engine {
  constructor(options) {
    this.dir = path.resolve(options.directory);
    this.evaluate = options.evaluate;
    this.timeoutMs = options.timeoutMs || 45000;
    this.onState = options.onState || (() => {});
    this.pollMs = options.pollMs || 750;
    this.clock = options.clock || Date.now;
    this.allowLegacyScripts = options.allowLegacyScripts === true;
    this.running = false;
    this.active = null;
    this.token = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.join(this.dir, 'journal'), {recursive:true, mode:0o700});
    this.lane = path.join(this.dir, 'lane-v2.json');
  }
  file(kind, id) { if (!ID.test(id)) throw new Error('Invalid request ID'); return path.join(this.dir, kind + '-' + id + '.json'); }
  journal(id) { if (!ID.test(id)) throw new Error('Invalid request ID'); return path.join(this.dir,'journal',id+'.json'); }
  status(id) { return read(this.journal(id)); }
  state() {
    const lane = read(this.lane);
    return {watching:this.running, active:lane, hostVerified:false,
      detail:lane ? 'Host request unresolved; no other evaluation will start' : 'Waiting for commands; host readiness not probed'};
  }
  emit() { this.onState(this.state()); }
  start() { if (this.running) return; this.running=true; this.emit(); this.schedule(); }
  stop() { this.running=false; clearTimeout(this.timer); this.timer=null; this.emit(); } // does not release active lane
  schedule() { if (!this.running || this.timer) return; this.timer=setTimeout(() => {
    this.timer=null;
    try { this.tick(); } catch(e) { this.onState({watching:this.running,error:String(e)}); }
    this.schedule();
  },this.pollMs); }
  tick() {
    if (this.active || read(this.lane)) return false;
    const files = fs.readdirSync(this.dir).filter(f=>/^command-[A-Za-z0-9_-]{1,120}\.json$/.test(f)).sort((a,b)=>fs.statSync(path.join(this.dir,a)).mtimeMs-fs.statSync(path.join(this.dir,b)).mtimeMs || a.localeCompare(b));
    for (const name of files) {
      const id=name.slice(8,-5), file=path.join(this.dir,name);
      let command;
      // Legacy clients write non-atomically. Partial JSON remains untouched until next scan.
      try { command=read(file); } catch(e) { if (e instanceof SyntaxError || e.code==='ENOENT') continue; throw e; }
      if (!command) continue;
      if (command.id!==id || typeof command.script!=='string' || !command.script.trim() || command.script.length>500000) {
        atomic(this.file('response',id),{success:false,error:'Invalid command envelope',status:'rejected'});
        fs.unlinkSync(file); continue;
      }
      try {
        if(command.domain){
          const guarded=require('./domain.cjs').compile(command.domain.command,command.domain.guard);
          if(command.script!==guarded)throw new Error('Domain script does not match reviewed command');
        } else if(!this.allowLegacyScripts)throw new Error('Legacy scripts disabled; use a guarded domain command');
      } catch(e) {
        atomic(this.file('response',id),{success:false,status:'rejected',error:String(e.message||e)});
        fs.unlinkSync(file); continue;
      }
      const hash=fingerprint(command.script), old=this.status(id);
      if (old) {
        if (old.hash!==hash) {
          atomic(this.file('response',id),{success:false,error:'Request ID reused for a different script',status:'conflict'});
        } else if (old.response) { atomic(this.file('response',id),old.response); }
        else { atomic(this.file('response',id),{success:false,error:'Unresolved request; inspect journal, do not resubmit',status:'uncertain'}); }
        fs.unlinkSync(file); continue;
      }
      const claim={id,hash,owner:this.token,startedAt:this.clock(),status:'running'};
      let fd;
      try { fd=fs.openSync(this.lane,'wx',0o600); } catch(e) { if(e.code==='EEXIST') return false; throw e; }
      try { fs.writeFileSync(fd,JSON.stringify(claim)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // Another process can complete the same ID between our first journal read and claim.
      // Recheck while holding the lane; a completed request is never evaluated twice.
      const raced=this.status(id);
      if(raced){
        const response=raced.hash!==hash?{success:false,status:'conflict',error:'Request ID reused for a different script'}:
          raced.response || {success:false,status:'uncertain',error:'Unresolved journal; inspect before continuing'};
        atomic(this.file('response',id),response);
        try { fs.unlinkSync(file); } catch(e) { if(e.code!=='ENOENT') throw e; }
        if(raced.status==='completed' || raced.status==='failed') fs.unlinkSync(this.lane);
        return false;
      }
      // If any persistence fails here, the lane remains claimed: fail closed before eval.
      atomic(this.journal(id),claim);
      this.active=claim;
      this.emit();
      const timeout=setTimeout(()=>{
        if (this.active!==claim) return;
        claim.status='uncertain';
        claim.response={success:false,status:'uncertain',error:'Host callback overdue; execution may still complete. Query this same request ID; do not retry.'};
        atomic(this.journal(id),claim);
        atomic(this.file('response',id),claim.response);
        this.emit();
      },this.timeoutMs);
      let returned=false;
      const finish=(error,result)=>{
        if(returned) return; returned=true; clearTimeout(timeout);
        let parsed=result;
        if (!error && (result==='EvalScript error.' || result==='EvalScript error')) error=new Error(result);
        if (!error && typeof result==='string') { try { parsed=JSON.parse(result); } catch (_) {} }
        claim.status=error?'failed':'completed'; claim.finishedAt=this.clock();
        claim.response=error?{success:false,status:'failed',error:String(error.message||error)}:{success:true,result:parsed,timestamp:new Date().toISOString(),status:'completed'};
        try {
          atomic(this.journal(id),claim);
          atomic(this.file('response',id),claim.response);
          // Legacy client can remove request when seeing an uncertain response.
          try { fs.unlinkSync(file); } catch(e) { if(e.code!=='ENOENT') throw e; }
          const lane=read(this.lane);
          if(lane && lane.owner===this.token && lane.id===id) fs.unlinkSync(this.lane);
          this.active=null;
          this.emit();
        } catch(e) { this.onState({error:'Persistence failure; lane remains blocked: '+String(e)}); }
      };
      try { this.evaluate(command.script,finish); } catch(e) { finish(e); }
      return true;
    }
    return false;
  }
}
module.exports={Engine,atomic,read,fingerprint};
