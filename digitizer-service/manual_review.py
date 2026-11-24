"""Bounded, temporary review sessions and calibrated region corrections.

Pixels and signal maps stay in memory. The random token is a bearer capability;
never put it in URLs or logs. Original machine evidence is kept separately.
"""
import base64
import copy
import secrets
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from signal_result import LEAD_NAMES, NUM_SAMPLES


class ReviewError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def box(value, width, height):
    if (not isinstance(value, list) or len(value) != 4
            or any(type(v) not in (int, float) or not np.isfinite(v) for v in value)):
        raise ReviewError('Select a valid rectangular region.')
    x1, y1, x2, y2 = map(int, value)
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise ReviewError('Keep each region inside the scan.')
    return [x1, y1, x2, y2]


def png(image):
    ok, data = cv2.imencode('.png', image)
    if not ok:
        raise ReviewError('Could not prepare the review image.')
    return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')


@dataclass
class Session:
    result: dict
    image: np.ndarray
    signal: np.ndarray
    pixels_per_mm: float
    time_bounds: tuple
    expires: float
    revision: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


class ReviewStore:
    def __init__(self, ttl=1200, capacity=4, max_bytes=128 * 1024 * 1024):
        self.ttl, self.capacity, self.max_bytes = ttl, capacity, max_bytes
        self.sessions = {}
        self.lock = threading.Lock()

    def _remove(self, token):
        with self.lock:
            self.sessions.pop(token, None)

    def create(self, result, image, signal, pixels_per_mm, time_bounds):
        if (image.shape[:2] != signal.shape or not np.isfinite(pixels_per_mm)
                or pixels_per_mm <= 0 or not 0 <= time_bounds[0] < time_bounds[1] <= image.shape[1]):
            raise ReviewError('Manual review geometry is unavailable.')
        size = image.nbytes + signal.nbytes
        if size > self.max_bytes:
            raise ReviewError('This scan is too large for manual review.')
        token = secrets.token_urlsafe(32)
        session = Session(copy.deepcopy(result), image.copy(), signal.copy(),
                          float(pixels_per_mm), time_bounds, time.monotonic() + self.ttl)
        with self.lock:
            while self.sessions and (len(self.sessions) >= self.capacity or
                    sum(s.image.nbytes + s.signal.nbytes for s in self.sessions.values()) + size > self.max_bytes):
                self.sessions.pop(next(iter(self.sessions)))
            self.sessions[token] = session
        timer = threading.Timer(self.ttl, self._remove, args=(token,))
        timer.daemon = True
        timer.start()
        return self.payload(token, session)

    def get(self, token):
        if not isinstance(token, str):
            raise ReviewError('Review session is missing.', 410)
        with self.lock:
            session = self.sessions.get(token)
        if session is None or time.monotonic() >= session.expires:
            raise ReviewError('This review session expired. Upload the scan again.', 410)
        return session

    def payload(self, token, session):
        checks = session.result.get('leadVerification', {}).get('leads', {})
        return {'token': token, 'revision': session.revision, 'expiresInSeconds': max(0, int(session.expires-time.monotonic())),
                'image': png(session.image), 'width': session.image.shape[1], 'height': session.image.shape[0],
                'regions': {name: {key: check[key] for key in ('box', 'waveformBox') if key in check}
                            for name, check in checks.items()}}


def apply_corrections(session, corrections, extract, *, mode='labels'):
    """Validate an entire batch before extraction, then commit atomically.

    extract receives a masked full-size signal map and returns pixel rows plus
    their x offset. No client-supplied voltages or sample rates are accepted.
    """
    if mode not in ('labels', 'waveform_regions'):
        raise ReviewError('Unknown review mode.')
    graph_only = mode == 'waveform_regions'
    if not isinstance(corrections, list) or not 1 <= len(corrections) <= 12:
        raise ReviewError('Submit between one and twelve lead corrections.')
    result = session.result
    height, width = session.image.shape[:2]
    parsed, sources, labels = [], set(), set()
    for item in corrections:
        if not isinstance(item, dict):
            raise ReviewError('Invalid correction.')
        source, label = item.get('source'), item.get('label')
        if source is not None and (not isinstance(source, str) or source not in result['leads'] or source in sources):
            raise ReviewError('Each source lead must exist and appear only once.')
        if source is not None:
            if not graph_only and result.get('leadVerification', {}).get('leads', {}).get(source, {}).get('status') == 'verified':
                raise ReviewError('Leads confirmed by layout and OCR cannot be replaced here.')
            sources.add(source)
        if not isinstance(label, str):
            raise ReviewError('Enter a valid lead label.')
        label = next((v for v in LEAD_NAMES if v.upper() == label.strip().upper()), None)
        if label is None or label in labels:
            raise ReviewError('Use valid, unique lead labels.')
        if graph_only and (source is None or label != source):
            raise ReviewError('Graph editing must retain the existing lead label.')
        labels.add(label)
        previous_check = result.get('leadVerification', {}).get('leads', {}).get(source, {})
        label_box = previous_check.get('box') if graph_only else box(item.get('labelBox'), width, height)
        wave_box = box(item.get('waveformBox'), width, height)
        if wave_box[2] - wave_box[0] < 30 or wave_box[3] - wave_box[1] < 8:
            raise ReviewError('Select the full waveform, at least 30 pixels wide and 8 pixels tall.')
        parsed.append((source, label, label_box, wave_box))
    if labels & (set(result['leads']) - sources):
        raise ReviewError('A label duplicates a retained lead. Correct both assignments together for a swap.')
    updated = copy.deepcopy(result)
    updated.pop('userReview', None)
    updated.pop('manualReview', None)
    updated.setdefault('machineEvidence', {key: copy.deepcopy(result.get(key)) for key in
                                          ('leadVerification', 'modelRecognition', 'layoutRecheck')})
    checks = updated.setdefault('leadVerification', {}).setdefault('leads', {})
    previews = updated.setdefault('leadPreviews', {})
    recognition = updated.setdefault('recognition', {}).setdefault('leads', {})
    for source in sources:
        updated['leads'].pop(source)
        checks.pop(source, None)
        previews.pop(source, None)
        recognition.pop(source, None)
    audit = []
    start, stop = session.time_bounds
    target_x = np.linspace(start, stop - 1, NUM_SAMPLES)
    for source, label, label_box, wave_box in parsed:
        x1, y1, x2, y2 = wave_box
        masked = np.zeros_like(session.signal)
        masked[y1:y2, x1:x2] = session.signal[y1:y2, x1:x2]
        try:
            rows, offset = extract(masked, wave_box)
        except ReviewError:
            raise
        except Exception:
            raise ReviewError(f'Could not extract {label}. Adjust the waveform region and try again.') from None
        rows = np.asarray(rows)
        if rows.ndim != 2 or rows.shape[0] != 1 or offset is None:
            raise ReviewError(f'Select exactly one waveform for {label}; the region contains no clear trace or multiple traces.')
        values = rows[0].astype(float)
        if np.isfinite(values).sum() < 30:
            raise ReviewError(f'Not enough waveform detail for {label}. Adjust its region.')
        # Same mean baseline, positive-up convention and 10 mm/mV calibration as upstream.
        values = -(values - np.nanmean(values)) * 0.1 / session.pixels_per_mm
        sample_x = np.arange(len(values)) + offset
        samples = np.interp(target_x, sample_x, values, left=np.nan, right=np.nan)
        samples[(target_x < x1) | (target_x >= x2)] = np.nan
        if np.isfinite(samples).sum() < 2:
            raise ReviewError(f'The region for {label} is outside the recording time range.')
        updated['leads'][label] = [float(v) if np.isfinite(v) else None for v in samples]
        checks[label] = {'status': 'human_corrected', 'reason': 'user_waveform_region' if graph_only else 'user_label_and_region',
                         'observedLabels': [], 'waveformBox': wave_box}
        if label_box is not None:
            checks[label]['box'] = label_box
        previews[label] = png(session.image[y1:y2, x1:x2])
        recognition[label] = {'status': 'success', 'source': 'human', 'label': label}
        audit.append({'source': source, 'label': label, 'mode': mode, 'waveformBox': wave_box,
                      **({'labelBox': label_box} if label_box is not None else {})})
    unresolved = any(checks.get(name, {}).get('status') not in ('verified', 'human_corrected') for name in updated['leads'])
    updated['leadVerification']['status'] = 'needs_review' if unresolved else 'human_reviewed'
    updated['requiresReview'] = True  # Final per-lead confirmation remains mandatory.
    updated.setdefault('manualCorrections', []).extend(audit)
    return updated
