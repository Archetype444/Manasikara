'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');

const PROFILES=Object.freeze({bowl:'Soft bowl',brass:'Brass bowl',resonance:'Resonant bowl'});
const MEDITATION_PROFILES=Object.freeze({...PROFILES,mudita:'Mudita Bell - Melodic Mirth'});
const WORKER=String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$player = $null
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($null -ne $player) { $player.Stop(); $player.Dispose(); $player = $null }
    if ($request.action -eq 'play') {
      if (-not [System.IO.File]::Exists($request.file)) { throw 'The sound file is missing.' }
      $player = New-Object System.Media.SoundPlayer
      $player.SoundLocation = [string]$request.file
      $player.Load()
      $player.Play()
    }
    [Console]::Out.WriteLine((@{id=$request.id;ok=$true} | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{id=$request.id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))
  }
}
if ($null -ne $player) { $player.Stop(); $player.Dispose() }
`;

// Attenuate only this plugin's PCM samples; never change the system volume.
function attenuateWav(source, volume) {
  const b=Buffer.from(source);
  if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('Invalid sound file.');
  let pcm=false,dataAt=-1,dataSize=0;
  for(let at=12;at+8<=b.length;) {
    const size=b.readUInt32LE(at+4),id=b.toString('ascii',at,at+4);
    if(at+8+size>b.length)throw Error('Truncated sound file.');
    if(id==='fmt '&&size>=16)pcm=b.readUInt16LE(at+8)===1&&b.readUInt16LE(at+22)===16;
    if(id==='data'){dataAt=at+8;dataSize=size;}
    at+=8+size+(size%2);
  }
  if(!pcm||dataAt<0||dataSize%2)throw Error('Sound must use 16-bit PCM WAV.');
  const gain=Math.min(100,Math.max(0,Number(volume)||0))/100;
  for(let at=dataAt;at<dataAt+dataSize;at+=2)b.writeInt16LE(Math.round(b.readInt16LE(at)*gain),at);
  return b;
}

class AudioPlayer {
  constructor(directory,cache,onError=()=>{},platform=process.platform,spawnProcess=spawn) {
    this.spawn=spawnProcess;this.directory=directory;this.cache=cache;this.onError=onError;this.platform=platform;
    this.child=null;this.pending=new Map();this.serial=0;this.readyPromise=null;this.closed=false;
  }
  ready() {
    if(this.closed)return Promise.reject(Error('Audio player is closed.'));
    if(this.readyPromise)return this.readyPromise;
    if(this.platform!=='win32')return Promise.resolve();
    this.readyPromise=new Promise((resolve,reject)=>{
      const exe=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const child=this.spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',WORKER],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      this.child=child;let settled=false,failed=false;
      const timer=setTimeout(()=>fail(Error('Windows audio did not start.')),10000);
      const fail=error=>{
        if(failed)return;failed=true;
        clearTimeout(timer);if(!settled){settled=true;reject(error);}
        if(this.child!==child)return;this.readyPromise=null;this.child=null;
        for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(error);this.pending.delete(id);}
        if(!child.killed)child.kill();
      };
      child.on('error',fail);child.on('exit',()=>fail(Error('Windows audio stopped.')));
      child.stdin.on('error',fail);child.stderr.on('data',()=>{});
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.ready){clearTimeout(timer);settled=true;resolve();return;}
        const p=this.pending.get(message.id);if(!p)return;
        clearTimeout(p.timer);this.pending.delete(message.id);
        message.ok?p.resolve():p.reject(Error(message.error || 'Audio playback failed.'));
      });
    });
    return this.readyPromise;
  }
  async send(request) {
    await this.ready();const child=this.child;
    if(!child||child.killed)throw Error('Audio is unavailable.');
    return new Promise((resolve,reject)=>{
      const id=++this.serial;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Audio playback did not respond.'));},5000);
      this.pending.set(id,{resolve,reject,timer});
      child.stdin.write(JSON.stringify({...request,id})+'\n',error=>{
        if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
      });
    });
  }
  file(profile,event,volume) {
    const profiles=event==='meditation'?MEDITATION_PROFILES:PROFILES;
    if(!Object.hasOwn(profiles,profile)||! /^(?:chime-(?:[1-9]|1[0-5])|meditation|finish)$/.test(event))throw Error('Unknown sound.');
    const level=Math.min(100,Math.max(0,Math.round(Number(volume)||0)));
    const original=path.join(this.directory,'sounds',profile,event+'.wav');
    const target=path.join(this.cache,'audio-v2',`${profile}-${event}-${level}.wav`);
    if(!fs.existsSync(target)){
      fs.mkdirSync(path.dirname(target),{recursive:true});
      const data=attenuateWav(fs.readFileSync(original),level);
      const temp=target+'.'+process.pid+'.tmp';fs.writeFileSync(temp,data);fs.renameSync(temp,target);
    }
    return target;
  }
  async play(profile,event,volume) {
    if(Number(volume)<=0)return;
    try {
      const file=this.file(profile,event,volume);
      if(this.platform==='win32')await this.send({action:'play',file});
      else {
        if(this.child&&!this.child.killed)this.child.kill();
        const command=this.platform==='darwin'?'afplay':'paplay';
        await new Promise((resolve,reject)=>{
          const child=this.spawn(command,[file],{stdio:'ignore'});this.child=child;
          child.once('error',reject);child.once('spawn',resolve);
          child.once('exit',code=>{if(code&& !this.closed)this.onError(Error('Audio playback failed.'));});
        });
      }
    }catch(error){this.onError(error);throw error;}
  }
  async stop(){if(this.platform==='win32'&&this.child)await this.send({action:'stop'});else if(this.child)this.child.kill();}
  close(){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Audio player closed.'));}this.pending.clear();if(this.child){this.child.stdin?.end();this.child.kill();}this.child=null;this.readyPromise=null;}
}
module.exports={AudioPlayer,PROFILES,MEDITATION_PROFILES,attenuateWav};
