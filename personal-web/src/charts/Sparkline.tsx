type Props = { values: (number | null)[]; color: string };

const W = 100;
const H = 30;
const PAD = 3;

export function Sparkline({ values, color }: Props) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  const span = max - min;

  const x = (i: number) => (values.length <= 1 ? W / 2 : PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const y = (v: number) => {
    const t = span > 0 && Number.isFinite(span) ? (v - min) / span : 0.5;
    return H - PAD - t * (H - PAD * 2);
  };

  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ x: x(i), y: y(v) });
    }
  });
  if (run.length) runs.push(run);

  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0');
  const d = runs
    .filter((r) => r.length > 1)
    .map((r) => r.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' '))
    .join(' ');
  const dots = runs.filter((r) => r.length === 1).map((r) => r[0]!);

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {d && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {dots.map((p, i) => (
        <circle key={i} cx={fmt(p.x)} cy={fmt(p.y)} r={2.5} fill={color} />
      ))}
    </svg>
  );
}
