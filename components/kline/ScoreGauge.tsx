'use client';

import { useEffect, useState } from 'react';

interface Props {
  score: number; // 0-100
}

const W = 220;
const H = 130;
const CX = 110;
const CY = 115;
const R = 90;

function polarToXY(angleDeg: number, r: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + r * Math.cos(rad),
    y: CY + r * Math.sin(rad),
  };
}

// Score 0→100 maps to angle 180°→0° (left to right across top)
function scoreToAngle(score: number): number {
  return 180 - (score / 100) * 180;
}

// Arc path from startAngle to endAngle (both in degrees, 180=left, 0=right)
function arcPath(startDeg: number, endDeg: number, r: number): string {
  const start = polarToXY(startDeg, r);
  const end   = polarToXY(endDeg,   r);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  // sweep=0 means counter-clockwise in SVG coords
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

const SEGMENTS = [
  { from: 0,   to: 25,  color: '#FF4D6D' },
  { from: 25,  to: 50,  color: '#F5B700' },
  { from: 50,  to: 75,  color: '#7BCF72' },
  { from: 75,  to: 100, color: '#00D4AA' },
];

const TICKS = [
  { score: 0,   label: '極弱' },
  { score: 25,  label: '弱'   },
  { score: 50,  label: '中性' },
  { score: 75,  label: '強'   },
  { score: 100, label: '極強' },
];

function verdict(score: number): string {
  if (score >= 75) return '技術強勢';
  if (score >= 50) return '偏多';
  if (score >= 25) return '中性';
  return '技術弱勢';
}

function verdictColor(score: number): string {
  if (score >= 75) return '#00D4AA';
  if (score >= 50) return '#7BCF72';
  if (score >= 25) return '#F5B700';
  return '#FF4D6D';
}

export function ScoreGauge({ score }: Props) {
  const [animScore, setAnimScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimScore(score), 50);
    return () => clearTimeout(timer);
  }, [score]);

  const needleAngle = scoreToAngle(animScore);
  const needleTip   = polarToXY(needleAngle, R - 8);
  const needleBase1 = polarToXY(needleAngle + 90, 6);
  const needleBase2 = polarToXY(needleAngle - 90, 6);
  const color       = verdictColor(score);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Background track */}
      <path
        d={arcPath(180, 0, R)}
        fill="none"
        stroke="#1E2235"
        strokeWidth={14}
        strokeLinecap="round"
      />

      {/* Colored segments */}
      {SEGMENTS.map(({ from, to, color: sc }) => (
        <path
          key={from}
          d={arcPath(180 - (from / 100) * 180, 180 - (to / 100) * 180, R)}
          fill="none"
          stroke={sc}
          strokeWidth={14}
          strokeLinecap="butt"
          opacity={0.85}
        />
      ))}

      {/* Tick marks + labels */}
      {TICKS.map(({ score: ts, label }) => {
        const angle   = scoreToAngle(ts);
        const inner   = polarToXY(angle, R - 20);
        const outer   = polarToXY(angle, R + 2);
        const labelPt = polarToXY(angle, R - 34);
        return (
          <g key={ts}>
            <line
              x1={inner.x} y1={inner.y}
              x2={outer.x} y2={outer.y}
              stroke="#8B8FA8" strokeWidth={1.5}
            />
            <text
              x={labelPt.x} y={labelPt.y + 3}
              textAnchor="middle"
              fontSize={8}
              fill="#8B8FA8"
              fontFamily="'IBM Plex Mono', monospace"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Needle */}
      <polygon
        points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
        fill={color}
        style={{ transition: 'all 1s ease-out' }}
      />
      <circle cx={CX} cy={CY} r={5} fill={color} />

      {/* Score text */}
      <text
        x={CX} y={CY - 18}
        textAnchor="middle"
        fontSize={28}
        fontWeight={800}
        fill={color}
        fontFamily="'IBM Plex Mono', monospace"
      >
        {score}
      </text>
      <text
        x={CX} y={CY - 4}
        textAnchor="middle"
        fontSize={10}
        fill="#8B8FA8"
        fontFamily="system-ui, sans-serif"
      >
        {verdict(score)}
      </text>
    </svg>
  );
}
