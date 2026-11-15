// List thumbnail from the ~40 stored closes. Neutral on purpose: no red flood in the feed (UX-65).
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <svg className="sparkline" viewBox="0 0 64 30" aria-hidden="true"><path d="M2 15H62" strokeDasharray="2 4" /></svg>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (index: number) => 2 + (index / (points.length - 1)) * 60;
  const y = (value: number) => 27 - ((value - min) / span) * 24;
  const path = points.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  return <svg className="sparkline" viewBox="0 0 64 30" aria-hidden="true"><path d={path} /><circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2" /></svg>;
}
