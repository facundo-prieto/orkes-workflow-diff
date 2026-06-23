/**
 * Side-by-side diff built on the official `orkes-workflow-visualizer` (the same
 * component the Conductor OSS UI uses). Rather than forcing both versions into
 * one merged tree, we render two native graphs — Before on the left, After on
 * the right — and let the reader compare them directly. Each version's tasks
 * are stamped with diff-derived execution statuses so each pane self-annotates
 * what changed (see `buildSideDefinition` + `diffStatusToVisualizerStatus`).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkflowVisualizer } from "orkes-workflow-visualizer";
// Relative path: the package's exports map only exposes ".", so the bare
// "orkes-workflow-visualizer/dist/style.css" specifier does not resolve.
import "../../node_modules/orkes-workflow-visualizer/dist/style.css";
import type { NodeData } from "reaflow";

import { buildSideDefinition } from "../lib/mergedDefinition";
import type { MergedGraph, MergedNode } from "../lib/workflowDiff";
import type { WorkflowDefinition } from "../lib/workflowGraph";

interface OrkesGraphViewProps {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
  /** Flat merged graph from `diffWorkflows`; used for click → details lookup. */
  graph: MergedGraph;
  onSelectNode: (node: MergedNode) => void;
}

export function OrkesGraphView({
  before,
  after,
  graph,
  onSelectNode,
}: OrkesGraphViewProps) {
  const statusByRef = useMemo(
    () => new Map(graph.nodes.map(n => [n.ref, n.status])),
    [graph],
  );
  const nodesByRef = useMemo(
    () => new Map(graph.nodes.map(n => [n.ref, n])),
    [graph],
  );

  const beforeDef = useMemo(
    () => buildSideDefinition(before, statusByRef, "before"),
    [before, statusByRef],
  );
  const afterDef = useMemo(
    () => buildSideDefinition(after, statusByRef, "after"),
    [after, statusByRef],
  );

  const handleClick = (_e: unknown, node: NodeData) => {
    const mergedNode = nodesByRef.get(String(node.id));
    if (mergedNode) onSelectNode(mergedNode);
  };

  return (
    <div className="orkes-compare">
      <OrkesPane side="before" definition={beforeDef} onClick={handleClick} />
      <OrkesPane side="after" definition={afterDef} onClick={handleClick} />
    </div>
  );
}

function OrkesPane({
  side,
  definition,
  onClick,
}: {
  side: "before" | "after";
  definition: WorkflowDefinition | null;
  onClick: (e: unknown, node: NodeData) => void;
}) {
  const label = side === "before" ? "Before" : "After";
  return (
    <section className="orkes-pane">
      <header className="orkes-pane-title">{label}</header>
      <div className="orkes-pane-canvas">
        {definition ? (
          <FittedVisualizer definition={definition} onClick={onClick} />
        ) : (
          <div className="orkes-pane-empty">
            No {label.toLowerCase()} version — this workflow was{" "}
            {side === "before" ? "added" : "deleted"}.
          </div>
        )}
      </div>
    </section>
  );
}

const FIT_PADDING = 24;
const MIN_SCALE = 0.05;
const MAX_SCALE = 2.5;
const ZOOM_BUTTON_STEP = 1.25;
/** Pointer travel (px) past which a press counts as a pan, not a node click. */
const DRAG_THRESHOLD = 4;

/** Pan/zoom state: a CSS transform expressed as scale + translation. */
interface View {
  scale: number;
  tx: number;
  ty: number;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * The visualizer always renders the graph at its natural size — it never fits
 * to its container (reaflow's `fit` is hardcoded off and the library exposes no
 * fit prop; its `zoom` prop floors at 0.5×). So we drive a CSS transform on the
 * graph ourselves: an initial fit-to-pane, then wheel-zoom and drag-to-pan that
 * mutate the same transform. Doing it in CSS keeps click hit-testing correct
 * (node selection still works) and sidesteps the library's 0.5× zoom floor.
 *
 * Two gotchas the fit logic handles:
 *  - reaflow's svg has a fixed-size box and `overflow: hidden` that clips any
 *    content taller than its (often under-estimated) layout height — task cards
 *    with inline code render taller than ELK predicts. The CSS forces
 *    `overflow: visible` so nothing is clipped; we measure the true content box
 *    with `getBBox()` (transform-independent) instead of the svg's attributes.
 *  - ELK lays out asynchronously and resettles for a beat, so we re-fit on
 *    every relevant DOM mutation (and on pane resize) until it stabilises —
 *    but only until the user takes over with a pan/zoom (see `interactedRef`).
 */
function FittedVisualizer({
  definition,
  onClick,
}: {
  definition: WorkflowDefinition;
  onClick: (e: unknown, node: NodeData) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  // Source of truth lives in a ref so the (once-attached) gesture handlers
  // always read the current view; state mirrors it only to trigger re-renders.
  const viewRef = useRef<View | null>(null);
  // Set once the user pans/zooms, so auto-fit stops fighting their view.
  const interactedRef = useRef(false);
  const [view, setView] = useState<View | null>(null);

  const apply = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // Returns true once it has fit a real content box (false while the async
  // layout hasn't produced one yet). getBBox is the real rendered content
  // extent in svg user units, immune to our CSS transform — so it stays stable
  // across re-fits, which is what keeps the MutationObserver below from looping.
  const fit = useCallback((): boolean => {
    // The user is in control; don't yank their pan/zoom back to the fit.
    if (interactedRef.current && viewRef.current) return true;

    const viewport = viewportRef.current;
    const svg = scalerRef.current?.querySelector("svg");
    if (!viewport || !svg) return false;

    let box: DOMRect;
    try {
      box = svg.getBBox();
    } catch {
      return false;
    }
    if (box.width === 0 || box.height === 0) return false;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const scale = Math.min(
      (vw - FIT_PADDING * 2) / box.width,
      (vh - FIT_PADDING * 2) / box.height,
      1,
    );
    // Center horizontally; pin to the top (workflows read top-down). Subtract
    // the content's own origin (reaflow centers it, so box.y can be negative)
    // so its top-left lands exactly where we want it.
    const left = Math.max(FIT_PADDING, (vw - box.width * scale) / 2);
    apply({ scale, tx: left - box.x * scale, ty: FIT_PADDING - box.y * scale });
    return true;
  }, [apply]);

  // Zoom toward a point (in viewport coordinates), keeping that point fixed
  // under the cursor — the standard zoom-to-cursor transform.
  const zoomAround = useCallback(
    (factor: number, cx: number, cy: number) => {
      const cur = viewRef.current;
      if (!cur) return;
      const scale = clampScale(cur.scale * factor);
      const k = scale / cur.scale;
      if (k === 1) return;
      interactedRef.current = true;
      apply({ scale, tx: cx - (cx - cur.tx) * k, ty: cy - (cy - cur.ty) * k });
    },
    [apply],
  );

  const zoomFromButton = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (vp) zoomAround(factor, vp.clientWidth / 2, vp.clientHeight / 2);
    },
    [zoomAround],
  );

  const resetFit = useCallback(() => {
    interactedRef.current = false;
    fit();
  }, [fit]);

  // Auto-fit: settle on mount + refit on pane resize, until the user takes over.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const scaler = scalerRef.current;
    if (!viewport || !scaler) return;

    // A new definition gets its own fresh fit.
    interactedRef.current = false;

    let pending = 0;
    const schedule = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => fit());
    };

    const resizes = new ResizeObserver(schedule);
    resizes.observe(viewport);

    // ELK lays out asynchronously and resettles for a beat after first paint:
    // nodes measure their true height (task cards with inline code grow well
    // past ELK's estimate, so reaflow rewrites their height attributes) and
    // the enter animation re-routes edges. Watching the svg subtree for those
    // mutations catches the late growth. We ignore mutations whose only target
    // is the scaler itself — those are our own transform writes, so this never
    // feeds back into a loop. It also goes quiet once the graph stabilises.
    const mutations = new MutationObserver(records => {
      if (records.every(r => r.target === scaler)) return;
      schedule();
    });
    mutations.observe(scaler, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Initial: keep trying until the first content box appears.
    let raf = 0;
    const kick = () => {
      if (!fit()) raf = requestAnimationFrame(kick);
    };
    kick();

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pending);
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [definition, fit]);

  // Wheel-to-zoom + drag-to-pan. Attached natively (not via React props) so the
  // wheel listener can be non-passive and call preventDefault to stop the page
  // from scrolling.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      // exp() keeps zoom steps proportional, so it feels smooth at any scale.
      zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      // Ignore micro-movement so a click that jitters still selects a node.
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      viewport.setPointerCapture(e.pointerId);
      lastX = e.clientX;
      lastY = e.clientY;
      const cur = viewRef.current;
      if (!cur) return;
      interactedRef.current = true;
      apply({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy });
    };
    const onPointerUp = () => {
      dragging = false;
    };
    // After a drag, swallow the click in the capture phase so it doesn't reach
    // (and select) a node. A plain click (no drag) passes straight through.
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        moved = false;
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("click", onClickCapture, true);

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("click", onClickCapture, true);
    };
  }, [apply, zoomAround]);

  const transform = view
    ? `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
    : undefined;

  return (
    <div ref={viewportRef} className="orkes-fit-viewport">
      <div
        ref={scalerRef}
        className="orkes-fit-scaler"
        // Hide the graph until the first fit, so it never flashes at full size.
        style={{
          transform,
          transformOrigin: "top left",
          visibility: view ? "visible" : "hidden",
        }}
      >
        <WorkflowVisualizer
          data={definition as Record<string, unknown>}
          onClick={onClick}
          // A definite svg box (sized to the ELK layout) avoids a sizing
          // feedback loop; the CSS then forces overflow visible so the
          // under-estimated box never clips, and we fit with getBBox.
          pannable
          maxHeightOverride
          maxWidthOverride
          // The visualizer tries to inline SUB_WORKFLOW bodies; we diff one
          // definition at a time, so always answer with an empty sub-workflow.
          subWorkflowFetcher={async () => ({ tasks: [] })}
        />
      </div>

      {/* Stop pointerdown from starting a pan when the user means to click a
          control button. */}
      <div className="orkes-zoom-controls" onPointerDown={e => e.stopPropagation()}>
        <button title="Zoom in" onClick={() => zoomFromButton(ZOOM_BUTTON_STEP)}>
          +
        </button>
        <button title="Zoom out" onClick={() => zoomFromButton(1 / ZOOM_BUTTON_STEP)}>
          −
        </button>
        <button title="Fit to view" onClick={resetFit}>
          ⤢
        </button>
      </div>
    </div>
  );
}
