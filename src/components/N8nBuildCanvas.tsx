"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ─── Types ──────────────────────────────────────────────────────────────────
//
// The n8n workflow shape (subset): `nodes` carries position + type + name,
// `connections` is keyed by source node *name* (not id) and emits arrays of
// arrays for n8n's multi-output model. We only render `main[0]` (the primary
// flow) — that's what >95% of workflows use.

interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position: [number, number];
}

interface N8nConnections {
  [sourceNodeName: string]: {
    main?: Array<Array<{ node: string; type: string; index: number }>>;
  };
}

interface N8nBuildCanvasProps {
  /** Phase from chat-context.n8nBuildState.phase. */
  phase: "idle" | "exploring" | "drafting" | "finalized";
  /** Explored node types from the agent's get_node calls. Used during the
   *  `exploring` phase to render placeholders. */
  exploredNodeTypes: string[];
  /** Canonical workflow draft from the agent's workflow.json write. */
  draft: {
    name: string;
    nodes: N8nNode[];
    connections: N8nConnections;
  } | null;
}

// ─── Node visual ────────────────────────────────────────────────────────────
//
// Match n8n's tile aesthetic: rounded square, icon glyph (we use a single
// generic icon since we don't have all 1,650 node-type icons), label below.
// Codevibe touches: subtle border glow, slightly more compact padding,
// node-type label in monospace.

interface CodevibeNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  isPlaceholder?: boolean;
}

function CodevibeNode({ data }: NodeProps) {
  const { label, nodeType, isPlaceholder } = data as CodevibeNodeData;
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`group relative flex flex-col items-center gap-1.5 transition-all ${
        isPlaceholder ? "opacity-60 animate-pulse" : "opacity-100"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-zinc-600 !border-zinc-500"
      />
      {/* Tile */}
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-lg border ${
          isPlaceholder
            ? "border-amber-500/40 bg-zinc-900/60"
            : "border-zinc-700 bg-zinc-800 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.4)]"
        }`}
      >
        <span
          className={`text-2xl font-semibold ${
            isPlaceholder ? "text-amber-400" : "text-zinc-100"
          }`}
        >
          {initial}
        </span>
      </div>
      {/* Label */}
      <div className="flex flex-col items-center gap-0.5 max-w-[160px]">
        <div className="text-xs font-medium text-zinc-100 truncate w-full text-center">
          {label}
        </div>
        <div className="text-[10px] font-mono text-zinc-500 truncate w-full text-center">
          {shortenType(nodeType)}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-zinc-600 !border-zinc-500"
      />
    </div>
  );
}

// "n8n-nodes-base.googleSheetsTrigger" → "googleSheetsTrigger"
function shortenType(t: string): string {
  const dot = t.lastIndexOf(".");
  return dot >= 0 ? t.substring(dot + 1) : t;
}

const nodeTypes = { codevibe: CodevibeNode };

// ─── Layout ─────────────────────────────────────────────────────────────────
//
// During `drafting`, n8n already gave us positions in the JSON — use them
// verbatim, just normalize so the workflow is centered in the viewport.
// During `exploring`, we have only nodeType strings — lay them out in a
// horizontal row in the lower third (the "parking lot") so they read as
// candidates that haven't been arranged yet.

const PLACEHOLDER_Y = 320;
const PLACEHOLDER_X_STEP = 140;

function buildExploringNodes(nodeTypes: string[]): Node[] {
  return nodeTypes.map((t, i) => ({
    id: `placeholder-${t}`,
    type: "codevibe",
    position: { x: 100 + i * PLACEHOLDER_X_STEP, y: PLACEHOLDER_Y },
    data: {
      label: shortenType(t),
      nodeType: t,
      isPlaceholder: true,
    } as CodevibeNodeData,
  }));
}

function buildDraftGraph(draft: { nodes: N8nNode[]; connections: N8nConnections }): {
  nodes: Node[];
  edges: Edge[];
} {
  // Normalize positions so the smallest x/y land at a comfortable margin.
  // n8n positions are absolute and can land at weird coordinates — keep
  // their relative shape, just shift into view.
  const xs = draft.nodes.map((n) => n.position[0]);
  const ys = draft.nodes.map((n) => n.position[1]);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const offsetX = 80 - minX;
  const offsetY = 80 - minY;

  // n8n IDs aren't guaranteed unique across all reasonable graphs (sometimes
  // missing). Fall back to name as the React Flow id; we use name everywhere
  // anyway because connections reference by name.
  const nodes: Node[] = draft.nodes.map((n) => ({
    id: n.name,
    type: "codevibe",
    position: { x: n.position[0] + offsetX, y: n.position[1] + offsetY },
    data: {
      label: n.name,
      nodeType: n.type,
      isPlaceholder: false,
    } as CodevibeNodeData,
  }));

  const edges: Edge[] = [];
  for (const [sourceName, conn] of Object.entries(draft.connections)) {
    const mainOutputs = conn.main?.[0] ?? [];
    for (const target of mainOutputs) {
      edges.push({
        id: `${sourceName}->${target.node}`,
        source: sourceName,
        target: target.node,
        type: "smoothstep",
        animated: true,
        style: { stroke: "rgb(161 161 170)", strokeWidth: 1.5 },
      });
    }
  }

  return { nodes, edges };
}

// ─── Component ──────────────────────────────────────────────────────────────

function N8nBuildCanvasInner({ phase, exploredNodeTypes, draft }: N8nBuildCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    if (phase === "drafting" && draft) return buildDraftGraph(draft);
    if (phase === "exploring") return { nodes: buildExploringNodes(exploredNodeTypes), edges: [] };
    return { nodes: [], edges: [] };
  }, [phase, exploredNodeTypes, draft]);

  // Title bar mirrors n8n's chrome but uses zinc tokens to match codevibe.
  const title = draft?.name ?? "Building workflow…";
  const subtitle =
    phase === "exploring"
      ? `Exploring nodes (${exploredNodeTypes.length})`
      : phase === "drafting"
        ? `${draft?.nodes.length ?? 0} nodes · ${edges.length} connections`
        : "";

  return (
    <div className="relative h-full w-full bg-zinc-950">
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="flex flex-col">
          <span className="text-xs font-medium text-zinc-100">{title}</span>
          {subtitle && (
            <span className="text-[10px] text-zinc-500">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-amber-400">Building</span>
        </div>
      </div>
      {/* Canvas */}
      <div className="absolute inset-0 pt-[42px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.4 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
        >
          <Background color="#27272a" gap={24} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function N8nBuildCanvas(props: N8nBuildCanvasProps) {
  return (
    <ReactFlowProvider>
      <N8nBuildCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
