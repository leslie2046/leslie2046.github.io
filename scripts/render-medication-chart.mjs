import fs from 'node:fs';
import { createHash } from 'node:crypto';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const rows = read('public/data/medication-observations.json').sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
const symptoms = read('public/data/medication-symptoms.json');
const phases = read('public/data/medication-phases.json').sort((a, b) => a.date.localeCompare(b.date));
const fields = ['systolic', 'diastolic', 'heartRate'];
if (!rows.length) throw Error('No observations');
for (const row of rows) {
  if (!Number.isFinite(Date.parse(row.time)) || !row.time.endsWith('+08:00')) throw Error('Invalid recorded timestamp');
  for (const key of fields) if (row[key] != null && (!Number.isFinite(row[key]) || row[key] <= 0)) throw Error('Invalid ' + key);
}
if (new Set(rows.map(r => Date.parse(r.time))).size !== rows.length) throw Error('Duplicate timestamp');
for (const day of symptoms) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day.date)) throw Error('Invalid symptom date');
  for (const key of ['dizziness', 'headache']) if (!['有', '无', '未记录'].includes(day[key])) throw Error('Invalid symptom status');
}
for (const phase of phases) if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(phase.date) || !phase.label) throw Error('Invalid medication phase');

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateLabel = date => date.slice(5, 10).replace('-', '/');
const timeLabel = row => row.time.slice(11, 16) + (row.timeSource === 'message-time-provisional' ? '*' : '');
const fullLabel = row => dateLabel(row.time) + ' ' + timeLabel(row);
const left = 90, right = 910, width = right - left;
const first = Date.parse(rows[0].time), last = Date.parse(rows.at(-1).time), span = Math.max(last - first, 3600000);
const x = time => left + (Date.parse(time) - first) / span * width;
const mapY = (value, min, max, top, bottom) => bottom - (value - min) / (max - min) * (bottom - top);
const bpValues = rows.flatMap(r => [r.systolic, r.diastolic]).filter(v => v != null);
const hrValues = rows.map(r => r.heartRate).filter(v => v != null);
const bpMin = Math.max(0, Math.floor(Math.min(40, ...bpValues) / 20) * 20);
const bpMax = Math.ceil(Math.max(160, ...bpValues) / 20) * 20;
const hrMin = Math.max(0, Math.floor(Math.min(40, ...hrValues) / 10) * 10);
const hrMax = Math.ceil(Math.max(120, ...hrValues) / 10) * 10;
const bpY = value => mapY(value, bpMin, bpMax, 260, 500);
const hrY = value => mapY(value, hrMin, hrMax, 650, 850);
const dates = [...new Set([...rows.map(r => r.time.slice(0, 10)), ...symptoms.map(s => s.date)])].sort();
const dayMs = 86400000, calendarStart = Date.parse(dates[0] + 'T00:00:00Z');
const offset = (new Date(calendarStart).getUTCDay() + 6) % 7;
const weeks = Math.ceil(((Date.parse(dates.at(-1) + 'T00:00:00Z') - calendarStart) / dayMs + offset + 1) / 7);
const calendarTop = 1030, height = calendarTop + weeks * 86 + 90;
const ticks = rows.length <= 7 ? rows.map(row => ({time: row.time, provisional: row.timeSource === 'message-time-provisional'})) :
  Array.from({length: 6}, (_, i) => ({time: new Date(first + (last - first) * i / 5 + 8 * 3600000).toISOString().slice(0, 19) + '+08:00', provisional: false}));
const latest = rows.at(-1), ink = '#30362d', muted = '#747b6e', grid = '#dfe4d8';
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" role="img" aria-labelledby="title desc"><title id="title">停药观察：血压、心率与每日症状</title><desc id="desc">${esc(rows.map(r => fullLabel(r) + ' 血压' + r.systolic + '/' + r.diastolic + ' mmHg，心率' + r.heartRate + '次/分').join('；'))}。血压与心率上下分图，按相同日期时间位置绘制。参考带用于观察，不是个人停药标准。症状按每日反馈显示红绿灯。</desc><rect width="1000" height="${height}" rx="16" fill="#faf9f4"/><g font-family="system-ui,Microsoft YaHei,sans-serif" fill="${ink}">`;
const text = (xx, yy, value, size = 16, fill = ink, extra = '') => `<text x="${xx}" y="${yy}" font-size="${size}" fill="${fill}" ${extra}>${esc(value)}</text>`;
const line = (x1, y1, x2, y2, color = grid, dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" ${dash ? 'stroke-dasharray="' + dash + '"' : ''}/>`;
const band = (lo, hi, yy, color, id) => `<rect data-band="${id}" x="${left}" y="${yy(hi)}" width="${width}" height="${yy(lo)-yy(hi)}" fill="${color}"/>`;
svg += text(42, 45, '停药观察', 28, ink, 'font-weight="600"');
svg += text(958, 45, '最新记录 · ' + fullLabel(latest), 16, muted, 'text-anchor="end"');
svg += text(42, 77, '血压与心率分图 · 相同时间轴 · 每日症状灯', 16, muted);
svg += text(left, 112, '用药阶段 · 按日期标记', 14, muted);
for (let i = 0; i < phases.length; i++) {
  const phase = phases[i], start = Date.parse(phase.date + 'T00:00:00+08:00');
  const end = i + 1 < phases.length ? Date.parse(phases[i+1].date + 'T00:00:00+08:00') : last;
  if (end < first || start > last) continue;
  const xx = Math.max(left, x(new Date(start).toISOString())), endX = Math.min(right, x(new Date(end).toISOString()));

  svg += `<rect x="${xx}" y="126" width="${Math.max(1, endX-xx)}" height="40" rx="6" fill="${['#deebf7', '#e7ebf0', '#ece0f6'][i % 3]}"><title>${esc(phase.date + '起：' + phase.label)}</title></rect>`;

}

svg += text(left+12, 152, phases.map(phase => dateLabel(phase.date) + '起 ' + phase.label).join(' · '), 14, '#536347');

function medicationStrip(top) {
  return phases.map((phase,i) => {
    const start = Date.parse(phase.date+'T00:00:00+08:00');
    const end = phases[i+1] ? Date.parse(phases[i+1].date+'T00:00:00+08:00') : last;
    if (end < first || start > last) return '';
    const xx = Math.max(left,x(new Date(start).toISOString())), endX = Math.min(right,x(new Date(end).toISOString()));
    return `<rect data-medication-phase="${phase.date}" x="${xx}" y="${top}" width="${Math.max(1,endX-xx)}" height="14" fill="${['#397cba','#64748b','#9961b8'][i%3]}"><title>${esc(phase.label)}</title></rect>`;
  }).join('');
}

function axes(min, max, step, yy, top, bottom, unit) {
  let out = text(left-15, top-12, unit, 13, muted, 'text-anchor="end"');
  for (let value = min; value <= max; value += step) {
    out += line(left, yy(value), right, yy(value));
    out += text(left-15, yy(value)+5, value, 14, muted, 'text-anchor="end"');
  }
  for (const tick of ticks) {
    const xx = x(tick.time);
    out += line(xx, top, xx, bottom, grid, '3 5');
    out += text(xx, bottom+29, dateLabel(tick.time), 14, muted, 'text-anchor="middle"');
    out += text(xx, bottom+49, tick.time.slice(11,16) + (tick.provisional ? '*' : ''), 14, muted, 'text-anchor="middle"');
  }
  for (const phase of phases) {
    const stamp = Date.parse(phase.date + 'T00:00:00+08:00');
    if (stamp > last) continue;
    const xx = Math.max(left, x(new Date(stamp).toISOString()));
    if (xx <= right) out += line(xx, top, xx, bottom, '#8d997c', '5 5');
  }
  return out;
}
function plot(key, yy, color, dash = '') {
  let out = '', points = [];
  const flush = () => {
    if (points.length) out += `<polyline data-series="${key}" points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" ${dash ? 'stroke-dasharray="'+dash+'"' : ''}/>`;
    points = [];
  };
  for (const row of rows) { if (row[key] == null) { flush(); continue; } points.push(x(row.time)+','+yy(row[key])); }
  flush();
  for (const row of rows) {
    if (row[key] == null) continue;
    const provisional = row.timeSource === 'message-time-provisional';
    out += `<circle data-reading="${key}" cx="${x(row.time)}" cy="${yy(row[key])}" r="5" stroke="${color}" stroke-width="2" fill="${provisional ? '#fffdf7' : color}"><title>${esc(fullLabel(row)+' '+key+' '+row[key]+(provisional ? '；时间暂按消息时间记录' : ''))}</title></circle>`;
    if (rows.length <= 18) out += text(x(row.time) + (row === rows[0] ? 10 : 0), yy(row[key]) + (key === 'diastolic' ? 23 : -15), row[key], 17, color, 'text-anchor="' + (row === rows[0] ? 'start' : 'middle') + '" font-weight="600"');
  }
  return out;
}
svg += text(left, 209, '01  血压', 24, ink, 'font-weight="600"');
svg += text(right, 209, '最新 ' + latest.systolic + '/' + latest.diastolic + ' mmHg', 18, '#a4543a', 'text-anchor="end"');
svg += text(left, 238, '收缩压参考 90–<135', 15, '#a4543a');
svg += text(365, 238, '舒张压参考 60–<85 mmHg', 15, '#3d746e');
svg += band(90, 135, bpY, '#f5e9de', 'systolic-90-135');
svg += band(60, 85, bpY, '#e4f0e9', 'diastolic-60-85');
svg += axes(bpMin, bpMax, 20, bpY, 260, 500, 'mmHg');
for (const boundary of [90, 135]) svg += line(left, bpY(boundary), right, bpY(boundary), '#c49a82', '6 4');
for (const boundary of [60, 85]) svg += line(left, bpY(boundary), right, bpY(boundary), '#7ca296', '6 4');
svg += medicationStrip(260);
svg += plot('systolic', bpY, '#a4543a');
svg += plot('diastolic', bpY, '#3d746e', '7 4');
svg += text(left, 607, '02  心率', 24, ink, 'font-weight="600"');
svg += text(right, 607, '最新 ' + latest.heartRate + ' 次/分', 18, '#586c4a', 'text-anchor="end"');
svg += text(left, 635, '60–100 常见静息参考', 15, '#47714c');
svg += text(370, 635, '50–<60 观察带；<50 或 >100 留意带', 14, muted);
svg += band(hrMin, 50, hrY, '#f7e6e3', 'heart-low');
svg += band(50, 60, hrY, '#f7efdb', 'heart-observe');
svg += band(60, 100, hrY, '#e5efdf', 'heart-reference-60-100');
svg += band(100, hrMax, hrY, '#f7e6e3', 'heart-high');
svg += axes(hrMin, hrMax, 20, hrY, 650, 850, '次/分');
for (const boundary of [50, 60, 100]) svg += line(left, hrY(boundary), right, hrY(boundary), '#a2af94', '6 4');
svg += medicationStrip(650);
svg += plot('heartRate', hrY, '#586c4a');
svg += text(left, 934, '* 空心点：时间按消息时间暂记。折线只连接已有记录，不补缺测值。', 14, muted);
svg += text(left, 978, '03  每日症状', 24, ink, 'font-weight="600"');
for (const [i, item] of [{name:'均无', color:'#24864b'}, {name:'有症状', color:'#cc3535'}, {name:'未记录', color:'#858585'}].entries()) {
  const xx = 560 + i*115;
  svg += `<circle cx="${xx}" cy="972" r="6" fill="${item.color}"/>` + text(xx+13, 978, item.name, 14, muted);
}
const cellW = width/7;
['一','二','三','四','五','六','日'].forEach((day,i) => { svg += text(left+(i+.5)*cellW, calendarTop-12, '周'+day, 14, muted, 'text-anchor="middle"'); });
for (let index = 0; index < weeks*7; index++) {
  const xx = left+(index%7)*cellW, yy = calendarTop+Math.floor(index/7)*86;
  svg += `<rect x="${xx+3}" y="${yy}" width="${cellW-6}" height="78" rx="7" fill="#fffdf7" stroke="${grid}"/>`;
}
for (const date of dates) {
  const index = Math.round((Date.parse(date+'T00:00:00Z')-calendarStart)/dayMs)+offset;
  const xx = left+(index%7+.5)*cellW, yy = calendarTop+Math.floor(index/7)*86;
  const day = symptoms.find(s => s.date === date) || {dizziness:'未记录', headache:'未记录'};
  const present = day.dizziness === '有' || day.headache === '有';
  const complete = day.dizziness === '无' && day.headache === '无';
  const color = present ? '#cc3535' : complete ? '#24864b' : '#858585';
  const status = present ? '有症状' : complete ? '均无' : '未记录';
  const detail = date+' 头痛：'+day.headache+'，头晕／头昏：'+day.dizziness;
  svg += `<g data-symptom-date="${date}" role="img" aria-label="${esc(detail)}"><title>${esc(detail)}</title>` + text(xx, yy+25, dateLabel(date), 15, ink, 'text-anchor="middle"');
  svg += `<circle cx="${xx-26}" cy="${yy+52}" r="9" fill="${color}"/>` + text(xx-10, yy+57, status, 13) + '</g>';
}
svg += text(left, height-49, '症状为当日反馈：红灯＝头痛或头晕／头昏；绿灯＝两项均无。', 14, muted);
svg += text(left, height-20, '阴影为观察参考带，不用于单次诊断，也不是个人减药或停药标准。', 14, muted);
svg += '</g></svg>';
const directory = 'public/images/health';
fs.mkdirSync(directory, {recursive:true});
fs.writeFileSync(directory+'/medication-timeline.svg', svg);
const version = createHash('sha256').update(svg).digest('hex').slice(0,12);
const filename = 'medication-timeline.'+version+'.svg';
// Keep old versioned images available for cached article pages.
fs.writeFileSync(directory+'/'+filename, svg);
const articlePath = 'src/content/posts/blood-pressure-medication-day-1.md';
const article = fs.readFileSync(articlePath, 'utf8');
const reference = /\/images\/health\/medication-timeline(?:\.[a-f0-9]{12})?\.svg(?:\?[^)\s]*)?/g;
const updated = article.replace(reference, '/images/health/'+filename);
if (updated === article && !article.includes('/images/health/'+filename)) throw Error('Chart reference not found');
if (updated !== article) fs.writeFileSync(articlePath, updated);
console.log('Rendered '+rows.length+' observations, aligned BP/HR panels and '+dates.length+' symptom days.');
