// VOL-1: the volume histogram under the trade candles. It shares the chart's time scale (no own pan or zoom),
// lives on its own overlay price scale (`volume`) so it never sets the candle range, and has no labels.
// Added before the candlestick series, so the candles and position zones draw on top of it.
import type { ChartTheme } from "@/lib/theme";
import { candleBottomMargin, volumeHistogramData, volumeScaleMargins } from "@/lib/volume";
import type { Candle } from "@/lib/trades";

type LWC = typeof import("lightweight-charts");
type IChartApi = import("lightweight-charts").IChartApi;
export type VolumeSeries = import("lightweight-charts").ISeriesApi<"Histogram">;
type UTCTimestamp = import("lightweight-charts").UTCTimestamp;

export const VOLUME_SCALE_ID = "volume";

/** Create the (initially hidden) volume series. Call before the candlestick series is added. */
export function addVolumePane(chart: IChartApi, lwc: LWC): VolumeSeries {
  const series = chart.addSeries(lwc.HistogramSeries, {
    priceScaleId: VOLUME_SCALE_ID,
    base: 0,
    visible: false,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  chart.priceScale(VOLUME_SCALE_ID).applyOptions({
    visible: false, borderVisible: false, ticksVisible: false, scaleMargins: volumeScaleMargins(0),
  });
  return series;
}

/**
 * Show the bars' volume, or clear and hide the pane. Also moves the candle scale up so candles sit
 * above the band. `heightPx` is the chart height: the band is shorter on phone-height charts.
 */
export function paintVolumePane(
  chart: IChartApi,
  series: VolumeSeries,
  bars: readonly Candle[],
  theme: ChartTheme,
  visible: boolean,
  heightPx: number,
) {
  series.applyOptions({ visible });
  series.setData(visible ? volumeHistogramData(bars, theme).map((point) => ({
    time: Math.floor(point.time / 1000) as UTCTimestamp,
    value: point.value,
    color: point.color,
  })) : []);
  chart.priceScale(VOLUME_SCALE_ID).applyOptions({ scaleMargins: volumeScaleMargins(heightPx) });
  chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.14, bottom: candleBottomMargin(heightPx, visible) } });
}
