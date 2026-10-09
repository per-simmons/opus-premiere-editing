'use strict';
(function(){
  var fs=require('fs'), path=require('path'), os=require('os');
  var root=path.dirname(decodeURI(window.location.pathname));
  var Engine=require(path.join(root,'engine.cjs')).Engine;
  var shim=fs.readFileSync(path.join(root,'json-compat.jsx'),'utf8');
  var engine=null, input=document.getElementById('directory'), status=document.getElementById('status'), detail=document.getElementById('detail');
  // Separate default prevents two bridge generations consuming the same request.
  var settings={};
  var settingsFile=path.join(root,'bridge-settings.json');
  if(fs.existsSync(settingsFile))settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  input.value=process.env.PREMIERE_V2_TEMP_DIR || settings.directory || path.join(os.homedir(),'.premiere-mcp-bridge-v2');
  function render(state){
    if(engine){try{require(path.join(root,'engine.cjs')).atomic(path.join(engine.dir,'runtime-state.json'),{at:new Date().toISOString(),pid:process.pid,state:state});}catch(e){/* The request journal remains authoritative. */}}
    var text=state.error || (state.active?'Host request unresolved':state.watching?'Watching command folder':'Intake stopped');
    var more=state.error || (state.active?state.active.id+' — '+state.active.status:'No background host probes.');
    if(status.textContent!==text)status.textContent=text;
    if(detail.textContent!==more)detail.textContent=more;
    document.getElementById('start').disabled=!!state.watching;
    document.getElementById('stop').disabled=!state.watching;
    input.disabled=!!state.watching || !!state.active;
  }
  document.getElementById('start').onclick=function(){
    try {
      if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) throw new Error('CEP host unavailable');
      if(engine && engine.dir!==path.resolve(input.value)) throw new Error('Reload panel to switch command folder after settling requests');
      if(!engine)engine=new Engine({directory:input.value,allowLegacyScripts:settings.allowLegacyScripts===true,onState:render,evaluate:function(script,done){
        window.__adobe_cep__.evalScript(shim+'\n'+script,function(result){done(null,result);});
      }});
      engine.start();
    }catch(e){render({error:String(e)});}
  };
  document.getElementById('stop').onclick=function(){if(engine)engine.stop();};
  window.addEventListener('beforeunload',function(){if(engine)engine.stop();});
  // Start on open without extra setup; an unresolved durable lane still blocks all eval.
  document.getElementById('start').onclick();
})();
