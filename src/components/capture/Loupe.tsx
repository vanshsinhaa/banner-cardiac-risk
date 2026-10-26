import { useLayoutEffect, useRef } from "react";
import type { Point } from "@/lib/cropCorners";
import styles from "../EkgCaptureScreen.module.css";

interface Props {
  image: HTMLImageElement;
  point: Point;
  anchor: Point;
  scale: number;
  width: number;
  height: number;
}

/** Redraw only this 110px patch, sampling the already decoded original image. */
export default function Loupe({ image, point, anchor, scale, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = 110;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sample = size / (scale * 2.5);
    ctx.fillStyle = "#18211f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, point.x - sample / 2, point.y - sample / 2, sample, sample, 0, 0, canvas.width, canvas.height);
  }, [image, point, scale]);
  let x = anchor.x - size / 2;
  let y = anchor.y - size - 38;
  if (y < 4) y = anchor.y + 38;
  if (y + size > height - 4) {
    x = anchor.x + 38 + size <= width ? anchor.x + 38 : anchor.x - size - 38;
    y = anchor.y - size / 2;
  }
  x = Math.max(4, Math.min(width - size - 4, x));
  y = Math.max(4, Math.min(height - size - 4, y));
  return (
    <foreignObject x={x} y={y} width={size} height={size} className={styles.loupeObject} aria-hidden="true">
      <div className={styles.loupe}>
        <canvas ref={ref} />
        <svg viewBox="0 0 110 110" className={styles.crosshair}>
          <path d="M43 55H67M55 43V67" stroke="white" strokeWidth="3" />
          <path d="M43 55H67M55 43V67" stroke="#173d33" strokeWidth="1" />
        </svg>
      </div>
    </foreignObject>
  );
}
