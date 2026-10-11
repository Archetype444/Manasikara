'use strict';
// This only opens the existing l capture shortcut. It never writes notes.
class PromptQueue{
  constructor({api,ctx,valid,onError=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{api,ctx,valid,onError,now,setTimer,clearTimer});this.items=[];this.handle=null;this.busy=false;this.closed=false;}
  push(event){
    if(this.closed)return;const key=event.generation+':'+event.intervalId+':'+event.reason+':'+event.issuedAt;
    if(!this.items.some(x=>x.key===key))this.items.push({key,event,deadline:this.now()+60000});
    // Wox hides after the action callback returns. Defer the opening until then.
    this.schedule(200);
  }
  schedule(delay=500){if(this.closed||this.handle!==null||!this.items.length)return;this.handle=this.setTimer(()=>{this.handle=null;this.drain();},delay);this.handle?.unref?.();}
  prune(){this.items=this.items.filter(x=>x.deadline>=this.now()&&this.valid(x.event));if(!this.items.length&&this.handle!==null){this.clearTimer(this.handle);this.handle=null;}}
  async drain(){
    if(this.closed||this.busy)return;this.busy=true;let item;
    try{
      this.prune();item=this.items[0];if(!item)return;
      if(await this.api.IsVisible(this.ctx))return;
      if(this.closed||!this.items.includes(item)||!this.valid(item.event))return;
      await this.api.ShowApp(this.ctx);
      if(this.closed||!this.items.includes(item)||!this.valid(item.event))return;
      await this.api.ChangeQuery(this.ctx,{QueryType:'input',QueryText:'l '});this.items=this.items.filter(x=>x!==item);
    }catch(e){this.items=this.items.filter(x=>x!==item);this.onError('Could not open the activity log: '+e.message);}
    finally{this.busy=false;this.schedule();}
  }
  clear(){this.items=[];if(this.handle!==null)this.clearTimer(this.handle);this.handle=null;}
  close(){this.closed=true;this.clear();}
}
module.exports={PromptQueue};
