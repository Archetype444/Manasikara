'use strict';
// Used only by the tag-triggered GitHub workflow, after tests and packaging.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'src/plugin.json'),'utf8'));
const repository=process.env.GITHUB_REPOSITORY;
const token=process.env.GITHUB_TOKEN;
const tag=process.env.GITHUB_REF_NAME;
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')||!token)throw Error('GitHub workflow credentials are required.');
if(tag!=='v'+metadata.Version)throw Error('The tag must match the plugin metadata version.');
const base='https://api.github.com/repos/'+repository;
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{...headers,...options.headers}});
  if(!response.ok)throw Error('GitHub release request failed: '+response.status);
  return response.json();
}
async function main(){
  const found=await fetch(base+'/releases/tags/'+encodeURIComponent(tag),{headers});
  let release;
  if(found.status===404)release=await request(base+'/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,name:metadata.Name+' '+metadata.Version,draft:false,prerelease:false,body:'Continuous focus and deep focus, three Pomodoro variants, meditation and timers. Built from the tagged source after the automated regression checks passed.'})});
  else {if(!found.ok)throw Error('Could not check the existing release: '+found.status);release=await found.json();}
  const name='Manasikara-v'+metadata.Version+'.wox';
  const file=path.join(root,'deliverables',name);
  if(!fs.existsSync(file))throw Error('The tested package is missing.');
  if(release.assets?.some(asset=>asset.name===name)){console.log('The release already has '+name+'; it was left unchanged.');return;}
  const upload=release.upload_url.replace(/\{.*$/,'');
  if(new URL(upload).hostname!=='uploads.github.com')throw Error('Unexpected release upload host.');
  await request(upload+'?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:fs.readFileSync(file)});
  console.log('Published '+release.html_url);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
