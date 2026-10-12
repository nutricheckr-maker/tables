"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/engine/analytics";
import { fmtPct } from "@/lib/format";

/** Daily accuracy as columns on a fixed 50–100% scale (below 50% clamps to the floor). */
export function AccuracyChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-sm text-muted">No sessions yet.</p>;

  const W = 600;
  const H = 140;
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const floor = 0.5;
  const y = (v: number) => pad.t + ih * (1 - (Math.max(floor, v) - floor) / (1 - floor));
  const slot = iw / Math.max(data.length, 7);
  const bw = Math.max(4, Math.min(28, slot - 2));
  const h = hover !== null ? data[hover] : null;

  return (
    <figure>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily accuracy">
          {[0.5, 0.75, 0.95, 1].map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray={g === 0.95 ? "3 3" : undefined} />
              <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--faint)">
                {Math.round(g * 100)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * slot + (slot - bw) / 2;
            const top = y(d.accuracy);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
                <rect
                  x={x}
                  y={top}
                  width={bw}
                  height={Math.max(2, pad.t + ih - top)}
                  rx={2}
                  fill="var(--accent)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              </g>
            );
          })}
          <text x={pad.l} y={H - 4} fontSize="10" fill="var(--faint)">
            {data[0]!.day.slice(5)}
          </text>
          <text x={W - pad.r} y={H - 4} fontSize="10" fill="var(--faint)" textAnchor="end">
            {data[data.length - 1]!.day.slice(5)}
          </text>
        </svg>
        {h && (
          <div className="pointer-events-none absolute right-0 top-0 rounded border border-line bg-surface px-2 py-1 text-xs shadow-sm">
            <span className="text-muted">{h.day}</span> · <span className="font-mono">{fmtPct(h.accuracy)}</span>{" "}
            <span className="text-faint">({h.correct}/{h.questions})</span>
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-xs text-faint">Accuracy per practice day · dashed line = 95%</figcaption>
      <table className="sr-only">
        <caption>Daily accuracy</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{fmtPct(d.accuracy)}</td>
              <td>
                {d.correct} of {d.questions}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
