'use strict';
const fs=require('node:fs'),path=require('node:path');
const {MAX_SECONDS}=require('./time');
const KINDS=Object.freeze({focus:'Focus',deep:'Deep focus',pomodoro:'Pomodoro',meditation:'Meditation',timer:'Timer',short_break:'Short break',long_break:'Long break'});
const VARIANTS=Object.freeze({plain:'Pomodoro',focus:'Focus Pomodoro',deep:'Deep Pomodoro'});
const DEFAULTS=Object.freeze({focusMinutes:25,meditationMinutes:10,timerMinutes:10,shortBreakMinutes:5,longBreakMinutes:15,rounds:4,
  autoBreak:true,autoFocus:false,notifications:true,chimeSound:'brass',meditationSound:'mudita',finishSound:'bowl',
  chimeVolume:35,meditationVolume:65,finishVolume:65,checkIn:true});
const DEFAULT_KIND={pomodoro:'focusMinutes',meditation:'meditationMinutes',timer:'timerMinutes',short_break:'shortBreakMinutes',long_break:'longBreakMinutes'};
const CHIME_STEPS=15;
const nextMinute=now=>(Math.floor(now/60000)+1)*60000;
const isContinuous=kind=>kind==='focus'||kind==='deep';
const isBreak=kind=>kind==='short_break'||kind==='long_break';
const validVariant=value=>Object.hasOwn(VARIANTS,value)?value:'plain';
const titleFor=c=>c.kind==='pomodoro'?VARIANTS[validVariant(c.variant)]:KINDS[c.kind];
const empty=()=>({version:3,current:null,nextKind:'pomodoro',nextVariant:'plain',nextWorkSeconds:null,round:0,sequence:0,generation:0});
function normalizePref(key,value){
  if(!Object.hasOwn(DEFAULTS,key))return undefined;
  if(typeof DEFAULTS[key]==='boolean')return value===true||value==='true';
  if(key.endsWith('Sound'))return (key==='meditationSound'?['bowl','brass','resonance','mudita']:['bowl','brass','resonance']).includes(value)?value:DEFAULTS[key];
  const n=Number(value),max=key==='rounds'?24:key.endsWith('Volume')?100:MAX_SECONDS/60,min=key.endsWith('Volume')?0:key==='rounds'?1:1/60;
  return Number.isFinite(n)&&n>=min&&n<=max&&(key!=='rounds'||Number.isInteger(n))?n:DEFAULTS[key];
}
class Timer{
  constructor({file=null,prefs={},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onFinish=()=>{},onChime=()=>{},onCheckIn=()=>{},onChange=()=>{},onError=()=>{}}={}){
    Object.assign(this,{file,now,setTimer,clearTimer,onFinish,onChime,onCheckIn,onChange,onError});
    this.prefs={...DEFAULTS,...prefs};this.data=empty();this.handle=null;this.disposed=false;
  }
  load(){
    if(!this.file)return;
    try{
      const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!d||![1,2,3].includes(d.version))return;
      const legacy=d.version<3;
      if(legacy&&!fs.existsSync(this.file+'.v'+d.version+'-backup'))fs.copyFileSync(this.file,this.file+'.v'+d.version+'-backup');
      this.data=empty();for(const key of ['round','sequence','generation'])if(Number.isSafeInteger(d[key])&&d[key]>=0)this.data[key]=d[key];
      this.data.nextKind=legacy&&d.nextKind==='focus'?'pomodoro':Object.hasOwn(KINDS,d.nextKind)?d.nextKind:'pomodoro';
      this.data.nextVariant=validVariant(d.nextVariant);
      if(Number.isFinite(d.nextWorkSeconds)&&d.nextWorkSeconds>=1&&d.nextWorkSeconds<=MAX_SECONDS)this.data.nextWorkSeconds=d.nextWorkSeconds;
      const c=d.current;
      if(c&&Object.hasOwn(KINDS,c.kind)&&['running','paused'].includes(c.status)){
        const kind=legacy&&c.kind==='focus'?'pomodoro':c.kind,indefinite=!legacy&&isContinuous(kind)&&c.indefinite===true;
        if(indefinite||(Number.isFinite(c.durationSec)&&c.durationSec>=1&&c.durationSec<=MAX_SECONDS&&Number.isFinite(c.endsAt)&&Number.isFinite(c.remainingMs))){
          const now=this.now(),variant=legacy?(c.mode==='chimes'?'focus':'plain'):validVariant(c.variant);
          this.data.current={kind,variant,indefinite,status:c.status,id:String(c.id||'restored'),generation:this.data.generation,
            durationSec:indefinite?null:c.durationSec,startedAt:Number(c.startedAt)||now,endsAt:indefinite?null:c.endsAt,
            remainingMs:indefinite?null:Math.min(c.durationSec*1000,Math.max(0,c.remainingMs)),
            elapsedMs:Number.isFinite(c.elapsedMs)?Math.max(0,c.elapsedMs):0,segmentStartedAt:Number(c.segmentStartedAt)||Number(c.startedAt)||now,
            firstBoundary:Number(c.firstBoundary)||nextMinute(now),lastBoundary:Number(c.lastBoundary)||Math.floor(now/60000)*60000,
            workSeconds:Number.isFinite(c.workSeconds)&&c.workSeconds>=1&&c.workSeconds<=MAX_SECONDS?c.workSeconds:kind==='pomodoro'?c.durationSec:this.prefs.focusMinutes*60};
          this.data.nextVariant=variant;this.data.nextWorkSeconds=this.data.current.workSeconds;
        }
      }
      // Recovery never replays old completion sounds or log prompts.
      this.complete(false);if(legacy)this.persist();this.arm();
    }catch(e){if(e.code!=='ENOENT')this.onError(Error('Could not restore the session: '+e.message));}
  }
  persist(){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data),'utf8');fs.renameSync(temp,this.file);}
  arm(){
    if(this.handle!==null)this.clearTimer(this.handle);this.handle=null;
    const c=this.data.current;if(this.disposed||!c||c.status!=='running')return;
    const now=this.now(),delay=Math.max(1,Math.min(1000,c.indefinite?Infinity:c.endsAt-now,nextMinute(now)-now));
    this.handle=this.setTimer(()=>{this.handle=null;try{this.tick();}catch(e){this.onError(e);}finally{this.arm();}},delay);this.handle?.unref?.();
  }
  remaining(){const c=this.data.current;return !c?0:c.indefinite?null:c.status==='paused'?c.remainingMs:Math.max(0,c.endsAt-this.now());}
  elapsed(){const c=this.data.current;return !c?0:c.elapsedMs+(c.status==='running'?Math.max(0,this.now()-c.segmentStartedAt):0);}
  start(kind,seconds,options={}){
    if(!Object.hasOwn(KINDS,kind))throw Error('Unknown session type.');
    const now=this.now(),indefinite=isContinuous(kind)&&seconds===undefined&&options.endsAt===undefined;
    let total=indefinite?null:seconds===undefined?this.prefs[DEFAULT_KIND[kind]]*60:Number(seconds);
    const endsAt=indefinite?null:options.endsAt===undefined?now+total*1000:Number(options.endsAt);
    if(options.endsAt!==undefined)total=(endsAt-now)/1000;
    if(!indefinite&&(!Number.isFinite(total)||total<1||total>MAX_SECONDS))throw Error('Choose a future end time or a duration between one second and seven days.');
    if(options.variant!==undefined&&!Object.hasOwn(VARIANTS,options.variant))throw Error('Choose plain, focus or deep Pomodoro.');
    if(!options.continueRun)this.data.generation++;
    const variant=validVariant(options.variant),workSeconds=kind==='pomodoro'?total:Number(options.workSeconds)||this.prefs.focusMinutes*60;
    const c={kind,variant,indefinite,status:'running',id:String(++this.data.sequence),generation:this.data.generation,
      durationSec:total,startedAt:now,endsAt,remainingMs:indefinite?null:total*1000,elapsedMs:0,segmentStartedAt:now,
      firstBoundary:nextMinute(now),lastBoundary:Math.floor(now/60000)*60000,workSeconds};
    this.data.current=c;this.data.nextKind=kind;this.data.nextVariant=variant;this.data.nextWorkSeconds=workSeconds;
    this.persist();this.arm();this.onChange();if(kind==='pomodoro'&&variant==='focus')this.prompt('work-start',c);return this.snapshot();
  }
  prompt(reason,c){if(this.prefs.checkIn)this.onCheckIn({reason,intervalId:c.id,generation:c.generation,issuedAt:this.now()});}
  validPrompt(event){
    if(!event||!this.prefs.checkIn||event.generation!==this.data.generation)return false;
    if(event.reason==='work-end')return true;
    const c=this.data.current;return !!c&&c.status==='running'&&c.id===event.intervalId&&
      (event.reason==='cycle'?c.kind==='focus':event.reason==='work-start'&&c.kind==='pomodoro'&&c.variant==='focus');
  }
  pause(){this.complete(true);const c=this.data.current;if(!c||c.status!=='running')return false;c.elapsedMs=this.elapsed();c.remainingMs=this.remaining();c.status='paused';this.persist();this.arm();this.onChange();return true;}
  resume(){const c=this.data.current;if(!c||c.status!=='paused')return false;const now=this.now();if(!c.indefinite)c.endsAt=now+c.remainingMs;c.segmentStartedAt=now;c.status='running';c.firstBoundary=nextMinute(now);c.lastBoundary=c.firstBoundary-60000;this.persist();this.arm();this.onChange();return true;}
  stop(){const had=!!this.data.current;this.data.generation++;this.data.current=null;this.data.nextKind='pomodoro';this.data.nextVariant='plain';this.data.nextWorkSeconds=null;this.persist();this.arm();this.onChange();return had;}
  skip(){const c=this.data.current;if(!c||(!isBreak(c.kind)&&c.kind!=='pomodoro'))return false;this.data.generation++;this.data.current=null;this.data.nextKind=c.kind==='pomodoro'?'short_break':'pomodoro';this.data.nextVariant=c.variant;this.data.nextWorkSeconds=c.workSeconds;this.persist();this.arm();this.onChange();return true;}
  extend(seconds=300){this.complete(true);const c=this.data.current,extra=Number(seconds);if(!c||c.indefinite||!Number.isFinite(extra)||extra<1||c.durationSec+extra>MAX_SECONDS)return false;c.durationSec+=extra;if(c.status==='paused')c.remainingMs+=extra*1000;else c.endsAt+=extra*1000;this.persist();this.arm();this.onChange();return true;}
  complete(live=true){
    const c=this.data.current;if(!c||c.indefinite||c.status!=='running'||this.now()<c.endsAt)return false;
    if(c.kind==='pomodoro'){this.data.round++;this.data.nextKind=this.data.round%this.prefs.rounds===0?'long_break':'short_break';}else this.data.nextKind='pomodoro';
    this.data.nextVariant=c.variant;this.data.nextWorkSeconds=c.workSeconds;this.data.current=null;this.persist();
    if(live)this.onFinish(c);if(live&&c.kind==='pomodoro'&&c.variant==='focus')this.prompt('work-end',c);
    if(live&&((c.kind==='pomodoro'&&this.prefs.autoBreak)||(isBreak(c.kind)&&this.prefs.autoFocus)))this.start(this.data.nextKind,this.data.nextKind==='pomodoro'?c.workSeconds:undefined,{variant:c.variant,workSeconds:c.workSeconds,continueRun:true});
    this.arm();this.onChange();return true;
  }
  tick(){
    if(this.complete(true))return;const c=this.data.current;if(!c||c.status!=='running')return;
    const now=this.now(),boundary=Math.floor(now/60000)*60000;
    if(boundary<c.lastBoundary){c.firstBoundary=nextMinute(now);c.lastBoundary=boundary;this.persist();return;}
    if(boundary<=c.lastBoundary)return;c.lastBoundary=boundary;this.persist();
    if(now-boundary>1250||boundary<c.firstBoundary)return;
    const beat=Math.floor((boundary-c.firstBoundary)/60000)+1,step=(beat-1)%CHIME_STEPS+1;
    const everyMinute=c.kind==='focus'||(c.kind==='pomodoro'&&c.variant==='focus'),deep=c.kind==='deep'||(c.kind==='pomodoro'&&c.variant==='deep');
    // One initial low cue, then 3, 6, 9, 12, 15, 18... clock minutes.
    if(everyMinute||(deep&&(beat===1||beat%3===0)))this.onChime(step);
    if(c.kind==='focus'&&step===CHIME_STEPS)this.prompt('cycle',c);
  }
  snapshot(){const c=this.data.current;return {status:c?.status||'idle',kind:c?.kind||null,variant:c?.variant||this.data.nextVariant,indefinite:!!c?.indefinite,remainingSeconds:c?.indefinite?null:Math.ceil(this.remaining()/1000),elapsedSeconds:Math.floor(this.elapsed()/1000),durationSeconds:c?.durationSec??null,nextKind:this.data.nextKind};}
  close(){this.disposed=true;if(this.handle!==null)this.clearTimer(this.handle);this.handle=null;}
}
module.exports={Timer,KINDS,VARIANTS,DEFAULTS,DEFAULT_KIND,normalizePref,nextMinute,CHIME_STEPS,isContinuous,isBreak,titleFor};
