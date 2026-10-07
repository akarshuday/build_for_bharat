import { STATS } from '../data';
import { useCountUp } from '../hooks/useCountUp';

function Stat({ target, suffix, label, index }: { target: number; suffix: string; label: string; index: number }) {
  const { ref, value } = useCountUp(target, index);
  return (
    <div className="stat anim" style={{ '--d': `${0.5 + index * 0.08}s` } as React.CSSProperties}>
      <span ref={ref} className="stat-value">{Math.round(value)}{suffix}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function Stats() {
  return (
    <footer className="stats" aria-label="Key facts">
      {STATS.map((s, i) => <Stat key={s.label} {...s} index={i} />)}
    </footer>
  );
}
