import type { EChartsCoreOption } from 'echarts/core';

export interface Observation { time: string; systolic: number; diastolic: number; heartRate: number; timeSource?: string; }
export interface SymptomDay { date: string; dizziness: string; headache: string; }
export interface MedicationPhase { date: string; label: string; }
export interface TimeWindow { start: number; end: number; }
export const DAY = 86_400_000;
const beijingDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const beijingTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
export function dateKey(time: number) { return beijingDate.format(time); }
export function formatTime(time: number, short = false) { return (short ? dateKey(time).slice(5).replace('-', '/') : dateKey(time)) + ' ' + beijingTime.format(time); }
export function extent(rows: Observation[]): TimeWindow {
  if (!rows.length) throw new Error('No observations');
  const times = rows.map(row => Date.parse(row.time));
  return { start: Date.parse(dateKey(Math.min(...times)) + 'T00:00:00+08:00'), end: Date.parse(dateKey(Math.max(...times)) + 'T00:00:00+08:00') + DAY - 1 };
}
export function rangeWindow(rows: Observation[], days: number | 'all'): TimeWindow {
  const all = extent(rows);
  return { start: days === 'all' ? all.start : Math.max(all.start, all.end + 1 - days * DAY), end: all.end };
}
export function normalizeWindow(window: TimeWindow, all: TimeWindow): TimeWindow {
  const width = Math.min(all.end - all.start, Math.max(3_600_000, window.end - window.start));
  const start = Math.max(all.start, Math.min(window.start, all.end - width));
  return { start, end: start + width };
}
export function dayStatus(day?: SymptomDay) {
  if (day?.dizziness === '有' || day?.headache === '有') return { state: 'red', label: '有症状' };
  if (day?.dizziness === '无' && day?.headache === '无') return { state: 'green', label: '均无' };
  return { state: 'grey', label: '未记录' };
}
export function monthCells(month: string, symptoms: SymptomDay[]) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year!, number! - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > count) return null;
    const date = month + '-' + String(day).padStart(2, '0');
    const record = symptoms.find(item => item.date === date);
    return { date, day, ...dayStatus(record), description: date + '，头痛：' + (record?.headache || '未记录') + '，头晕／头昏：' + (record?.dizziness || '未记录') };
  });
}
export function adjacentMonth(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + delta, 1));
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
}

export function createChartOption(rows: Observation[], phases: MedicationPhase[], window: TimeWindow, navigator: boolean, dark = false): EChartsCoreOption {
  const all = extent(rows), text = dark ? '#e9e8e0' : '#30362d', muted = dark ? '#b0b5a8' : '#747b6e';
  const grid = dark ? '#41483c' : '#e1e5dc';
  const value = (key: 'systolic' | 'diastolic' | 'heartRate') => rows.map(row => ({ value: [Date.parse(row.time), row[key]], symbol: row.timeSource === 'message-time-provisional' ? 'emptyCircle' : 'circle' }));
  const axisLabel = (epoch: number) => dateKey(epoch).slice(5).replace('-', '/') + (window.end - window.start <= 2 * DAY ? '\n' + beijingTime.format(epoch) : '');
  const phaseLines = phases.map(phase => ({ xAxis: Date.parse(phase.date + 'T00:00:00+08:00'), name: phase.date + ' ' + phase.label }));
  const markLine = { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#8b987e', type: 'dashed' }, data: phaseLines };
  const xAxis = [0, 1].map(index => ({ type: 'time', splitNumber: 3, gridIndex: index, min: all.start, max: all.end, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: muted, fontSize: 11, hideOverlap: true, formatter: axisLabel }, axisPointer: { label: { formatter: (p: { value: number }) => formatTime(Number(p.value), true) } } }));
  const tooltip = (input: unknown) => {
    const first = Array.isArray(input) ? input[0] : input;
    const item = first as { value?: [number, number] } | undefined;
    const stamp = item?.value?.[0];
    const row = rows.find(row => Date.parse(row.time) === Number(stamp));
    if (!row) return '';
    return formatTime(Date.parse(row.time)) + (row.timeSource === 'message-time-provisional' ? ' *暂记时间' : '') + '\n血压  ' + row.systolic + '/' + row.diastolic + ' mmHg\n心率  ' + row.heartRate + ' 次/分';
  };
  const bpMin = Math.max(0, Math.floor(Math.min(40, ...rows.map(r => r.diastolic)) / 20) * 20);
  const bpMax = Math.ceil(Math.max(160, ...rows.map(r => r.systolic)) / 20) * 20;
  const hrMin = Math.max(0, Math.floor(Math.min(40, ...rows.map(r => r.heartRate)) / 10) * 10);
  const hrMax = Math.ceil(Math.max(120, ...rows.map(r => r.heartRate)) / 10) * 10;
  return {
    animation: false, useUTC: true, backgroundColor: 'transparent', textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
    title: [{ text: '血压 · mmHg', subtext: '参考：90–<135 / 60–<85', left: 0, top: 4, textStyle: { color: text, fontSize: 17 }, subtextStyle: { color: muted, fontSize: 11 } }, { text: '心率 · 次/分', subtext: '常见静息参考：60–100', left: 0, top: 322, textStyle: { color: text, fontSize: 17 }, subtextStyle: { color: muted, fontSize: 11 } }],
    legend: { top: 58, left: 0, itemGap: 18, textStyle: { color: text, fontSize: 12 }, data: ['收缩压', '舒张压', '心率'] },
    grid: [{ left: 42, right: 16, top: 100, height: 165 }, { left: 42, right: 16, top: 390, height: 145 }],
    xAxis,
    yAxis: [{ type: 'value', min: bpMin, max: bpMax, interval: 20, gridIndex: 0, axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: grid } } }, { type: 'value', min: hrMin, max: hrMax, interval: 20, gridIndex: 1, axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: grid } } }],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }], snap: true },
    tooltip: { trigger: 'axis', triggerOn: 'mousemove|click', confine: true, renderMode: 'richText', formatter: tooltip, backgroundColor: dark ? '#252b22' : '#fffef9', borderColor: grid, textStyle: { color: text, fontSize: 13 } },
    dataZoom: [
      { id: 'health-inside', type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', startValue: window.start, endValue: window.end, minValueSpan: 3_600_000, zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: true },
      { id: 'health-slider', type: 'slider', xAxisIndex: [0, 1], filterMode: 'none', startValue: window.start, endValue: window.end, minValueSpan: 3_600_000, show: navigator, bottom: 12, height: 28, borderColor: grid, textStyle: { color: muted }, labelFormatter: (value: number) => formatTime(value, true), handleStyle: { color: '#6f835d' }, fillerColor: dark ? '#83996b33' : '#83996b25', dataBackground: { lineStyle: { color: '#9aab8d' }, areaStyle: { color: '#cdd8c1' } } }
    ],
    series: [
      { name: '收缩压', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: value('systolic'), showSymbol: rows.length <= 100, symbolSize: 7, label: { show: false }, itemStyle: { color: '#b65b3e' }, lineStyle: { width: 2 }, connectNulls: false, markLine, markArea: { silent: true, label: { show: false }, itemStyle: { color: dark ? '#a7663d22' : '#f5e9de' }, data: [[{ yAxis: 90 }, { yAxis: 135 }]] } },
      { name: '舒张压', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: value('diastolic'), showSymbol: rows.length <= 100, symbolSize: 7, label: { show: false }, itemStyle: { color: '#448179' }, lineStyle: { width: 2, type: 'dashed' }, connectNulls: false, markArea: { silent: true, label: { show: false }, itemStyle: { color: dark ? '#42817022' : '#e4f0e9' }, data: [[{ yAxis: 60 }, { yAxis: 85 }]] } },
      { name: '心率', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: value('heartRate'), showSymbol: rows.length <= 100, symbolSize: 7, label: { show: false }, itemStyle: { color: '#6c8657' }, lineStyle: { width: 2 }, connectNulls: false, markLine, markArea: { silent: true, label: { show: false }, data: [[{ yAxis: hrMin, itemStyle: { color: dark ? '#9c333322' : '#f7e6e3' } }, { yAxis: 50 }], [{ yAxis: 50, itemStyle: { color: dark ? '#9b792522' : '#f7efdb' } }, { yAxis: 60 }], [{ yAxis: 60, itemStyle: { color: dark ? '#55794433' : '#e5efdf' } }, { yAxis: 100 }], [{ yAxis: 100, itemStyle: { color: dark ? '#9c333322' : '#f7e6e3' } }, { yAxis: hrMax }]] } }
    ]
  };
}
