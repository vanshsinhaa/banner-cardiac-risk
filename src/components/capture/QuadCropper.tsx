import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { handlePoint, moveCorners, type Corners, type CropHandle, type PhotoSize, type Point } from "@/lib/cropCorners";
import Loupe from "./Loupe";
import styles from "../EkgCaptureScreen.module.css";

interface Props {
  src: string;
  imageRef: RefObject<HTMLImageElement | null>;
  image: HTMLImageElement | null;
  size: PhotoSize | null;
  corners: Corners | null;
  disabled: boolean;
  onLoad: () => void;
  onChange: (corners: Corners) => void;
}
interface Drag {
  id: number;
  handle: CropHandle;
  start: Point;
  corners: Corners;
  scale: number;
}
const cornerNames = ["Top left", "Top right", "Bottom right", "Bottom left"];

export default function QuadCropper({ src, imageRef, image, size, corners, disabled, onLoad, onChange }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [active, setActive] = useState<CropHandle | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<Point | null>(null);
  const instructions = useId();
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  // Padding leaves room for the complete hit targets even at the image boundary.
  const scale = size ? Math.min(Math.max(1, bounds.width - 48) / size.width, Math.max(1, bounds.height - 48) / size.height) : 1;
  const offset = { x: (bounds.width - (size?.width ?? 0) * scale) / 2, y: (bounds.height - (size?.height ?? 0) * scale) / 2 };
  const display = (p: Point) => ({ x: offset.x + p.x * scale, y: offset.y + p.y * scale });

  function applyPending() {
    frame.current = null;
    const current = drag.current;
    const p = pending.current;
    if (!current || !p || !size) return;
    const next = moveCorners(current.corners, current.handle, {
      x: (p.x - current.start.x) / current.scale, y: (p.y - current.start.y) / current.scale,
    }, size);
    // Rejected moves retain the last valid preview, not the drag's starting shape.
    if (next !== current.corners) onChange(next);
  }
  function start(event: PointerEvent, handle: CropHandle) {
    if (disabled || !corners || drag.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    (event.currentTarget as HTMLElement).focus?.({ preventScroll: true });
    drag.current = { id: event.pointerId, handle, start: { x: event.clientX, y: event.clientY }, corners, scale };
    pending.current = null;
    setActive(handle);
  }
  function move(event: PointerEvent) {
    if (drag.current?.id !== event.pointerId) return;
    pending.current = { x: event.clientX, y: event.clientY };
    if (frame.current === null) frame.current = requestAnimationFrame(applyPending);
  }
  function end(event: PointerEvent, cancelled = false) {
    if (drag.current?.id !== event.pointerId) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (!cancelled) {
      pending.current = { x: event.clientX, y: event.clientY };
      applyPending(); // Include the final position even if pointerup beats the next frame.
    }
    frame.current = null;
    drag.current = null;
    pending.current = null;
    setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function nudge(event: KeyboardEvent, handle: CropHandle) {
    if (disabled || !corners || !size || drag.current) return;
    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    if (!deltas[event.key]) return;
    event.preventDefault();
    onChange(moveCorners(corners, handle, deltas[event.key], size));
  }
  const events = {
    onPointerMove: move,
    onPointerUp: (e: PointerEvent) => end(e),
    onPointerCancel: (e: PointerEvent) => end(e, true),
    onLostPointerCapture: (e: PointerEvent) => end(e, true),
  };
  const points = corners?.map(display);
  const polygon = points?.map(p => `${p.x},${p.y}`).join(" ");
  const loupePoint = corners && active && active.kind !== "move" ? handlePoint(corners, active) : null;

  return (
    <div ref={viewport} className={styles.cropViewport}>
      <p id={instructions} className={styles.srOnly}>Use arrow keys to move one source pixel, or Shift and arrow keys for ten pixels.</p>
      <svg className={styles.cropSvg} viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-label="Adjust EKG page boundary">
        <foreignObject x={size ? offset.x : 24} y={size ? offset.y : 24} width={size ? size.width * scale : Math.max(1, bounds.width - 48)} height={size ? size.height * scale : Math.max(1, bounds.height - 48)}>
          {/* Native image preserves the existing object-URL/orientation path. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} src={src} alt="Original EKG photo" onLoad={onLoad} draggable={false} className={styles.sourceImage} />
        </foreignObject>
        {points && size && corners && <>
          <path d={`M${offset.x} ${offset.y}h${size.width * scale}v${size.height * scale}h${-size.width * scale}Z M${points.map(p => `${p.x} ${p.y}`).join("L")}Z`} fill="rgba(0,0,0,.62)" fillRule="evenodd" pointerEvents="none" />
          <polygon points={polygon} className={styles.selection} role="button" tabIndex={disabled ? -1 : 0} aria-label="Move entire selection" aria-describedby={instructions} onKeyDown={e => nudge(e, { kind: "move" })} onPointerDown={e => start(e, { kind: "move" })} {...events} />
          {corners.map((_, index) => {
            const kind = "corner";
            const handle: CropHandle = { kind, index };
            const p = display(handlePoint(corners, handle));
            const selected = active?.kind === kind && active.index === index;
            return <foreignObject key={`${kind}-${index}`} x={p.x - 22} y={p.y - 22} width={44} height={44}>
              <button type="button" className={styles.handle} data-kind={kind} data-active={selected} disabled={disabled}
                aria-label={`${cornerNames[index]} corner`} aria-describedby={instructions}
                onPointerDown={e => start(e, handle)} onKeyDown={e => nudge(e, handle)} {...events}>
                <span />
              </button>
            </foreignObject>;
          })}
          {loupePoint && image && <Loupe image={image} point={loupePoint} anchor={display(loupePoint)} scale={scale} width={bounds.width} height={bounds.height} />}
        </>}
      </svg>
    </div>
  );
}
