'use strict';
const {parseTime}=require('./time');
const {DEFAULT_KIND,isContinuous}=require('./timer');
const KEYWORDS=['mana','focus','deep','pom','pomodoro','med','timer'];
function inputFor(query){
  const trigger=String(query.TriggerKeyword||'').toLowerCase(),raw=String(query.RawQuery||'').trim();
  const match=raw.match(/^(pomodoro|mana|focus|deep|pom|med|timer)(?=$|\s|\d)\s*(.*)$/i);
  if(match)return {prefix:match[1].toLowerCase(),text:match[2]};
  if(KEYWORDS.includes(trigger))return {prefix:trigger,text:[query.Command||'',query.Search||''].join(' ').trim()};
  return null;
}
function startCommand(input,prefs,now=Date.now()){
  let text=input.text.trim(),prefix=input.prefix,kind,variant='plain',explicitVariant=false;
  if(prefix==='mana'){
    const match=text.match(/^(short break|long break|pomodoro|meditation|meditate|breathe|focus|deep|timer|short|long|break|pom|med)(?=$|\s|\d)\s*(.*)$/i);
    if(match){prefix=match[1].toLowerCase();text=match[2];}else prefix='pom';
  }
  kind=['med','meditate','meditation','breathe'].includes(prefix)?'meditation':['short','break','short break'].includes(prefix)?'short_break':['long','long break'].includes(prefix)?'long_break':['pom','pomodoro'].includes(prefix)?'pomodoro':prefix;
  if(isContinuous(kind)){
    const pom=text.match(/^(pomodoro|pom)(?=$|\s|\d)\s*(.*)$/i);
    if(pom){variant=kind;explicitVariant=true;kind='pomodoro';text=pom[2];}
  }
  if(kind==='pomodoro'){
    text=text.replace(/^(plain|quiet|focus|chimes|deep)(?=\d)/i,'$1 ');
    text=text.replace(/\b(plain|quiet|focus|chimes|deep)\b/gi,word=>{
      const choice=/^(plain|quiet)$/i.test(word)?'plain':/^(focus|chimes)$/i.test(word)?'focus':'deep';
      if(explicitVariant&&variant!==choice)throw Error('Choose one Pomodoro variant.');
      variant=choice;explicitVariant=true;return '';
    }).trim();
  }
  const spec=text?parseTime(text,now):isContinuous(kind)?{indefinite:true}:{seconds:prefs[DEFAULT_KIND[kind]]*60,absolute:false};
  return {kind,variant,explicitVariant,spec};
}
module.exports={KEYWORDS,inputFor,startCommand};
