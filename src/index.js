'use strict';
const path=require('node:path');
const {Timer,KINDS,VARIANTS,DEFAULTS,DEFAULT_KIND,normalizePref,CHIME_STEPS,isContinuous,isBreak,titleFor}=require('./timer');
const {parseTime,prettyClock,formatDuration,endLabel}=require('./time');
const {AudioPlayer,PROFILES,MEDITATION_PROFILES}=require('./audio');
const {PromptQueue}=require('./prompts');
const {inputFor,startCommand}=require('./commands');
const CLOCKS=Object.freeze({focus:'🕐',deep:'🕒',pomodoro:'🕔',focusPom:'🕘',deepPom:'🕗',meditation:'🕙',timer:'🕑',short_break:'🕓',long_break:'🕖',help:'🕚'});
const GLYPHS={clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',execute:'<path d="m14 3-9 11h6l-1 7 9-11h-6z"/>',play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',sound:'<path d="m4 9 4 0 5-4v14l-5-4H4zM17 8q5 4 0 8"/>',note:'<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/>',next:'<path d="m6 5 10 7-10 7zM18 5v14"/>'};
function icon(name='clock'){return {ImageType:'svg',ImageData:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]||GLYPHS.clock}</g></svg>`};}
function clockIcon(kind,variant='plain'){return {ImageType:'emoji',ImageData:CLOCKS[kind==='pomodoro'&&variant!=='plain'?variant+'Pom':kind]||CLOCKS.timer};}
const response=Results=>({Results}),tag=Text=>({Type:'text',Text});

class Manasikara{
  constructor(){this.init=this.init.bind(this);this.query=this.query.bind(this);this.api=null;this.ctx=null;this.prefs={...DEFAULTS};this.timer=null;this.audio=null;this.prompts=null;this.error='';this.uiContext=null;this.uiTicker=null;this.uiBusy=false;this.previewToken=0;this.disposed=false;}
  async init(ctx,params){
    this.ctx=ctx;this.api=params.API;this.disposed=false;const cache=await this.api.GetCacheFolder(ctx);
    await Promise.all(Object.keys(DEFAULTS).map(async key=>{try{const v=await this.api.GetSetting(ctx,key);if(v!==''&&v!=null)this.prefs[key]=normalizePref(key,v);}catch(e){this.log(e);}}));
    this.audio=new AudioPlayer(params.PluginDirectory||__dirname,cache,e=>this.reportError('Audio: '+e.message));
    // Keep the original cache filename and plugin ID so upgrades retain sessions.
    this.timer=new Timer({file:path.join(cache,'zenflow-session.json'),prefs:this.prefs,onFinish:c=>this.finished(c),onChime:n=>this.play('chime',n),onCheckIn:event=>this.prompts?.push(event),onChange:()=>this.refresh(),onError:e=>this.reportError(e.message)});
    this.prompts=new PromptQueue({api:this.api,ctx,valid:event=>this.timer.validPrompt(event),onError:message=>this.reportError(message)});
    this.timer.load();this.audio.ready().catch(e=>this.reportError('Audio: '+e.message));
    await this.api.OnSettingChanged(ctx,(_ctx,key,value)=>{if(Object.hasOwn(DEFAULTS,key)){this.prefs[key]=normalizePref(key,value);this.timer.prefs[key]=this.prefs[key];this.refresh();}});
    if(typeof this.api.OnLeavePluginQuery==='function')await this.api.OnLeavePluginQuery(ctx,()=>this.stopWatching());
    await this.api.OnUnload(ctx,()=>this.cleanup());
    await this.api.OnMRURestore(ctx,async(_ctx,mru)=>{
      const d=mru?.ContextData||{},legacy=d.schema!=='3';let kind=d.kind,variant=d.variant||'plain';
      if(legacy&&kind==='focus'){kind='pomodoro';variant=d.mode==='quiet'?'plain':'focus';}
      if(!Object.hasOwn(KINDS,kind)||!Object.hasOwn(VARIANTS,variant))return null;
      if(!legacy&&isContinuous(kind)&&d.indefinite==='true')return this.startRow(kind,{indefinite:true},variant);
      const seconds=Number(d.seconds||Number(d.minutes)*60);if(!Number.isFinite(seconds)||seconds<1||seconds>604800)return null;
      return this.startRow(kind,{seconds,absolute:false},variant);
    });
    await this.registerTools(ctx);
  }
  log(error){if(this.api&&this.ctx)Promise.resolve(this.api.Log(this.ctx,'Warning','Manasikāra: '+String(error))).catch(()=>{});}
  reportError(message){if(this.disposed)return;this.error=String(message);this.log(message);this.refresh();if(this.api)Promise.resolve(this.api.Notify(this.ctx,'Manasikāra: '+message)).catch(()=>{});}
  refresh(){this.prompts?.prune();if(this.uiContext&&this.api)Promise.resolve(this.api.RefreshQuery(this.uiContext,{PreserveSelectedIndex:true})).catch(()=>{});}
  stopWatching(){this.uiContext=null;if(this.uiTicker)clearInterval(this.uiTicker);this.uiTicker=null;}
  cleanup(){this.disposed=true;this.previewToken++;this.stopWatching();this.prompts?.close();this.timer?.close();this.audio?.close();}
  async setPref(ctx,key,value){if(!Object.hasOwn(DEFAULTS,key))throw Error('Unknown setting.');const parsed=normalizePref(key,value);await this.api.SaveSetting(ctx,key,String(parsed),false);this.prefs[key]=parsed;this.timer.prefs[key]=parsed;this.refresh();return parsed;}
  play(role,step){
    if(!this.audio)return;this.previewToken++;
    return this.audio.play(this.prefs[role+'Sound'],role==='chime'?`chime-${step}`:role==='meditation'?'meditation':'finish',this.prefs[role+'Volume']).catch(()=>{});
  }
  finished(c){this.play(c.kind==='meditation'?'meditation':'finish');if(this.prefs.notifications)Promise.resolve(this.api.Notify(this.ctx,`${titleFor(c)} finished.`)).catch(e=>this.log(e));}
  start(kind,spec,variant='plain',workSeconds){
    this.previewToken++;this.prompts?.clear();this.audio.stop().catch(e=>this.reportError('Audio: '+e.message));
    return this.timer.start(kind,spec.indefinite?undefined:spec.seconds,{variant,workSeconds,...(spec.absolute?{endsAt:spec.endsAt}:{})});
  }
  async control(action,seconds=300){
    if(action==='stop'){this.previewToken++;this.prompts?.clear();this.timer.stop();await this.audio.stop();return true;}
    const changed=action==='extend'?this.timer.extend(seconds):this.timer[action]();
    if(!changed)throw Error(action==='extend'&&this.timer.data.current?.indefinite?'This session already runs until you stop it.':`Nothing to ${action}.`);
    if(action==='pause'||action==='skip'){this.previewToken++;await this.audio.stop();}return true;
  }
  action(id,name,glyph,callback,extra={}){return {Id:id,Name:name,Icon:icon(glyph),IsDefault:!!extra.default,PreventHideAfterAction:!!extra.keepOpen,ContextData:extra.contextData||{},Action:async ctx=>{try{await callback(ctx);}catch(e){this.reportError(e.message||e);}}};}
  message(title,subtitle='',glyph='clock'){return {Title:title,SubTitle:subtitle,Icon:icon(glyph),Actions:[]};}
  nav(id,title,target,subtitle='',glyph='help'){return {Title:title,SubTitle:subtitle,Icon:clockIcon(glyph),Actions:[this.action('nav.'+id,'Open','next',ctx=>this.api.ChangeQuery(ctx,{QueryType:'input',QueryText:target}),{default:true,keepOpen:true})]};}
  startRow(kind,spec,variant='plain',workSeconds){
    const indefinite=!!spec.indefinite,ends=spec.absolute?spec.endsAt:Date.now()+(spec.seconds||0)*1000;
    const title=titleFor({kind,variant}),current=this.timer.data.current;
    const row={Score:90,Id:`mana.start.${kind}.${variant}.${indefinite?'continuous':spec.seconds}.${spec.endsAt||0}`,
      Title:`Start ${title}`+(indefinite?'':` · ${formatDuration(spec.seconds)}`),
      SubTitle:(indefinite?'Runs until stopped':`Ends ${endLabel(ends)}`)+(current?' · Replaces the current session':''),Icon:clockIcon(kind,variant),Tails:[],Actions:[]};
    if(kind==='focus')row.Tails=[tag('Minute chimes · 15-minute logs')];
    if(kind==='deep')row.Tails=[tag('Three-minute chimes · No logs')];
    if(!spec.absolute)row.IdentityKey=`v3:${kind}:${variant}:${indefinite?'continuous':spec.seconds}`;
    row.Actions=[this.action('start.'+kind+'.'+variant,'Start','execute',()=>this.start(kind,spec,variant,workSeconds),{default:true,
      contextData:spec.absolute?{}:{schema:'3',kind,variant,seconds:indefinite?'':String(spec.seconds),indefinite:String(indefinite)}})];
    return row;
  }
  statusRow(){
    const c=this.timer.data.current;if(!c)return this.message('No session running');
    const paused=c.status==='paused',clock=prettyClock(c.indefinite?this.timer.elapsed():this.timer.remaining());
    const actions=[this.action('pause-resume',paused?'Resume':'Pause',paused?'play':'pause',()=>this.control(paused?'resume':'pause'),{default:true}),this.action('stop','Stop','stop',()=>this.control('stop'))];
    if(!c.indefinite)actions.push(this.action('extend','Add five minutes','clock',()=>this.control('extend',300)));
    if(c.kind==='pomodoro'||isBreak(c.kind))actions.push(this.action('skip','Skip interval','next',()=>this.control('skip')));
    return {Score:100,Id:'mana.live',Title:`${clock}${c.indefinite?' elapsed':''} · ${titleFor(c)}`,SubTitle:paused?'Paused':c.indefinite?'Runs until stopped':`Ends ${endLabel(c.endsAt)}`,Icon:clockIcon(c.kind,c.variant),Tails:[],Actions:actions};
  }
  watch(ctx){
    this.stopWatching();this.uiContext=ctx;if(!this.timer.data.current)return;
    this.uiTicker=setInterval(async()=>{if(this.uiBusy||this.disposed)return;this.uiBusy=true;
      try{this.timer.tick();if(!this.timer.data.current){this.stopWatching();return;}const r=this.statusRow();const ok=await this.api.UpdateResult(ctx,{Id:r.Id,Title:r.Title,SubTitle:r.SubTitle,Icon:r.Icon,Tails:r.Tails});if(!ok)this.stopWatching();}
      catch{this.stopWatching();}finally{this.uiBusy=false;}
    },1000);this.uiTicker.unref?.();
  }
  dashboard(ctx){
    this.watch(ctx);const rows=[];if(this.error)rows.push(this.message(this.error));
    if(this.timer.data.current)rows.push(this.statusRow());
    else if(isBreak(this.timer.data.nextKind))rows.push(this.startRow(this.timer.data.nextKind,{seconds:this.prefs[DEFAULT_KIND[this.timer.data.nextKind]]*60},this.timer.data.nextVariant,this.timer.data.nextWorkSeconds));
    else if(this.timer.data.nextKind==='pomodoro'&&this.timer.data.nextVariant!=='plain')rows.push(this.startRow('pomodoro',{seconds:this.timer.data.nextWorkSeconds||this.prefs.focusMinutes*60},this.timer.data.nextVariant));
    rows.push(this.startRow('focus',{indefinite:true}),this.startRow('deep',{indefinite:true}));
    for(const variant of Object.keys(VARIANTS))if(!rows.some(x=>x.Id?.startsWith(`mana.start.pomodoro.${variant}.`)))rows.push(this.startRow('pomodoro',{seconds:this.prefs.focusMinutes*60},variant));
    rows.push(this.startRow('meditation',{seconds:this.prefs.meditationMinutes*60}),this.startRow('timer',{seconds:this.prefs.timerMinutes*60}),this.nav('help','Help','mana help'));
    return rows;
  }
  helpRows(){return [
    this.nav('focus','focus — continuous focus','focus ','Minute chimes; log every 15 minutes; keeps running after each log.','focus'),
    this.nav('deep','deep — continuous deep focus','deep ','Initial low cue, then a chime every third minute; no logs or breaks.','deep'),
    this.nav('pom','pom — Pomodoro','pom ','Choose a work interval and variant; short and long breaks follow your configured cycle.','pomodoro'),
    this.nav('med','med — meditation','med ','Add a duration or an until-time. Enter starts; your chosen recording plays at the end.','meditation'),
    this.nav('timer','timer — countdown','timer ','Add a duration or an until-time. Enter starts; the ending sound plays once.','timer'),
    this.message('Durations','Numbers mean minutes. Seconds, hours, compounds, fractions, word numbers and until-times are supported.'),
    this.message('Compact entry','The duration may follow med, pom or timer directly, without a space.'),
    this.nav('status','mana — current session','mana ','Shows elapsed time for continuous sessions and remaining time for countdowns.','help'),
    this.message('mana pause / mana resume','Pause the current session, then resume it. Chimes restart their pitch cycle.'),
    this.message('mana stop','Stop the session and silence any playing sound.'),
    this.message('mana +<duration>','Add time to a countdown. Continuous sessions need no extension.'),
    this.message('mana skip','End a Pomodoro or break early; the next interval is ready in mana.'),
    this.message('Logging','The popup contains l and a space. Type your log and press Enter; Escape dismisses it. The session keeps running.','note'),
    this.message('One session at a time','Starting another mode replaces the current session. Wox must stay running for cues and prompts.')
  ];}
  async preview(role,profile){const token=++this.previewToken;this.error='';const volume=this.prefs[role+'Volume'];if(role==='chime'){for(let n=1;n<=CHIME_STEPS;n++){if(token!==this.previewToken||this.disposed)return;await this.audio.play(profile,`chime-${n}`,volume);if(n<CHIME_STEPS)await new Promise(resolve=>setTimeout(resolve,2600));}}else await this.audio.play(profile,role==='meditation'?'meditation':'finish',volume);}
  soundRows(role){
    if(!role)return [this.nav('chime','Minute chime','mana sounds chime'),this.nav('med-end','Meditation ending','mana sounds meditation'),this.nav('end','Timer and Pomodoro ending','mana sounds finish')];
    if(!['chime','meditation','finish'].includes(role))return [this.message('Unknown sound category')];
    return Object.entries(role==='meditation'?MEDITATION_PROFILES:PROFILES).map(([id,label])=>({Title:label,SubTitle:'',Icon:icon('sound'),Tails:this.prefs[role+'Sound']===id?[tag('Selected')]:[],Actions:[
      this.action('preview.'+role+'.'+id,'Listen','sound',()=>{this.preview(role,id).catch(e=>this.log(e));},{default:true,keepOpen:true}),
      this.action('choose.'+role+'.'+id,'Use this sound','sound',ctx=>this.setPref(ctx,role+'Sound',id),{keepOpen:true}),
      this.action('silence','Stop sound','stop',async()=>{this.previewToken++;await this.audio.stop();},{keepOpen:true})]}));
  }
  async query(ctx,query){
    const input=inputFor(query);if(!input)return response([]);if(!this.timer)return response([this.message('Manasikāra is starting')]);
    this.timer.tick();this.stopWatching();const text=input.text.trim(),lower=text.toLowerCase();
    if(!text&&input.prefix==='mana'||/^(status|now)$/.test(lower))return response(this.dashboard(ctx));
    if(/^(help|\?)$/.test(lower))return response(this.helpRows());
    if(/^(sounds?)(?:\s|$)/.test(lower))return response(this.soundRows(lower.split(/\s+/)[1]));
    if(/^(settings|config|preferences)$/.test(lower))return response([this.message('Wox Settings → Plugins → Wox.Plugin.Manasikāra')]);
    const direct=lower.match(/^(pause|resume|stop|skip)$/);
    if(direct){const action=direct[1],c=this.timer.data.current,valid=action==='stop'||c&&(action!=='pause'||c.status==='running')&&(action!=='resume'||c.status==='paused')&&(action!=='skip'||c.kind==='pomodoro'||isBreak(c.kind));
      if(!valid)return response([this.message(`Nothing to ${action}`)]);
      return response([{Title:action[0].toUpperCase()+action.slice(1),SubTitle:'',Icon:icon(action==='pause'?'pause':action==='stop'?'stop':action==='skip'?'next':'play'),Actions:[this.action('control.'+action,action,'clock',()=>this.control(action),{default:true})]}]);}
    const extend=text.match(/^(?:extend\s+|add\s+|\+)\s*(.+)$/i);
    if(extend){try{const spec=parseTime(extend[1]);if(spec.absolute)throw Error('Use a duration to extend the timer.');if(!this.timer.data.current)throw Error('No timer running.');if(this.timer.data.current.indefinite)throw Error('This session already runs until you stop it.');return response([{Title:'Add '+formatDuration(spec.seconds),SubTitle:'',Icon:icon(),Actions:[this.action('extend-duration','Extend','clock',()=>this.control('extend',spec.seconds),{default:true})]}]);}catch(e){return response([this.message(e.message)]);}}
    try{const command=startCommand(input,this.prefs),rows=[];
      if(!text&&this.timer.data.current?.kind===command.kind){rows.push(this.statusRow());this.watch(ctx);}
      if(command.kind==='pomodoro'&&!command.explicitVariant)for(const variant of Object.keys(VARIANTS))rows.push(this.startRow(command.kind,command.spec,variant));
      else rows.push(this.startRow(command.kind,command.spec,command.variant));
      if(this.error)rows.unshift(this.message(this.error));return response(rows);
    }catch(e){return response([this.message(e.message)]);}
  }
  async registerTools(ctx){
    if(typeof this.api.RegisterPluginTool!=='function')return;
    const base={OutputSchema:{type:'object',properties:{status:{type:'object'}},required:['status']}};
    const entries=[
      {Name:'get_timer_status',Description:'Get the current Manasikāra session.',InputSchema:{type:'object',properties:{},additionalProperties:false},Annotations:{ReadOnly:true,Destructive:false,Idempotent:true,RequiresUI:false},Handler:async()=>({Output:{status:this.timer.snapshot()}})},
      {Name:'start_timer',Description:'Start continuous focus/deep, a Pomodoro variant, meditation, a timer or a break. Sounds and end notifications are scheduled; focus modes can open activity log prompts. Durations accept English and until-times.',InputSchema:{type:'object',properties:{kind:{type:'string',enum:Object.keys(KINDS)},variant:{type:'string',enum:Object.keys(VARIANTS)},minutes:{type:'number',minimum:1/60,maximum:10080},duration:{type:'string'}},required:['kind'],additionalProperties:false},Annotations:{ReadOnly:false,Destructive:true,Idempotent:false,RequiresUI:true},Handler:async(_ctx,p)=>{const a=p.Arguments,spec=a.duration?parseTime(a.duration):a.minutes!==undefined?{seconds:a.minutes*60}:isContinuous(a.kind)?{indefinite:true}:{seconds:this.prefs[DEFAULT_KIND[a.kind]]*60};return {Output:{status:this.start(a.kind,spec,a.variant||'plain')}};}},
      {Name:'control_timer',Description:'Pause, resume, stop, skip or extend the current session.',InputSchema:{type:'object',properties:{action:{type:'string',enum:['pause','resume','stop','skip','extend']},minutes:{type:'number',minimum:1/60,maximum:10080}},required:['action'],additionalProperties:false},Annotations:{ReadOnly:false,Destructive:true,Idempotent:false,RequiresUI:false},Handler:async(_ctx,p)=>{try{await this.control(p.Arguments.action,(p.Arguments.minutes??5)*60);return {Output:{status:this.timer.snapshot()}};}catch(e){return {Error:{Code:'INVALID_ACTION',Message:e.message}};}}}
    ];
    for(const entry of entries){const {Handler,...Tool}=entry;try{await this.api.RegisterPluginTool(ctx,{Tool:{...base,...Tool},Handler});}catch(e){this.log(e);}}
  }
}
module.exports={plugin:new Manasikara(),Manasikara,inputFor,CLOCKS};
