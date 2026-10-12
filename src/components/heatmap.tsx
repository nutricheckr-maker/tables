"use client";

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { stageConfig, type Settings } from "@/lib/engine/config";
import { makeFact } from "@/lib/engine/facts";
import { factStatus } from "@/lib/engine/mastery";
import type { Records } from "@/lib/engine/selection";
import type { FactStatus, StageId } from "@/lib/engine/types";
import { FactDetail } from "./fact-detail";

export const STATUS_LABEL: Record<FactStatus, string> = {
  unpractised: "Unpractised",
  developing: "Developing",
  weak: "Weak",
  mastered: "Mastered",
};

export const STATUS_CELL: Record<FactStatus, string> = {
  unpractised: "border border-line-strong",
  developing: "bg-dev-fill",
  weak: "cell-weak",
  mastered: "bg-good-fill",
};

export function StatusSwatch({ status }: { status: FactStatus }) {
  return <span aria-hidden className={`inline-block h-3 w-3 rounded-[2px] ${STATUS_CELL[status]}`} />;
}

interface Props {
  stage: StageId;
  records: Records;
  settings: Settings;
  now: number;
}

/**
 * Full a × b square for the stage. Each unordered fact appears twice (a×b and b×a)
 * because that is how a times table is read; both cells share one record.
 * Keyboard: one tab stop, arrow keys move, Enter/Space opens details.
 */
export function Heatmap({ stage, records, settings, now }: Props) {
  const max = stageConfig(stage).max;
  const statuses = useMemo(() => {
    const m: FactStatus[][] = [];
    for (let r = 1; r <= max; r++) {
      const row: FactStatus[] = [];
      for (let c = 1; c <= max; c++) row.push(factStatus(records[makeFact(r, c).key], makeFact(r, c), settings));
      m.push(row);
    }
    return m;
  }, [max, records, settings]);

  const [focus, setFocus] = useState<[number, number]>([1, 1]);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const moveTo = useCallback(
    (r: number, c: number) => {
      const nr = Math.max(1, Math.min(max, r));
      const nc = Math.max(1, Math.min(max, c));
      setFocus([nr, nc]);
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${nc}"]`)?.focus();
    },
    [max],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [r, c] = focus;
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - step, c],
      ArrowDown: [r + step, c],
      ArrowLeft: [r, c - step],
      ArrowRight: [r, c + step],
      Home: [r, 1],
      End: [r, max],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      moveTo(m[0], m[1]);
    } else if (e.key === "Escape") setSelected(null);
  };

  const labelEvery = max <= 20 ? 1 : 5;
  const axis = (n: number) => (n === 1 || n % labelEvery === 0 ? n : "");
  const counts = useMemo(() => {
    const c: Record<FactStatus, number> = { unpractised: 0, developing: 0, weak: 0, mastered: 0 };
    for (let r = 1; r <= max; r++) for (let col = r; col <= max; col++) c[statuses[r - 1]![col - 1]!]++;
    return c;
  }, [statuses, max]);

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
        {(Object.keys(STATUS_LABEL) as FactStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <StatusSwatch status={s} />
            {STATUS_LABEL[s]} <span className="font-mono text-faint">{counts[s]}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div
          ref={gridRef}
          role="group"
          aria-label={`Stage ${stage} performance heatmap, ${max} by ${max}. Use arrow keys to move and Enter for details.`}
          onKeyDown={onKeyDown}
          className="grid w-full max-w-[640px] select-none gap-[2px] font-mono text-[9px] leading-none text-faint sm:text-[10px]"
          style={{ gridTemplateColumns: `1.6em repeat(${max}, minmax(0, 1fr))` }}
        >
          <span aria-hidden />
          {Array.from({ length: max }, (_, i) => (
            <span key={`h${i}`} aria-hidden className="pb-1 text-center">
              {axis(i + 1)}
            </span>
          ))}
          {statuses.map((row, ri) => (
            <HeatRow
              key={ri}
              r={ri + 1}
              row={row}
              label={axis(ri + 1)}
              focus={focus}
              selected={selected}
              onPick={(r, c) => {
                setFocus([r, c]);
                setSelected([r, c]);
              }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 lg:max-w-xs">
          {selected ? (
            <FactDetail
              fact={makeFact(selected[0], selected[1])}
              shown={[selected[0], selected[1]]}
              record={records[makeFact(selected[0], selected[1]).key]}
              settings={settings}
              now={now}
            />
          ) : (
            <p className="text-sm text-muted">Select a cell to see its history, mastery checks and next review.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const HeatRow = memo(function HeatRow({
  r,
  row,
  label,
  focus,
  selected,
  onPick,
}: {
  r: number;
  row: FactStatus[];
  label: number | string;
  focus: [number, number];
  selected: [number, number] | null;
  onPick: (r: number, c: number) => void;
}) {
  return (
    <>
      <span aria-hidden className="flex items-center justify-end pr-1">
        {label}
      </span>
      {row.map((status, ci) => {
        const c = ci + 1;
        const isFocus = focus[0] === r && focus[1] === c;
        const isSel = selected !== null && selected[0] === r && selected[1] === c;
        return (
          <button
            key={c}
            type="button"
            data-cell={`${r}-${c}`}
            tabIndex={isFocus ? 0 : -1}
            aria-label={`${r} × ${c} = ${r * c}, ${STATUS_LABEL[status]}`}
            aria-pressed={isSel}
            onClick={() => onPick(r, c)}
            className={`aspect-square min-w-0 rounded-[2px] ${STATUS_CELL[status]} ${isSel ? "ring-2 ring-ink ring-offset-1 ring-offset-bg" : ""}`}
          />
        );
      })}
    </>
  );
});
