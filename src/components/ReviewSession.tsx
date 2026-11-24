'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isEcgDigitizationResult, type EcgDigitizationResult } from '@/lib/ecg-digitizer/types';
import type { Assessment } from '@/lib/capturePipeline';

export interface ReviewSnapshot { result: EcgDigitizationResult; image?: string; assessment?: Assessment | null }
type Update = (result: EcgDigitizationResult) => void;
interface EditorTab { window: Window; snapshot: ReviewSnapshot; onUpdate?: Update; expires: number }
const Context = createContext<{
  snapshot: ReviewSnapshot | null;
  setSnapshot: (value: ReviewSnapshot | null) => void;
  openGraphEditor: (value: ReviewSnapshot, onUpdate?: Update) => boolean;
} | null>(null);

// Same-origin messages transfer the scan in memory; no pixels or capability tokens
// enter browser storage or URLs. Each opened tab has a separate random handshake ID.
export function ReviewSession({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const tabs = useRef(new Map<string, EditorTab>());
  useEffect(() => {
    const entries = tabs.current;
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data.id !== 'string') return;
      const entry = entries.get(event.data.id);
      if (!entry || event.source !== entry.window) return;
      if (event.data.type === 'ecg-graphs-ready') {
        entry.window.postMessage({ type: 'ecg-graphs-snapshot', id: event.data.id, snapshot: entry.snapshot }, window.location.origin);
      } else if (event.data.type === 'ecg-graphs-updated') {
        const result = event.data.result;
        const previous = entry.snapshot.result.manualReview;
        if (!isEcgDigitizationResult(result) || !previous || result.manualReview?.token !== previous.token ||
            !Number.isInteger(result.manualReview.revision) || result.manualReview.revision <= previous.revision) return;
        for (const tab of entries.values()) {
          if (tab.snapshot.result.manualReview?.token === previous.token) tab.snapshot = { ...tab.snapshot, result };
        }
        setSnapshot(current => current?.result.manualReview?.token === previous.token ? { ...current, result } : current);
        entry.onUpdate?.(result);
      }
    }
    window.addEventListener('message', receive);
    const timer = window.setInterval(() => {
      for (const [id, entry] of entries) if (entry.window.closed || Date.now() > entry.expires) entries.delete(id);
    }, 1000);
    return () => { window.removeEventListener('message', receive); window.clearInterval(timer); entries.clear(); };
  }, []);
  function openGraphEditor(value: ReviewSnapshot, onUpdate?: Update) {
    const id = crypto.randomUUID();
    let child: Window | null;
    try { child = window.open(`/lead-graphs#${id}`, '_blank'); }
    catch { return false; }
    if (!child) return false;
    tabs.current.set(id, { window: child, snapshot: value, onUpdate, expires: Date.now() + 20 * 60_000 });
    setSnapshot(value);
    return true;
  }
  return <Context.Provider value={{ snapshot, setSnapshot, openGraphEditor }}>{children}</Context.Provider>;
}
export function useReviewSession() {
  const context = useContext(Context);
  if (!context) throw new Error('ReviewSession provider is missing');
  return context;
}
