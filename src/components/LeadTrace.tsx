export default function Trace({ samples }: { samples: (number | null)[] }) {
  const finite = samples.filter((v): v is number => v !== null);
  const min = Math.min(...finite), max = Math.max(...finite);
  let path = '', gap = true;
  samples.forEach((value, i) => {
    if (value === null) { gap = true; return; }
    path += `${gap ? 'M' : 'L'}${(i * 600 / Math.max(1, samples.length - 1)).toFixed(2)},${(75 - (value - min) * 65 / (max - min || 1)).toFixed(2)} `;
    gap = false;
  });
  return <svg viewBox="0 0 600 85" role="img" aria-label="Extracted waveform, amplitude scaled for preview" style={{ width: '100%', background: '#fff' }}><path d={path} fill="none" stroke="#164e63" strokeWidth="1" /></svg>;
}

