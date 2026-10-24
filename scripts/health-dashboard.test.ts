import test from 'node:test';
import assert from 'node:assert/strict';
import { init, use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { TitleComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent, AxisPointerComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { adjacentMonth, createChartOption, dateKey, dayStatus, extent, monthCells, normalizeWindow, rangeWindow, DAY, phaseAt, phaseColor } from '../src/lib/health-dashboard.ts';
use([LineChart, TitleComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent, AxisPointerComponent, SVGRenderer]);
const rows = Array.from({ length: 120 }, (_, i) => ({ time: new Date(Date.parse('2026-12-01T08:00:00+08:00') + Math.floor(i / 2) * DAY + (i % 2) * 11 * 3600000).toISOString(), systolic: 108 + i % 8, diastolic: 70 + i % 5, heartRate: 67 + i % 11 }));
test('seven-day window uses Beijing dates across a year boundary; all preserves sixty days', () => {
  const window = rangeWindow(rows, 7);
  assert.equal(dateKey(window.start), '2027-01-23');
  assert.equal(dateKey(window.end), '2027-01-29');
  assert.equal(rows.filter(row => Date.parse(row.time) >= window.start).length, 14);
  assert.equal(rangeWindow(rows, 'all').end - rangeWindow(rows, 'all').start, 60 * DAY - 1);
  assert.deepEqual(normalizeWindow({ start: 0, end: 1e15 }, extent(rows)), extent(rows));
});
test('sixty-day chart renders at phone width and zooms both panels without dropping observations', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 320, height: 620 });
  try {
    chart.setOption(createChartOption(rows, [{ date: '2026-12-01', label: '阶段起点' }], rangeWindow(rows, 'all'), true));
    const svg = chart.renderToSVGString();
    assert.match(svg, /width="320"/); assert.doesNotMatch(svg, /NaN/); assert.match(svg, /收缩压/);
    const window = rangeWindow(rows, 7);
    chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'health-inside', startValue: window.start, endValue: window.end });
    const option = chart.getOption() as { dataZoom: { startValue: number; endValue: number; xAxisIndex: number[]; filterMode: string }[]; series: { data: unknown[] }[] };
    for (const zoom of option.dataZoom) {
      assert.equal(zoom.startValue, window.start); assert.equal(zoom.endValue, window.end);
      assert.deepEqual(zoom.xAxisIndex, [0, 1]); assert.equal(zoom.filterMode, 'none');
    }
    for (const series of option.series) assert.equal(series.data.length, 120);
  } finally { chart.dispose(); }
});
test('calendar handles leap years, missing reports, symptoms and year navigation', () => {
  assert.equal(monthCells('2028-02', []).filter(Boolean).length, 29);
  const cells = monthCells('2026-10', [{ date: '2026-10-14', headache: '无', dizziness: '无' }, { date: '2026-10-15', headache: '有', dizziness: '无' }]);
  assert.equal(cells.find(cell => cell?.date === '2026-10-14')?.state, 'green');
  assert.equal(cells.find(cell => cell?.date === '2026-10-15')?.state, 'red');
  assert.equal(cells.find(cell => cell?.date === '2026-10-16')?.state, 'grey');
  assert.equal(dayStatus({ date: 'x', headache: '无', dizziness: '' }).state, 'grey');
  assert.equal(adjacentMonth('2026-12', 1), '2027-01');
  assert.equal(adjacentMonth('2027-01', -1), '2026-12');
});
test('provisional measurement times stay marked in point and tooltip', () => {
  const record = { ...rows[0]!, timeSource: 'message-time-provisional' };
  const option = createChartOption([record], [], rangeWindow([record], 7), false) as { series: { data: { symbol: string }[] }[]; tooltip: { formatter: (input: unknown) => string } };
  assert.equal(option.series[0]!.data[0]!.symbol, 'emptyCircle');
  assert.match(option.tooltip.formatter([{ value: [Date.parse(record.time), record.systolic] }]), /暂记时间/);
});

test('medication phase colors and tooltips follow Beijing-date transitions in both panels', () => {
  const phases = [{date:'2026-12-01',label:'美托洛尔半片'}, {date:'2026-12-03',label:'停美托洛尔'}, {date:'2026-12-11',label:'恢复美托洛尔半片'}];
  assert.equal(phaseAt(phases, Date.parse('2026-12-02T23:59:00+08:00'))?.label, phases[0]!.label);
  assert.equal(phaseAt(phases, Date.parse('2026-12-03T00:00:00+08:00'))?.label, phases[1]!.label);
  assert.equal(phaseAt(phases, Date.parse('2026-12-11T00:00:00+08:00'))?.label, phases[2]!.label);
  const option = createChartOption(rows, phases, rangeWindow(rows,'all'),true) as { series: { markArea?: {data: {xAxis?:number;itemStyle?:{color:string}}[][]} }[]; tooltip:{formatter:(input:unknown)=>string} };
  for (const index of [0,2]) {
    const bands = option.series[index]!.markArea!.data.filter(area => area[0]?.xAxis !== undefined);
    assert.equal(bands.length,3); assert.deepEqual(bands.map(area=>area[0]!.itemStyle!.color), [0,1,2].map(phaseColor));
    assert.equal(bands[0]![1]!.xAxis, Date.parse('2026-12-03T00:00:00+08:00'));
  }
  const row = rows[6]!;
  assert.match(option.tooltip.formatter([{value:[Date.parse(row.time), row.systolic]}]), /用药  停美托洛尔/);
  const chart = init(null,undefined,{renderer:'svg',ssr:true,width:320,height:620});
  try {
    chart.setOption(option);const svg=chart.renderToSVGString();
    for (const color of [0,1,2].map(phaseColor)) assert.ok(svg.includes(color));
    chart.dispatchAction({type:'dataZoom',dataZoomId:'health-inside',startValue:Date.parse('2026-12-10T00:00:00+08:00'),endValue:Date.parse('2026-12-12T00:00:00+08:00')});
    const zoomed=chart.renderToSVGString(); assert.ok(zoomed.includes(phaseColor(1)));assert.ok(zoomed.includes(phaseColor(2)));assert.doesNotMatch(zoomed,/NaN/);
  } finally {chart.dispose();}
});
