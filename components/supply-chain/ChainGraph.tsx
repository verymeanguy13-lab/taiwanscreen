'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GraphNode {
  symbol:     string;
  name_zh:    string;
  change_pct: number | null;
  market_cap: number | null;
  is_center:  boolean;
  sector?:    string | null;
  close?:     number | null;
  // D3 mutable fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  category: string | null;
  tier: number | null;
}

interface ChainGraphProps {
  nodes:       GraphNode[];
  edges:       GraphEdge[];
  onNodeClick: (symbol: string) => void;
  highlightedSymbol?: string | null;
}

// ── Color scale (matches heatmap — Taiwan convention: red = up, green = down) ──
function changeToColor(pct: number | null): string {
  if (pct == null) return '#4A4F6A';
  if (pct >=  5)   return '#7B0000';
  if (pct >=  2)   return '#FF4D6D';
  if (pct >=  0)   return '#FF9AA2';
  if (pct >= -2)   return '#4DFFCC';
  if (pct >= -5)   return '#00D4AA';
  return '#005F46';
}

export function ChainGraph({ nodes, edges, onNodeClick, highlightedSymbol }: ChainGraphProps) {
  const svgRef     = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  useEffect(() => {
    if (!svgRef.current || !nodes.length) return;

    const width  = svgRef.current.clientWidth  || 800;
    const height = svgRef.current.clientHeight || 600;

    // Deep-clone nodes so D3 can mutate them
    const simNodes: GraphNode[] = nodes.map(n => ({ ...n }));
    const nodeById = new Map(simNodes.map(n => [n.symbol, n]));

    // Resolve edge source/target to node objects
    const simEdges: GraphEdge[] = edges
      .map(e => ({
        ...e,
        source: nodeById.get(String(typeof e.source === 'string' ? e.source : (e.source as GraphNode).symbol))!,
        target: nodeById.get(String(typeof e.target === 'string' ? e.target : (e.target as GraphNode).symbol))!,
      }))
      .filter(e => e.source && e.target);

    // ── SVG setup ──────────────────────────────────────────────────────────
    const svgEl = d3.select(svgRef.current);
    svgEl.selectAll('*').remove(); // clear on re-render

    const g = svgEl.append('g').attr('class', 'graph-root');

    // ── Zoom ───────────────────────────────────────────────────────────────
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', event.transform.toString());
      });
    svgEl.call(zoom);

    // ── Defs: arrowhead marker ─────────────────────────────────────────────
    svgEl.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#6B7FCC')
      .attr('opacity', 0.4);

    // ── Edges ──────────────────────────────────────────────────────────────
    const link = g.append('g').attr('class', 'links')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', '#6B7FCC')
      .attr('stroke-width', d => (d.tier === 1 ? 2 : 1))
      .attr('stroke-opacity', d => (d.tier === 1 ? 0.4 : 0.2))
      .attr('marker-end', 'url(#arrow)');

    // ── Nodes ──────────────────────────────────────────────────────────────
    const nodeRadius = (d: GraphNode) =>
      d.is_center ? 30 : (d.market_cap && d.market_cap > 500_000_000_000 ? 20 : 14);

    const nodeGroup = g.append('g').attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(simNodes, d => d.symbol)
      .join('g')
      .attr('class', d => `node-group node-${d.symbol}`)
      .style('cursor', 'pointer');

    // Circle
    nodeGroup.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', d => d.is_center ? '#F5B700' : changeToColor(d.change_pct))
      .attr('stroke', '#0F1117')
      .attr('stroke-width', 2);

    // Symbol label
    nodeGroup.append('text')
      .text(d => d.symbol)
      .attr('text-anchor', 'middle')
      .attr('dy', d => nodeRadius(d) + 12)
      .attr('font-size', 10)
      .attr('font-family', "'IBM Plex Mono', monospace")
      .attr('fill', '#8B8FA8')
      .style('pointer-events', 'none')
      .style('user-select', 'none');

    // Center label inside circle
    nodeGroup.filter(d => d.is_center)
      .append('text')
      .text(d => d.symbol)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('font-weight', '700')
      .attr('font-family', "'IBM Plex Mono', monospace")
      .attr('fill', '#08090E')
      .style('pointer-events', 'none');

    // ── Drag ──────────────────────────────────────────────────────────────
    const drag = d3.drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGroup.call(drag);

    // ── Hover tooltip ──────────────────────────────────────────────────────
    nodeGroup
      .on('mouseover', (event, d) => {
        const rect = svgRef.current?.getBoundingClientRect();
        setTooltip({
          x: event.clientX - (rect?.left ?? 0) + 12,
          y: event.clientY - (rect?.top  ?? 0) - 10,
          node: d,
        });
        d3.select(event.currentTarget)
          .select('circle')
          .attr('stroke', '#F5B700')
          .attr('stroke-width', 3);
      })
      .on('mousemove', (event) => {
        const rect = svgRef.current?.getBoundingClientRect();
        setTooltip(prev => prev
          ? { ...prev, x: event.clientX - (rect?.left ?? 0) + 12, y: event.clientY - (rect?.top ?? 0) - 10 }
          : null,
        );
      })
      .on('mouseout', (event, d) => {
        setTooltip(null);
        d3.select(event.currentTarget)
          .select('circle')
          .attr('stroke', '#0F1117')
          .attr('stroke-width', 2);
      })
      .on('click', (_, d) => {
        onNodeClick(d.symbol);
      });

    // ── Simulation ─────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges)
        .id(d => d.symbol)
        .distance(110))
      .force('charge', d3.forceManyBody().strength(-420))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>(d => nodeRadius(d) + 10))
      .on('tick', () => {
        link
          .attr('x1', d => (d.source as GraphNode).x ?? 0)
          .attr('y1', d => (d.source as GraphNode).y ?? 0)
          .attr('x2', d => (d.target as GraphNode).x ?? 0)
          .attr('y2', d => (d.target as GraphNode).y ?? 0);

        nodeGroup
          .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, onNodeClick]);

  // Highlight selected node when prop changes
  useEffect(() => {
    if (!svgRef.current) return;
    const svgEl = d3.select(svgRef.current);
    // Reset all
    svgEl.selectAll('.node-group circle')
      .attr('stroke', '#0F1117')
      .attr('stroke-width', 2);
    // Highlight selected
    if (highlightedSymbol) {
      svgEl.select(`.node-${highlightedSymbol} circle`)
        .attr('stroke', '#F5B700')
        .attr('stroke-width', 3.5);
    }
  }, [highlightedSymbol]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '0.5rem' }}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg px-3 py-2 text-xs shadow-xl"
          style={{
            left: tooltip.x,
            top:  tooltip.y,
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            minWidth: 130,
          }}
        >
          <div className="font-bold" style={{ color: 'var(--accent-gold)' }}>
            {tooltip.node.symbol}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{tooltip.node.name_zh}</div>
          {tooltip.node.close != null && (
            <div className="num mt-0.5" style={{ color: 'var(--text-primary)' }}>
              NT${Number(tooltip.node.close).toFixed(2)}
            </div>
          )}
          {tooltip.node.change_pct != null && (
            <div className="num font-semibold"
              style={{ color: changeToColor(tooltip.node.change_pct) }}>
              {tooltip.node.change_pct >= 0 ? '+' : ''}{Number(tooltip.node.change_pct).toFixed(2)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}