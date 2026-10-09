// Minimal JSON.stringify fallback for the ES3 host, limited to JSON-safe values.
if (typeof JSON === 'undefined') { JSON = {}; }
if (typeof JSON.stringify !== 'function') {
  JSON.stringify = function(value) {
    function quote(s) { return '"' + String(s).replace(/["\\\u0000-\u001f]/g,function(c){
      if(c==='"')return '\\"'; if(c==='\\')return '\\\\';
      return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"'; }
    function encode(v) {
      if(v===null)return 'null';
      if(typeof v==='string')return quote(v);
      if(typeof v==='number')return isFinite(v)?String(v):'null';
      if(typeof v==='boolean')return String(v);
      var a=[],i;
      if(v instanceof Array){for(i=0;i<v.length;i++)a.push(encode(v[i]));return '['+a.join(',')+']';}
      if(typeof v==='object'){for(i in v){if(v.hasOwnProperty(i)&&typeof v[i]!=='undefined'&&typeof v[i]!=='function')a.push(quote(i)+':'+encode(v[i]));}return '{'+a.join(',')+'}';}
      return 'null';
    }
    return encode(value);
  };
}
