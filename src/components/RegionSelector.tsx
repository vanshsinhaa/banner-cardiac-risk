'use client';

import { useId, useRef, type PointerEvent } from 'react';
import type { RegionBox } from '@/lib/ecg-digitizer/types';

export default function RegionSelector({ image, width, height, value, onChange, title, disabled = false }: {
  image: string; width: number; height: number; value?: RegionBox;
  onChange: (value: RegionBox) => void; title: string; disabled?: boolean;
}) {
  const clipId = useId();
  const origin = useRef<[number, number] | null>(null);
  function point(event: PointerEvent<SVGSVGElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(width, Math.round((event.clientX - rect.left) * width / rect.width))),
      Math.max(0, Math.min(height, Math.round((event.clientY - rect.top) * height / rect.height)))];
  }
  function update(event: PointerEvent<SVGSVGElement>) {
    if (!origin.current || disabled) return;
    const [x, y] = point(event), [a, b] = origin.current;
    onChange([Math.min(x, a), Math.min(y, b), Math.max(x, a), Math.max(y, b)]);
  }
  return <fieldset disabled={disabled} style={{ marginBlock: 12 }}>
    <legend>{title}</legend>
    <p>Drag a rectangle on the scan, or enter its pixel coordinates below.</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}
      style={{ width: '100%', display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={event => { if (!disabled) { origin.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={update} onPointerUp={event => { update(event); origin.current = null; }} onPointerCancel={() => { origin.current = null; }}>
      <image href={image} width={width} height={height} />
      {value && <rect x={value[0]} y={value[1]} width={value[2]-value[0]} height={value[3]-value[1]} fill="#0e749022" stroke="#0e7490" strokeWidth={Math.max(2, width/400)} />}
    </svg>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {['Left', 'Top', 'Right', 'Bottom'].map((label, index) => <label key={label}>{label}{' '}
        <input aria-label={`${title} ${label}`} type="number" min={0} max={index % 2 ? height : width}
          value={value?.[index] ?? ''} style={{ width: 85 }} onChange={event => {
            const next: RegionBox = value ? [...value] : [0, 0, width, height];
            next[index] = Number(event.target.value); onChange(next);
          }} />
      </label>)}
    </div>
    {value && value[2] > value[0] && value[3] > value[1] && <div>
      <p>Selected image region</p>
      <svg viewBox={`${value[0]} ${value[1]} ${value[2]-value[0]} ${value[3]-value[1]}`} role="img" aria-label={`${title} preview`}
        style={{ width: '100%', height: 120, background: '#f1f5f9' }}>
        <defs><clipPath id={clipId}><rect x={value[0]} y={value[1]} width={value[2]-value[0]} height={value[3]-value[1]} /></clipPath></defs>
        <image href={image} width={width} height={height} clipPath={`url(#${clipId})`} />
      </svg>
    </div>}
  </fieldset>;
}
