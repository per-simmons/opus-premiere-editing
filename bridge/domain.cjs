'use strict';
// Small reviewed command surface. No arbitrary domain-command scripts.
function compile(command, guard) {
  if (!['snapshot','save_checkpoint'].includes(command)) throw new Error('Unsupported domain command');
  if (!guard || typeof guard.projectPath!=='string' || !guard.projectPath.startsWith('/') || typeof guard.sequenceId!=='string' || !guard.sequenceId || !/^\d+$/.test(String(guard.timebase))) throw new Error('Exact project path, sequence ID and timebase required');
  if (!Array.isArray(guard.videoTracks) || !Array.isArray(guard.audioTracks) || !guard.videoTracks.concat(guard.audioTracks).every(n=>Number.isInteger(n)&&n>=0)) throw new Error('Expected occupied track indices required');
  return '(function(){\nvar g='+JSON.stringify(guard)+';\n'+
`function assert(ok,message){if(!ok)throw new Error(message);}
var p=app.project;assert(p && p.path===g.projectPath,'PROJECT_PATH_MISMATCH');
var s=p.activeSequence;assert(s && s.sequenceID===g.sequenceId,'SEQUENCE_ID_MISMATCH');
assert(String(s.timebase)===String(g.timebase),'TIMEBASE_MISMATCH');
function tracks(collection,expected){var used=[],out=[];for(var i=0;i<collection.numTracks;i++){var track=collection[i];if(track.clips.numItems)used.push(i);for(var j=0;j<track.clips.numItems;j++){var c=track.clips[j];out.push({track:i,nodeId:c.nodeId,path:c.projectItem?c.projectItem.getMediaPath():'',start:c.start.ticks,end:c.end.ticks,sourceIn:c.inPoint.ticks,sourceOut:c.outPoint.ticks});}}assert(used.join(',')===expected.join(','),'OCCUPIED_TRACKS_MISMATCH');return out;}
var result={project:p.path,sequenceId:s.sequenceID,name:s.name,timebase:String(s.timebase),end:s.end,video:tracks(s.videoTracks,g.videoTracks),audio:tracks(s.audioTracks,g.audioTracks)};
`+(command==='save_checkpoint'?'result.saveReturn=p.save();\n':'')+'return JSON.stringify(result);\n})();';
}
module.exports={compile};
