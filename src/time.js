'use strict';

const MAX_SECONDS = 7 * 24 * 3600;
const NUMBERS = Object.freeze({zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,a:1,an:1});
const NUMBER_WORDS = '(?:' + Object.keys(NUMBERS).join('|') + '|hundred|thousand|and)';

function numberWords(raw) {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  let total=0, group=0, found=false;
  for (const word of raw.trim().split(/[\s-]+/)) {
    if (word === 'and') continue;
    if (Object.hasOwn(NUMBERS,word)) { group+=NUMBERS[word]; found=true; }
    else if (word === 'hundred') { group=(group || 1)*100; found=true; }
    else if (word === 'thousand') { total+=(group || 1)*1000; group=0; found=true; }
    else return null;
  }
  return found ? total+group : null;
}

function normalize(raw) {
  return String(raw).toLowerCase().trim().replace(/[’']/g, "'")
    .replace(/(\d+)½/g, (_,n)=>String(Number(n)+0.5))
    .replace(/(\d+)¼/g, (_,n)=>String(Number(n)+0.25))
    .replace(/(\d+)¾/g, (_,n)=>String(Number(n)+0.75))
    .replace(/½/g,'0.5').replace(/¼/g,'0.25').replace(/¾/g,'0.75')
    .replace(/\s+/g,' ');
}

function validSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    throw Error('Choose a duration between one second and seven days.');
  }
  return Math.round(seconds);
}

function duration(raw) {
  let text=normalize(raw).replace(/^(?:for|in)\s+/,'').replace(/\s+(?:from now|please)$/,'');
  text=text.replace(/\b(hours?|minutes?|seconds?) and (?:a )?(half|quarter)\b/g,(_,unit,part)=>`${unit} ${part==='half'?'0.5':'0.25'} ${unit}`);
  text=text.replace(new RegExp('(' + NUMBER_WORDS + '(?:[ -]+' + NUMBER_WORDS + ')*|\\d+(?:\\.\\d+)?) and (?:a )?(half|quarter)(?= (?:hours?|minutes?|seconds?))','g'),
    (_,whole,part)=>String(numberWords(whole)+(part==='half'?0.5:0.25)));
  text=text.replace(/three[ -]quarters?(?: of)? (?:an? )?/g,'0.75 ')
    .replace(/(?:a )?quarter(?: of)? (?:an? )?/g,'0.25 ')
    .replace(/half(?: of)? (?:an? )?/g,'0.5 ');
  text=text.replace(new RegExp('\\b' + NUMBER_WORDS + '(?:[ -]+' + NUMBER_WORDS + ')*\\b','g'), match=>{
    const value=numberWords(match); return value===null ? match : String(value);
  });
  text=text.replace(/\b(?:and)\b/g,' ').replace(/,/g,' ').trim();
  text=text.replace(/(^|\s)\.(\d)/g,'$10.$2');
  if (/^\d+(?:\.\d+)?$/.test(text)) return validSeconds(Number(text)*60);
  const colon=text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    if (Number(colon[2])>59 || (colon[3] && Number(colon[3])>59)) throw Error('Clock fields must be below 60.');
    return validSeconds(colon[3] ? Number(colon[1])*3600+Number(colon[2])*60+Number(colon[3]) : Number(colon[1])*60+Number(colon[2]));
  }
  let total=0, end=0, found=false;
  // A boundary before the next numeric component allows compact forms such as 1h30m.
  const compact=/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?=\s|\d|$)/g;
  for (const match of text.matchAll(compact)) {
    if (text.slice(end,match.index).trim()) throw Error('The duration contains unrecognised text.');
    const unit=match[2][0]; total+=Number(match[1])*(unit==='h'?3600:unit==='m'?60:1);
    end=match.index+match[0].length; found=true;
  }
  if (!found || text.slice(end).trim()) throw Error('Enter a duration or an end time.');
  return validSeconds(total);
}

function until(raw, now=Date.now()) {
  let text=normalize(raw).replace(/^(?:until|till|til|to|at)\s*/,'');
  let day=null;
  if (/\btomorrow\b/.test(text)) {day=1;text=text.replace(/\btomorrow\b/,'').trim();}
  if (/\btoday\b/.test(text)) {if(day!==null)throw Error('Choose one day.');day=0;text=text.replace(/\btoday\b/,'').trim();}
  text=text.replace(/^(?:at|by)\s+/,'').replace(/\s+please$/,'')
    .replace(/a\.m\.?/g,'am').replace(/p\.m\.?/g,'pm')
    .replace(/\bin the morning\b/,'am').replace(/\b(?:in the afternoon|in the evening|tonight)\b/,'pm').trim();
  let offset=0;
  const relative=text.match(/^(quarter|half|\d+|[a-z -]+?)\s+(past|to)\s+(.+)$/);
  if(relative) {
    const mins=relative[1]==='quarter'?15:relative[1]==='half'?30:numberWords(relative[1]);
    if(mins===null||mins<1||mins>59)throw Error('Unrecognised end time.');
    offset=relative[2]==='to'?-mins:mins;text=relative[3];
  }
  text=text.replace(/\bmidnight\b/,'12am').replace(/\bnoon\b/,'12pm');
  // Clock words, including “five thirty pm”, are distinct from duration sums.
  text=text.replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z -]+?)(?=\s*(?:am|pm)?$)/, (all,h,m)=>{
    const n=numberWords(m.trim());return n!==null&&n>=0&&n<60?`${NUMBERS[h]}:${String(n).padStart(2,'0')}`:all;
  });
  text=text.replace(new RegExp('\\b' + NUMBER_WORDS + '(?:[ -]+' + NUMBER_WORDS + ')*\\b','g'), m=>{
    const n=numberWords(m);return n===null?m:String(n);
  }).replace(/\s*(am|pm)$/,'$1');
  const match=text.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
  if(!match)throw Error('Unrecognised end time.');
  let hour=Number(match[1]),minute=Number(match[2]||0);
  const second=Number(match[3]||0),period=match[4];
  if(minute>59||second>59||hour>23||(period&&(hour<1||hour>12)))throw Error('Invalid end time.');
  if(period)hour=hour%12+(period==='pm'?12:0);
  const total=(hour*60+minute+offset+1440)%1440;hour=Math.floor(total/60);minute=total%60;
  const current=new Date(now),target=new Date(now);
  if(day!==null)target.setDate(current.getDate()+day);
  target.setHours(hour,minute,second,0);
  if(day===null&&target.getTime()<=now){
    // Bare one–twelve means the next occurrence; an explicit clock is 24-hour.
    if(!period&&!match[2]&&Number(match[1])>=1&&Number(match[1])<12&&hour<12){
      target.setHours(hour+12);
      if(target.getTime()<=now)target.setDate(target.getDate()+1);
    }else target.setDate(target.getDate()+1);
  }
  if(target.getTime()<=now)throw Error('That end time has already passed.');
  const seconds=validSeconds((target.getTime()-now)/1000);
  return {seconds,endsAt:target.getTime()};
}

function parseTime(raw, now=Date.now()) {
  const text=normalize(raw);
  if (/^(?:until|till|til|to|at)(?=\s|\d)/.test(text)) return {...until(text,now),absolute:true};
  return {seconds:duration(text),absolute:false};
}

function formatDuration(seconds) {
  let left=Math.max(0,Math.ceil(seconds));const chunks=[];
  const h=Math.floor(left/3600);left%=3600;const m=Math.floor(left/60);left%=60;
  if(h)chunks.push(`${h} h`);if(m)chunks.push(`${m} min`);if(left)chunks.push(`${left} sec`);
  return chunks.join(' ') || '0 sec';
}
function prettyClock(ms) {
  const s=Math.max(0,Math.ceil(ms/1000)), h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function endLabel(timestamp, now=Date.now()) {
  const d=new Date(timestamp), n=new Date(now);const time=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  return d.toDateString()===n.toDateString()?time:`${d.toLocaleDateString('en-GB').replace(/\//g,'-')} ${time}`;
}
module.exports={parseTime,duration,until,numberWords,prettyClock,formatDuration,endLabel,MAX_SECONDS};
