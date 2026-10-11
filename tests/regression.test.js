'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const PLUGIN_ROOT=process.env.MANASIKARA_TEST_ROOT||path.resolve(__dirname,'../src');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {parseTime,prettyClock}=require(path.join(PLUGIN_ROOT,'time'));
const {Timer,DEFAULTS,CHIME_STEPS,normalizePref}=require(path.join(PLUGIN_ROOT,'timer'));
const {Manasikara,inputFor,CLOCKS}=require(path.join(PLUGIN_ROOT,'index'));
const {AudioPlayer,attenuateWav,PROFILES}=require(path.join(PLUGIN_ROOT,'audio'));

function temp(t){const p=fs.mkdtempSync(path.join(__dirname,'manasikara-test-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function clock(start=Date.UTC(2026,9,10,22,59,7)){
  let now=start,id=0;const pending=new Map();
  return {now:()=>now,setTimer:(fn,delay)=>{pending.set(++id,{fn,at:now+delay});return id;},clearTimer:i=>pending.delete(i),
    jump:ms=>now+=ms,advance(ms){const target=now+ms;for(;;){let next=null;for(const [i,x]of pending)if(x.at<=target&&(!next||x.at<next[1].at))next=[i,x];if(!next)break;now=next[1].at;pending.delete(next[0]);next[1].fn();}now=target;},pending};
}
function engine(c,options={}){return new Timer({...c,...options,prefs:{...DEFAULTS,autoBreak:false,...options.prefs}});}

const {startCommand}=require(path.join(PLUGIN_ROOT,'commands'));
const {PromptQueue}=require(path.join(PLUGIN_ROOT,'prompts'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function host(t){
  const calls=[],handlers={};let visible=false;const api={
    GetCacheFolder:async()=>temp(t),GetSetting:async()=>'',OnSettingChanged:async(_c,fn)=>{handlers.settings=fn;},
    OnLeavePluginQuery:async(_c,fn)=>{handlers.leave=fn;},OnUnload:async(_c,fn)=>{handlers.unload=fn;},
    OnMRURestore:async(_c,fn)=>{handlers.mru=fn;},RegisterPluginTool:async(_c,x)=>{handlers[x.Tool.Name]=x.Handler;},
    Log:async()=>{},Notify:async(_c,x)=>calls.push(['notify',x]),IsVisible:async()=>visible,
    ChangeQuery:async(_c,x)=>calls.push(['query',x]),ShowApp:async()=>{visible=true;calls.push(['show']);},
    RefreshQuery:async()=>{},UpdateResult:async()=>true,SaveSetting:async(_c,...v)=>calls.push(['setting',...v])
  };
  const plugin=new Manasikara();const detachedInit=plugin.init;await detachedInit({}, {API:api,PluginDirectory:PLUGIN_ROOT});
  plugin.audio={stop:async()=>{},play:async()=>{},close:()=>{}};t.after(()=>plugin.cleanup());
  const query=async raw=>plugin.query({}, {RawQuery:raw,TriggerKeyword:raw.split(' ')[0],Search:raw.split(' ').slice(1).join(' ')});
  return {plugin,query,calls,handlers,visible:value=>{visible=value;}};
}

test('English and compact durations support units, fractions, compounds and seconds',()=>{
  for(const [text,seconds] of Object.entries({'10':600,'10s':10,'30 seconds':30,'2 hours':7200,'1h30m15s':5415,
    '30sec 1hr':3630,'an hour and a half':5400,'one and a half hours':5400,'half an hour':1800,
    'a quarter of an hour':900,'three quarters of an hour':2700,'two minutes and thirty seconds':150,
    'ninety seconds':90,'one hundred and twenty seconds':120,'twenty-five minutes':1500,'1.5h':5400,
    '.5h':1800,'1½ hours':5400,'in 20 seconds':20,'for 45 seconds':45,'1:30':90,'1:02:03':3723})){
    assert.deepEqual(parseTime(text),{seconds,absolute:false},text);
  }
  for(const text of ['','0','-10','0.1 seconds','tomato','10 frogs','2 minutes delete everything','10:90','1h -5m','999999h'])assert.throws(()=>parseTime(text),text);
});

test('until parses clocks, clock words, meridiem, explicit days and midnight',()=>{
  const now=new Date(2026,9,10,14,0,0).getTime();
  for(const [text,h,m,day]of [
    ['until 5pm',17,0,10],['until5pm',17,0,10],['until five pm',17,0,10],['until five thirty pm',17,30,10],
    ['until 5 p.m.',17,0,10],['until 17:30',17,30,10],['until quarter past five pm',17,15,10],
    ['until quarter to 5pm',16,45,10],['until tomorrow at 5pm',17,0,11],['until 5pm tomorrow',17,0,11],
    ['until half past midnight',0,30,11],['until quarter to midnight',23,45,10],['until noon',12,0,11],
    ['until tomorrow at quarter to noon',11,45,11],['until five in the evening',17,0,10],['until 5',17,0,10]
  ])assert.equal(parseTime(text,now).endsAt,new Date(2026,9,day,h,m).getTime(),text);
  for(const text of ['until 13pm','until 25:00','until 17:61','until 9am today','until tomorrow today 5pm','until next Thursday','until'])assert.throws(()=>parseTime(text,now),text);
  assert.equal(parseTime('until 00:00:20',new Date(2026,9,10,23,59,50).getTime()).seconds,30);
  assert.equal(prettyClock(3601000),'1:00:01');
});

test('a long sound preview does not hold the Wox action response open',async t=>{
  const {plugin}=await host(t);let started=false;
  plugin.preview=()=>{started=true;return new Promise(()=>{});};
  await plugin.soundRows('chime')[0].Actions[0].Action({});
  assert.equal(started,true);
});

test('all 51 bundled sounds are finite 16-bit PCM with headroom, quiet endpoints and volume scaling',t=>{
  const cache=temp(t),audio=new AudioPlayer(PLUGIN_ROOT,cache,()=>{},'win32');
  for(const profile of Object.keys(PROFILES))for(const event of [...Array.from({length:15},(_,i)=>`chime-${i+1}`),'meditation','finish']){
    const original=fs.readFileSync(path.join(PLUGIN_ROOT,'sounds',profile,event+'.wav'));
    const quiet=fs.readFileSync(audio.file(profile,event,35));assert.equal(original.readUInt16LE(34),16);assert.equal(original.readUInt32LE(24),44100);
    let peak=0,total=0;for(let i=44;i<original.length;i+=2){const x=original.readInt16LE(i);peak=Math.max(peak,Math.abs(x));total+=x*x;assert.ok(Math.abs(quiet.readInt16LE(i)-Math.round(x*.35))<=1);}
    assert.ok(peak<15000);assert.ok(total>0);assert.equal(original.readInt16LE(44),0);assert.equal(original.readInt16LE(original.length-2),0);
  }
  assert.throws(()=>audio.file('bad','finish',10));assert.throws(()=>audio.file('bowl','chime-16',10));assert.throws(()=>attenuateWav(Buffer.from('bad'),50));
});

test('Windows audio worker stays alive between sounds, uses no shell interpolation, and recovers from exit',async t=>{
  const cache=temp(t),children=[],commands=[];let failPlay=false;
  function spawn(exe,args,opts){
    assert.ok(exe.endsWith('powershell.exe'));assert.equal(opts.windowsHide,true);assert.equal(opts.shell,undefined);assert.ok(!args.includes('-ExecutionPolicy'));
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
    child.kill=()=>{child.killed=true;child.emit('exit',0);};
    child.stdin=new Writable({write(chunk,_enc,done){const r=JSON.parse(chunk.toString());commands.push(r);queueMicrotask(()=>child.stdout.write(JSON.stringify({id:r.id,ok:!failPlay,error:failPlay?'Device unavailable':undefined})+'\n'));done();}});
    children.push(child);queueMicrotask(()=>child.stdout.write('{"ready":true}\n'));return child;
  }
  const errors=[],player=new AudioPlayer(PLUGIN_ROOT,cache,e=>errors.push(e.message),'win32',spawn);
  await player.play('bowl','chime-15',35);await player.play('brass','finish',65);assert.equal(children.length,1);assert.equal(children[0].killed,false);
  await player.stop();assert.equal(commands.at(-1).action,'stop');children[0].emit('exit',1);
  await player.play('bowl','meditation',65);assert.equal(children.length,2);
  failPlay=true;await assert.rejects(()=>player.play('bowl','finish',65),/Device unavailable/);assert.deepEqual(errors,['Device unavailable']);player.close();assert.equal(children[1].killed,true);
});

test('the chosen sound defaults match runtime, settings, and the sounds each menu can play',async t=>{
  const {plugin}=await host(t);
  const metadata=require(path.join(PLUGIN_ROOT,'plugin.json'));
  const selected={chimeSound:'brass',meditationSound:'mudita',finishSound:'bowl'};
  for(const [key,value]of Object.entries(selected)){
    assert.equal(DEFAULTS[key],value);assert.equal(plugin.prefs[key],value);
    const setting=metadata.SettingDefinitions.find(x=>x.Value.Key===key).Value;
    assert.equal(setting.DefaultValue,value);assert.ok(setting.Options.some(x=>x.Value===value));
  }
  const med=plugin.soundRows('meditation');assert.equal(med.length,4);
  const picked=med.find(x=>x.Tails.some(t=>t.Text==='Selected'));assert.equal(picked.Title,'Mudita Bell - Melodic Mirth');
  assert.equal(plugin.soundRows('chime').length,3);assert.equal(plugin.soundRows('finish').length,3);
  assert.equal(normalizePref('meditationSound','mudita'),'mudita');
  assert.equal(normalizePref('chimeSound','mudita'),'brass');
  assert.equal(normalizePref('finishSound','mudita'),'bowl');
});

test('the full attached recording is bundled unchanged alongside the stereo PCM playback copy',t=>{
  const dir=path.join(PLUGIN_ROOT,'sounds/mudita');
  const original=fs.readFileSync(path.join(dir,'original.mp3'));
  const provenance=JSON.parse(fs.readFileSync(path.join(dir,'SOURCE.json')));
  assert.equal(createHash('sha256').update(original).digest('hex'),provenance.sourceSha256);
  assert.equal(provenance.sourceSha256,'32e3133bd1b106fe650c80e80f9ad80a007cddc6e7bf5c7d4074943b28d341c9');
  const wave=fs.readFileSync(path.join(dir,'meditation.wav'));
  assert.equal(wave.readUInt16LE(22),2);assert.equal(wave.readUInt16LE(34),16);assert.equal(wave.readUInt32LE(24),44100);
  assert.ok(Math.abs((wave.length-44)/4/44100-provenance.durationSeconds)<.001);
  assert.ok(provenance.durationSeconds>30&&provenance.durationSeconds<31);
  const audio=new AudioPlayer(PLUGIN_ROOT,temp(t),()=>{},'win32');
  const quieter=fs.readFileSync(audio.file('mudita','meditation',65));
  for(let i=44;i<wave.length;i+=2)assert.ok(Math.abs(quieter.readInt16LE(i)-Math.round(wave.readInt16LE(i)*.65))<=1);
  assert.equal(wave.readInt16LE(44),0);assert.equal(wave.readInt16LE(wave.length-2),0);
  assert.throws(()=>audio.file('mudita','chime-1',35),/Unknown sound/);
});

test('new keywords and compact durations leave unrelated global searches alone',()=>{
  for(const [raw,prefix,text]of [['focus','focus',''],['deep','deep',''],['mana','mana',''],['med10','med','10'],['pom25 deep','pom','25 deep'],['timer30s','timer','30s'],['pomodoro 10','pomodoro','10']])
    assert.deepEqual(inputFor({RawQuery:raw,TriggerKeyword:'*'}),{prefix,text});
  for(const raw of ['medical','pomegranate','focusrite','deeply','timers','zen','zen 10','l still going','t task','a note','random passage',''])
    assert.equal(inputFor({RawQuery:raw,TriggerKeyword:'*'}),null,raw);
  assert.deepEqual(inputFor({TriggerKeyword:'timer',Search:'30 seconds'}),{prefix:'timer',text:'30 seconds'});
});

test('Pomodoro variant and duration order is flexible and continuous modes stay distinct',()=>{
  const command=raw=>startCommand(inputFor({RawQuery:raw}),DEFAULTS,new Date(2026,9,11,14).getTime());
  for(const variant of ['focus','deep','plain'])for(const raw of [`pom ${variant} 30 seconds`,`pom 30 seconds ${variant}`,`mana pom ${variant}30s`,`pomodoro 30s ${variant}`]){
    const r=command(raw);assert.equal(r.kind,'pomodoro',raw);assert.equal(r.variant,variant,raw);assert.equal(r.spec.seconds,30,raw);assert.equal(r.explicitVariant,true);
  }
  for(const variant of ['focus','deep']){
    assert.equal(command(`${variant} pom 10`).variant,variant);
    assert.equal(command(`${variant} pom 10`).spec.seconds,600);
    assert.deepEqual(command(variant).spec,{indefinite:true});
    assert.equal(command(variant).kind,variant);
    assert.equal(command(`${variant} 30 seconds`).kind,variant);
  }
  assert.equal(command('pom').variant,'plain');assert.equal(command('pom').spec.seconds,1500);
  assert.equal(command('pom focus until 5pm').spec.endsAt,command('pom until 5pm focus').spec.endsAt);
  assert.throws(()=>command('pom focus deep 10'),/one Pomodoro variant/);
});

test('continuous focus repeats 15-minute cycles indefinitely without entering a break',()=>{
  const c=clock(),heard=[],logs=[],ended=[];
  const timer=engine(c,{prefs:{autoBreak:true,autoFocus:true},onChime:n=>heard.push([c.now(),n]),onCheckIn:e=>logs.push(e),onFinish:e=>ended.push(e)});
  timer.start('focus');c.advance(31*60000);
  assert.equal(CHIME_STEPS,15);assert.deepEqual(heard.map(x=>x[1]),[...Array.from({length:15},(_,i)=>i+1),...Array.from({length:15},(_,i)=>i+1),1]);
  assert.ok(heard.every(([at])=>at%60000===0));assert.deepEqual(logs.map(x=>x.reason),['cycle','cycle']);
  assert.deepEqual(logs.map(x=>x.issuedAt),[heard[14][0],heard[29][0]]);
  assert.equal(timer.snapshot().kind,'focus');assert.equal(timer.snapshot().indefinite,true);assert.equal(timer.remaining(),null);assert.equal(ended.length,0);
  assert.equal(timer.skip(),false);assert.equal(timer.extend(300),false);
  c.jump(8*86400000+12345);timer.tick();assert.equal(timer.snapshot().status,'running');assert.equal(ended.length,0);assert.equal(heard.length,31);
  timer.stop();assert.equal(c.pending.size,0);timer.close();
});

test('deep uses a low initial cue then every third minute, with no logs or automatic breaks',()=>{
  const c=clock(),heard=[],logs=[];
  const timer=engine(c,{prefs:{autoBreak:true,autoFocus:true},onChime:n=>heard.push([c.now(),n]),onCheckIn:e=>logs.push(e)});
  timer.start('deep');const first=timer.data.current.firstBoundary;c.advance(31*60000);
  assert.deepEqual(heard.map(x=>[(x[0]-first)/60000+1,x[1]]),[[1,1],[3,3],[6,6],[9,9],[12,12],[15,15],[18,3],[21,6],[24,9],[27,12],[30,15]]);
  assert.ok(heard.every(([at])=>at%60000===0));assert.equal(logs.length,0);assert.equal(timer.snapshot().kind,'deep');assert.equal(timer.snapshot().indefinite,true);timer.close();
});

test('plain Pomodoro and its short and long breaks have no chimes or logging',()=>{
  const c=clock(),heard=[],logs=[],ended=[];
  const timer=engine(c,{prefs:{autoBreak:true,autoFocus:true,rounds:2,shortBreakMinutes:1,longBreakMinutes:2},onChime:n=>heard.push(n),onCheckIn:e=>logs.push(e),onFinish:e=>ended.push(e.kind)});
  timer.start('pomodoro',16*60);c.advance(16*60000);assert.equal(timer.snapshot().kind,'short_break');
  c.advance(60000);assert.equal(timer.snapshot().kind,'pomodoro');assert.equal(timer.snapshot().variant,'plain');assert.equal(timer.snapshot().durationSeconds,960);
  c.advance(16*60000);assert.equal(timer.snapshot().kind,'long_break');
  assert.deepEqual(ended,['pomodoro','short_break','pomodoro']);assert.equal(heard.length,0);assert.equal(logs.length,0);timer.close();
});

test('Focus Pomodoro logs only at work beginning and end, retaining custom work time and variant',()=>{
  const c=clock(),heard=[],logs=[];
  const timer=engine(c,{prefs:{autoBreak:true,autoFocus:true,shortBreakMinutes:1},onChime:n=>heard.push(n),onCheckIn:e=>logs.push(e)});
  timer.start('pomodoro',25*60,{variant:'focus'});assert.deepEqual(logs.map(x=>x.reason),['work-start']);
  c.advance(15*60000);assert.equal(logs.length,1);assert.equal(heard.at(-1),15);
  c.advance(10*60000);assert.equal(timer.snapshot().kind,'short_break');assert.deepEqual(logs.map(x=>x.reason),['work-start','work-end']);
  assert.equal(timer.validPrompt(logs.at(-1)),true);assert.equal(timer.validPrompt(logs[0]),false);
  const n=heard.length;c.advance(60000);assert.equal(heard.length,n);
  assert.equal(timer.snapshot().kind,'pomodoro');assert.equal(timer.snapshot().variant,'focus');assert.equal(timer.snapshot().durationSeconds,1500);
  assert.deepEqual(logs.map(x=>x.reason),['work-start','work-end','work-start']);timer.close();
});

test('Deep Pomodoro is quiet during breaks and retains the three-minute work pattern without logs',()=>{
  const c=clock(),heard=[],logs=[];
  const timer=engine(c,{prefs:{autoBreak:true,autoFocus:true,shortBreakMinutes:1},onChime:n=>heard.push(n),onCheckIn:e=>logs.push(e)});
  timer.start('pomodoro',16*60,{variant:'deep'});c.advance(16*60000);
  assert.deepEqual(heard,[1,3,6,9,12,15]);assert.equal(timer.snapshot().kind,'short_break');
  c.advance(60000);assert.equal(timer.snapshot().kind,'pomodoro');assert.equal(timer.snapshot().variant,'deep');assert.equal(timer.snapshot().durationSeconds,960);
  c.advance(60000);assert.equal(heard.at(-1),1);assert.equal(logs.length,0);timer.close();
});

test('pausing continuous sessions excludes paused time and resumes a fresh pitch cycle',()=>{
  for(const kind of ['focus','deep']){
    const c=clock(),heard=[],logs=[];const timer=engine(c,{onChime:n=>heard.push(n),onCheckIn:e=>logs.push(e)});
    timer.start(kind);c.advance(4*60000);timer.pause();const elapsed=timer.elapsed(),count=heard.length;
    c.advance(10*60000);assert.equal(timer.elapsed(),elapsed);assert.equal(timer.remaining(),null);assert.equal(heard.length,count);
    timer.resume();c.advance(60000);assert.equal(timer.elapsed(),elapsed+60000);assert.equal(heard.at(-1),1);assert.equal(logs.length,0);timer.close();
  }
  const c=clock(),logs=[];const timer=engine(c,{onCheckIn:e=>logs.push(e)});timer.start('pomodoro',1500,{variant:'focus'});timer.pause();timer.resume();assert.equal(logs.length,1);timer.close();
});

test('countdown extension and Pomodoro skip preserve applicable controls and variant',()=>{
  const c=clock(),timer=engine(c);timer.start('timer',60);c.advance(10000);assert.equal(timer.extend(30),true);assert.equal(timer.remaining(),80000);
  timer.pause();timer.extend(30);c.advance(50000);assert.equal(timer.remaining(),110000);timer.resume();c.advance(10000);assert.equal(timer.remaining(),100000);
  assert.equal(timer.extend(604800),false);assert.equal(timer.skip(),false);
  timer.start('pomodoro',1800,{variant:'deep'});assert.equal(timer.skip(),true);assert.equal(timer.snapshot().status,'idle');assert.equal(timer.data.nextKind,'short_break');assert.equal(timer.data.nextVariant,'deep');assert.equal(timer.data.nextWorkSeconds,1800);assert.equal(timer.data.round,0);timer.close();
});

test('sleep skips missed cues and completion takes priority at a minute boundary',()=>{
  const c=clock(),heard=[],ended=[];const timer=engine(c,{onChime:n=>heard.push(n),onFinish:e=>ended.push(e.kind)});
  timer.start('focus');c.jump(10*60000+10000);timer.tick();assert.equal(heard.length,0);
  timer.start('timer',60);c.jump(60001);timer.tick();timer.tick();assert.deepEqual(ended,['timer']);timer.close();
  const exact=clock(Date.UTC(2026,9,11,10)),cues=[],logs=[];const end=[];
  const pom=engine(exact,{onChime:n=>cues.push(n),onCheckIn:e=>logs.push(e.reason),onFinish:e=>end.push(e.kind)});
  pom.start('pomodoro',900,{variant:'focus'});exact.advance(900000);
  assert.deepEqual(cues,Array.from({length:14},(_,i)=>i+1));assert.deepEqual(logs,['work-start','work-end']);assert.deepEqual(end,['pomodoro']);pom.close();
});

test('restarting retains live continuous cycles without replaying a boundary or adding a duration',t=>{
  const file=path.join(temp(t),'session.json'),c=clock(),heard=[];
  const a=engine(c,{file,onChime:n=>heard.push(n)});a.start('focus');c.advance(15*60000);a.close();
  const b=engine(c,{file,onChime:n=>heard.push(n)});b.load();b.tick();assert.equal(heard.length,15);assert.equal(b.remaining(),null);
  c.advance(60000);assert.equal(heard.at(-1),1);assert.equal(b.elapsed(),16*60000);b.close();
});

test('legacy recovery retains previous finite work and settings, and silently clears overdue work',t=>{
  const file=path.join(temp(t),'session.json'),c=clock();
  fs.writeFileSync(file,JSON.stringify({version:2,round:2,nextKind:'focus',current:{id:'3',kind:'focus',mode:'chimes',status:'running',durationSec:1800,startedAt:c.now(),endsAt:c.now()+1800000,remainingMs:1800000}}));
  let finished=0,prompts=0;const timer=engine(c,{file,prefs:{autoBreak:true,autoFocus:true},onFinish:()=>finished++,onCheckIn:()=>prompts++});timer.load();
  assert.equal(timer.snapshot().kind,'pomodoro');assert.equal(timer.snapshot().variant,'focus');assert.equal(timer.snapshot().durationSeconds,1800);assert.equal(timer.data.round,2);assert.ok(fs.existsSync(file+'.v2-backup'));timer.close();
  c.jump(3600000);const recovered=engine(c,{file,prefs:{autoBreak:true,autoFocus:true},onFinish:()=>finished++,onCheckIn:()=>prompts++});recovered.load();
  assert.equal(recovered.snapshot().status,'idle');assert.equal(finished,0);assert.equal(prompts,0);recovered.close();
  fs.writeFileSync(file,JSON.stringify({version:1,round:3,days:{old:{focus:10}},current:{kind:'meditation',status:'paused',durationSec:600,remainingMs:32000,endsAt:c.now()+10000}}));
  const old=engine(c,{file});old.load();assert.equal(old.remaining(),32000);assert.equal(old.data.round,3);assert.equal(old.data.days,undefined);assert.ok(fs.existsSync(file+'.v1-backup'));old.close();
});

test('restart keeps a one-off Pomodoro extension separate from subsequent work intervals',t=>{
  const file=path.join(temp(t),'session.json'),c=clock();
  const a=engine(c,{file});a.start('pomodoro',600,{variant:'deep'});a.extend(300);a.close();
  const b=engine(c,{file,prefs:{autoBreak:true,autoFocus:true,shortBreakMinutes:1/60}});b.load();
  assert.equal(b.snapshot().durationSeconds,900);assert.equal(b.data.current.workSeconds,600);
  c.advance(900000);assert.equal(b.snapshot().kind,'short_break');c.advance(1000);
  assert.equal(b.snapshot().kind,'pomodoro');assert.equal(b.snapshot().variant,'deep');assert.equal(b.snapshot().durationSeconds,600);b.close();
});

function promptHost(c,valid=()=>true){
  let visible=false;const calls=[],errors=[],ctx={},api={
    IsVisible:async()=>visible,ShowApp:async()=>{visible=true;calls.push('show');},ChangeQuery:async(_ctx,q)=>calls.push(q)
  };
  const queue=new PromptQueue({...c,api,ctx,valid,onError:e=>errors.push(e)});
  return {queue,calls,errors,visible:v=>{visible=v;},api};
}

test('log opening is deferred until after Wox hides, then routes to l with the caret ready',async()=>{
  const c=clock(),p=promptHost(c),event={reason:'work-start',generation:1,intervalId:'1',issuedAt:c.now()};
  p.visible(true);p.queue.push(event);assert.deepEqual(p.calls,[]);assert.equal(p.queue.items.length,1);
  c.advance(200);await flush();assert.deepEqual(p.calls,[]);
  p.visible(false);c.advance(500);await flush();assert.deepEqual(p.calls,['show',{QueryType:'input',QueryText:'l '}]);assert.equal(p.queue.items.length,0);p.queue.close();
});

test('work-end log survives an automatic break, but manual stop or replacement cancels old prompts',async()=>{
  const c=clock();let p;const timer=engine(c,{prefs:{autoBreak:true},onCheckIn:e=>p.queue.push(e),onChange:()=>p?.queue.prune()});p=promptHost(c,e=>timer.validPrompt(e));
  p.visible(true);timer.start('pomodoro',1,{variant:'focus'});c.advance(1000);await flush();
  assert.equal(timer.snapshot().kind,'short_break');assert.deepEqual(p.queue.items.map(x=>x.event.reason),['work-end']);
  p.visible(false);c.advance(500);await flush();assert.equal(p.calls[1].QueryText,'l ');
  p.visible(true);timer.start('pomodoro',100,{variant:'focus'});timer.start('meditation',100);p.queue.prune();assert.equal(p.queue.items.length,0);
  timer.start('pomodoro',100,{variant:'focus'});timer.stop();p.queue.prune();assert.equal(p.queue.items.length,0);
  p.queue.close();timer.close();
});

test('occupied Wox queries are never overwritten by expired log prompts',async()=>{
  const c=clock(),p=promptHost(c);p.visible(true);p.queue.push({reason:'cycle',generation:1,intervalId:'1',issuedAt:c.now()});
  c.jump(60001);await p.queue.drain();p.visible(false);await p.queue.drain();assert.deepEqual(p.calls,[]);assert.equal(p.queue.items.length,0);p.queue.close();
});

test('cancelled in-flight prompts cannot type into a new session or discard its queued prompt',async()=>{
  const c=clock(),p=promptHost(c);let release;
  p.api.ShowApp=()=>new Promise((_,reject)=>{release=()=>reject(Error('window closed'));});
  const first={reason:'cycle',generation:1,intervalId:'1',issuedAt:c.now()};
  p.queue.push(first);const running=p.queue.drain();await flush();p.queue.clear();
  const second={reason:'work-start',generation:2,intervalId:'2',issuedAt:c.now()};p.queue.push(second);release();await running;
  assert.equal(p.queue.items.length,1);assert.equal(p.queue.items[0].event,second);assert.equal(p.calls.length,0);p.queue.close();
});

test('Wox detached callbacks, Enter hiding, MRU upgrades and continuous controls work together',async t=>{
  const {plugin,query,handlers}=await host(t),detachedQuery=plugin.query;
  const med=(await detachedQuery({}, {RawQuery:'med10',TriggerKeyword:'*'})).Results[0];
  assert.match(med.Title,/10 min/);assert.equal(med.Actions[0].PreventHideAfterAction,false);await med.Actions[0].Action({});assert.equal(plugin.timer.snapshot().durationSeconds,600);
  for(const raw of ['pom focus 30 seconds','pom 30 seconds deep','mana pom plain 30 seconds','focus pom 30 seconds']){
    const row=(await query(raw)).Results[0];assert.equal(row.Actions[0].PreventHideAfterAction,false);await row.Actions[0].Action({});assert.equal(plugin.timer.snapshot().kind,'pomodoro');assert.equal(plugin.timer.snapshot().durationSeconds,30);
  }
  for(const raw of ['focus','deep']){
    await (await query(raw)).Results[0].Actions[0].Action({});assert.equal(plugin.timer.snapshot().kind,raw);assert.equal(plugin.timer.snapshot().indefinite,true);
    const live=(await query('mana')).Results[0];assert.match(live.Title,/elapsed/);assert.ok(!live.Actions.some(a=>['extend','skip'].includes(a.Id)));assert.equal(live.Score,100);
  }
  const legacy=await handlers.mru({}, {ContextData:{kind:'focus',mode:'quiet',minutes:'25'}});assert.match(legacy.Title,/Pomodoro/);await legacy.Actions[0].Action({});assert.equal(plugin.timer.snapshot().variant,'plain');
  const continuous=await handlers.mru({}, {ContextData:{schema:'3',kind:'focus',variant:'plain',indefinite:'true'}});assert.equal(continuous.Title,'Start Focus');await continuous.Actions[0].Action({});assert.equal(plugin.timer.snapshot().indefinite,true);
  assert.equal(await handlers.mru({}, {ContextData:{kind:'focus'}}),null);assert.equal((await query('l still going')).Results.length,0);
});

test('all start modes have distinct clock choices and help describes operation without settings',async t=>{
  const {plugin,query}=await host(t),rows=(await query('mana')).Results.filter(x=>x.Id?.startsWith('mana.start.'));
  assert.equal(rows.length,7);assert.equal(new Set(rows.map(x=>x.Icon.ImageData)).size,7);
  assert.equal(new Set(Object.values(CLOCKS)).size,Object.keys(CLOCKS).length);
  assert.ok(Object.values(CLOCKS).every(x=>x.codePointAt(0)>=0x1f550&&x.codePointAt(0)<=0x1f566));
  const help=plugin.helpRows();for(const row of help)assert.doesNotMatch(row.Title+' '+row.SubTitle,/\bsettings\b|\bconfig\b|sound selection|daily progress|buy milk/i);
  for(const prefix of ['focus','deep','pom','med','timer'])assert.ok(help.some(x=>x.Title.startsWith(prefix+' —')));
  assert.deepEqual((await query('pom')).Results.map(x=>x.Title.split(' ·')[0]),['Start Pomodoro','Start Focus Pomodoro','Start Deep Pomodoro']);
});

test('metadata keeps upgrade identity and all live settings while documenting every mode',()=>{
  const m=require(path.join(PLUGIN_ROOT,'plugin.json')),old=require('../original/plugin.json');
  assert.equal(m.Id,old.Id);assert.equal(m.Name,'Wox.Plugin.Manasikāra');assert.equal(m.Version,'2.0.1');assert.equal(m.Author,'Archetype444');assert.match(m.Website,/^https:\/\/github\.com\/[^/]+(?:\/[^/]+)?$/);
  assert.deepEqual(m.TriggerKeywords,['mana','focus','deep','pom','pomodoro','med','timer','*']);
  assert.deepEqual(new Set(m.SettingDefinitions.filter(x=>x.Value.Key).map(x=>x.Value.Key)),new Set(Object.keys(DEFAULTS)));
  for(const phrase of ['CONTINUOUS FOCUS','CONTINUOUS DEEP FOCUS','Focus Pomodoro','Deep Pomodoro','MEDITATION AND TIMER','CONTROLS','beginning and end','Node.js'])assert.ok(m.Description.includes(phrase),phrase);
  for(const name of ['index.js','timer.js','commands.js','prompts.js'])assert.doesNotMatch(fs.readFileSync(path.join(PLUGIN_ROOT,name),'utf8'),/buy milk|dailyGoal|streak|sample text|mindful progress/i);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT,'notes.js')),false);
});

test('meditation uses the attached ending, timers and Pomodoro use Soft bowl, and Stop always silences',async t=>{
  const {plugin,query}=await host(t),played=[];let stops=0;
  plugin.audio.play=async(...args)=>played.push(args);plugin.audio.stop=async()=>{stops++;};
  for(const raw of ['med1s','timer1s','pom1s']){
    await (await query(raw)).Results[0].Actions[0].Action({});plugin.timer.data.current.endsAt=Date.now()-1;plugin.timer.tick();
  }
  plugin.play('chime',15);assert.deepEqual(played,[['mudita','meditation',65],['bowl','finish',65],['bowl','finish',65],['brass','chime-15',35]]);
  await (await query('mana stop')).Results[0].Actions[0].Action({});assert.ok(stops>=4);assert.equal(plugin.timer.snapshot().status,'idle');assert.equal(plugin.prompts.items.length,0);
});
