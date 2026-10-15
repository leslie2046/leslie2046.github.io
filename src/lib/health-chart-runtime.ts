import { init, use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { TitleComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent, AxisPointerComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
use([LineChart, TitleComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent, AxisPointerComponent, SVGRenderer]);
export { init };
