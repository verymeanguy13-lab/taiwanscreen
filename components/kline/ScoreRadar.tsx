'use client';

import { useEffect, useState } from 'react';

type Dimensions = {
  trend?:     { score: number; reason: string };
  momentum?:  { score: number; reason: string };
  volume?:    { score: number; reason: string };
  chips?:     { score: number; reason: string };
  pattern?:   { score: number; reason: string };
  sentiment?: { score: number; reason: string };
};

interface Props {
  dimensions: Dimensions;
}

const SIZE   = 220;
const CX     = 110;
const CY     = 110;
const MAX_R  = 80;

const AXES = [
  { key: 'trend',     label: '趨勢' },
  { key: 'momentum',  label: '動能' },
  { key: 'volume',    label: '量能' },
  { key: 'chips',     label: '籌碼' },
  { key: 'pattern',   label: '型態' },
  { key: 'sentiment', label: '情緒' },
];

function hexPoint(index: number, r: number): { x: number; y: number } {
  // Start at top (-90°), go clockwise
  const angle = (index * 60 - 90) * (Math.PI / 180);
  return {
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  };
}

function pointsString(pts: { x: number; y: number }[]): string {
  return pts.map(p => `${p.x},${p.y}`).join(' ');
}

export function ScoreRadar({ dimensions }: Props) {
  const [animScale, setAnimScale] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimScale(1), 80);
    return () => clearTimeout(t);
  }, []);

  const scores = AXES.map(({ key }) => {
    const dim = dimensions[key as keyof Dimensions];
    return dim?.score ?? 0;
  });

  // Data polygon points
  const dataPoints = scores.map((score, i) => {
    const r = (score / 100) * MAX_R * animScale;
    return hexPoint(i, r);
  });

  // Grid hexagons at 33%, 66%, 100%
  const gridLevels = [0.33, 0.66, 1.0];

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Grid hexagons */}
      {gridLevels.map((level) => {
        const pts = AXES.map((_, i) => hexPoint(i, MAX_R * level));
        return (
          <polygon
            key={level}
            points={pointsString(pts)}
            fill="none"
            stroke="#1E2235"
            strokeWidth={1}
          />
        );
      })}

      {/* Axis lines */}
      {AXES.map((_, i) => {
        const pt = hexPoint(i, MAX_R);
        return (
          <line
            key={i}
            x1={CX} y1={CY}
            x2={pt.x} y2={pt.y}
            stroke="#1E2235"
            strokeWidth={1}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={pointsString(dataPoints)}
        fill="#F5B70030"
        stroke="#F5B700"
        strokeWidth={1.5}
        style={{ transition: 'all 0.8s ease-out' }}
      />

      {/* Data dots */}
      {dataPoints.map((pt, i) => (
        <circle key={i} cx={pt.x} cy={pt.y} r={3} fill="#F5B700" />
      ))}

      {/* Axis labels */}
      {AXES.map(({ label }, i) => {
        const pt     = hexPoint(i, MAX_R + 16);
        const score  = scores[i];
        return (
          <g key={i}>
            <text
              x={pt.x} y={pt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill="#8B8FA8"
              fontFamily="system-ui, sans-serif"
            >
              {label}
            </text>
            <text
              x={pt.x} y={pt.y + 11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={8}
              fill="#F5B700"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight={700}
            >
              {score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
