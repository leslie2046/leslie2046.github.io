import fs from 'node:fs';
import { createHash } from 'node:crypto';
const rows=JSON.parse(fs.readFileSync('public/data/medication-observations.json','utf8'));
const symptoms=JSON.parse(fs.readFileSync('public/data/medication-symptoms.json','utf8'));
for(const s of symptoms){if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.date))throw Error('Invalid symptom date');for(const key of ['dizziness','headache'])if(!['有','无','未记录'].includes(s[key]))throw Error('Invalid symptom status');}
const fields=['systolic','diastolic','heartRate'];
for(const r of rows){if(!Number.isFinite(Date.parse(r.time))||!r.time.endsWith('+08:00'))throw Error('Expected a recorded timestamp with +08:00 timezone');for(const key of fields)if(r[key]!=null&&(!Number.isFinite(r[key])||r[key]<=0))throw Error(`Invalid ${key}`);}
rows.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
if(!rows.length)throw Error('No observations');
if(new Set(rows.map(r=>Date.parse(r.time))).size!==rows.length)throw Error('Duplicate measurement timestamp');
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const values=rows.flatMap(r=>fields.map(k=>r[k]).filter(v=>v!=null));
const lo=Math.max(0,Math.floor((Math.min(...values)-15)/20)*20),hi=Math.ceil((Math.max(...values)+15)/20)*20;
const first=Date.parse(rows[0].time),last=Date.parse(rows.at(-1).time),span=Math.max(last-first,3600000);
const x=t=>100+(Date.parse(t)-first)/span*700,y=v=>385-(v-lo)/(hi-lo)*245;
const label=time=>time.slice(5,10).replace('-','/')+' '+time.slice(11,16);
const series=[{key:'systolic',name:'收缩压',unit:'mmHg',color:'#a64e36',offset:-15,dash:''},{key:'diastolic',name:'舒张压',unit:'mmHg',color:'#52716c',offset:24,dash:'7 4'},{key:'heartRate',name:'心率',unit:'次/分',color:'#79603f',offset:-12,dash:'2 5'}];
const dates=[...new Set([...rows.map(r=>r.time.slice(0,10)),...symptoms.map(s=>s.date)])].sort();
const dayMs=86400000,calendarStart=Date.parse(dates[0]+'T00:00:00Z');
const calendarOffset=(new Date(calendarStart).getUTCDay()+6)%7;
const calendarWeeks=Math.ceil(((Date.parse(dates.at(-1)+'T00:00:00Z')-calendarStart)/dayMs+calendarOffset+1)/7);
const chartHeight=512+calendarWeeks*80+50;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${chartHeight}" role="img" aria-labelledby="title desc"><title id="title">停药计划：血压与心率时间记录</title><desc id="desc">横轴按实际日期时间等比例排列，时区为北京时间。${rows.map(r=>`${label(r.time)}，血压${r.systolic}/${r.diastolic}毫米汞柱，心率${r.heartRate}次每分`).join('；')}。左轴为血压，右轴为心率。${symptoms.map(s=>`${s.date}，头晕或头昏：${s.dizziness}，头痛：${s.headache}`).join('；')}</desc><rect width="900" height="${chartHeight}" rx="16" fill="#f8f6f0"/><g font-family="system-ui,Microsoft YaHei,sans-serif" fill="#302f2a"><text x="38" y="40" font-size="24">血压与心率 · 持续记录</text><text x="38" y="70" font-size="14" fill="#6b6a62">实际测量时间（北京时间） · 仅显示已记录数据</text><text x="38" y="121" font-size="14">血压（mmHg）</text><text x="862" y="121" text-anchor="end" font-size="14">心率（次/分）</text>`;
for(let tick=lo;tick<=hi;tick+=20){svg+=`<line x1="100" x2="800" y1="${y(tick)}" y2="${y(tick)}" stroke="#dedbd2"/><text x="82" y="${y(tick)+5}" text-anchor="end" font-size="14" fill="#6b6a62">${tick}</text><text x="818" y="${y(tick)+5}" font-size="14" fill="#6b6a62">${tick}</text>`;}
series.forEach((s,j)=>{let points=[];const flush=()=>{if(points.length)svg+=`<polyline points="${points.join(' ')}" fill="none" stroke="${s.color}" stroke-width="3" ${s.dash?`stroke-dasharray="${s.dash}"`:''}/>`;points=[];};
svg+=`<line x1="${325+j*145}" x2="${350+j*145}" y1="94" y2="94" stroke="${s.color}" stroke-width="3" ${s.dash?`stroke-dasharray="${s.dash}"`:''}/><text x="${358+j*145}" y="99" font-size="15">${s.name}</text>`;
for(const r of rows){const v=r[s.key];if(v==null){flush();continue;}points.push(`${x(r.time)},${y(v)}`);}flush();
for(const r of rows){const v=r[s.key];if(v==null)continue;svg+=`<circle cx="${x(r.time)}" cy="${y(v)}" r="4.5" fill="${s.color}"><title>${escape(label(r.time)+' '+s.name+' '+v+' '+s.unit)}</title></circle>`;if(rows.length<=18)svg+=`<text x="${x(r.time)}" y="${y(v)+s.offset}" font-size="16" text-anchor="middle" fill="${s.color}" font-weight="600">${v}</text>`;}
});
const ticks=rows.length<=6?rows.map(r=>r.time):Array.from({length:6},(_,i)=>new Date(first+(last-first)*i/5+8*3600000).toISOString().slice(0,19)+'+08:00');
for(const time of ticks)svg+=`<line x1="${x(time)}" x2="${x(time)}" y1="140" y2="385" stroke="#dedbd2" stroke-dasharray="2 5" opacity=".5"/><text x="${x(time)}" y="428" text-anchor="middle" font-size="15" fill="#6b6a62">${escape(label(time))}</text>`;
svg+='<text x="100" y="467" font-size="15" fill="#6b6a62">每日症状 · 头痛、头晕／头昏</text>';
for(const [i,item] of [{label:'均无',color:'#24864b'},{label:'有症状',color:'#cc3535'},{label:'未记录',color:'#858585'}].entries()){
 const lx=500+i*103;
 svg+=`<circle cx="${lx}" cy="462" r="6" fill="${item.color}"/><text x="${lx+13}" y="467" font-size="13" fill="#6b6a62">${item.label}</text>`;
}
['一','二','三','四','五','六','日'].forEach((name,i)=>{svg+=`<text x="${150+i*100}" y="499" text-anchor="middle" font-size="13" fill="#77796f">周${name}</text>`;});
for(let index=0;index<calendarWeeks*7;index++){
 const cx=100+(index%7)*100,cy=512+Math.floor(index/7)*80;
 svg+=`<rect x="${cx+3}" y="${cy}" width="94" height="74" rx="7" fill="#fffdf7" stroke="#dedbd2"/>`;
}
for(const date of dates){
 const index=Math.round((Date.parse(date+'T00:00:00Z')-calendarStart)/dayMs)+calendarOffset;
 const cx=150+(index%7)*100,cy=512+Math.floor(index/7)*80;
 const s=symptoms.find(s=>s.date===date)||{dizziness:'未记录',headache:'未记录'};
 const present=s.dizziness==='有'||s.headache==='有',complete=s.dizziness==='无'&&s.headache==='无';
 const color=present?'#cc3535':complete?'#24864b':'#858585';
 const status=present?'有症状':complete?'均无':'未记录';
 const description=date+' 头晕／头昏：'+s.dizziness+'，头痛：'+s.headache;
 svg+=`<g role="img" aria-label="${escape(description)}"><title>${escape(description)}</title><text x="${cx}" y="${cy+23}" text-anchor="middle" font-size="14" fill="#302f2a">${escape(date.slice(5).replace('-','/'))}</text><circle cx="${cx-25}" cy="${cy+49}" r="9" fill="${color}"/><text x="${cx-9}" y="${cy+54}" font-size="12" fill="#4b4e46">${status}</text></g>`;
}
svg+=`<text x="450" y="${chartHeight-15}" text-anchor="middle" font-size="12" fill="#6b6a62">每天一盏灯；红灯表示至少有一项症状，绿灯表示两项均无。</text></g></svg>`;
const directory='public/images/health';
fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/medication-timeline.svg',svg);
const version=createHash('sha256').update(svg).digest('hex').slice(0,12);
const filename='medication-timeline.'+version+'.svg';
for(const file of fs.readdirSync(directory))if(/^medication-timeline[.][a-f0-9]{12}[.]svg$/.test(file)&&file!==filename)fs.unlinkSync(directory+'/'+file);
fs.writeFileSync(directory+'/'+filename,svg);
const articlePath='src/content/posts/blood-pressure-medication-day-1.md';
const article=fs.readFileSync(articlePath,'utf8');
const reference=/\/images\/health\/medication-timeline(?:\.[a-f0-9]{12})?\.svg(?:\?[^)\s]*)?/g;
const updated=article.replace(reference,'/images/health/'+filename);
if(updated===article&&!article.includes('/images/health/'+filename))throw Error('Chart reference not found in diary');
if(updated!==article)fs.writeFileSync(articlePath,updated);
console.log(`Rendered ${rows.length} observations on one actual-time chart.`);
