"""Spatial OCR cross-check; never relabel or modify extracted samples."""
import numpy as np

LEADS = ('I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6')


def review(reason, names=()):
    return {'status': 'needs_review', 'reason': reason,
            'leads': {name: {'status': 'unverified', 'reason': reason} for name in names}}


def source_regions(raw, normalized, canonical, columns, crop, shape, flipped=False, source_offset=0):
    """Recover unique source rows/chunks by exact equality with canonical output.

    This also observes actual rhythm-strip reassignment, rather than assuming
    the template's rhythm label was used. Identical traces are ambiguous.
    raw is the merged pixel-space trace *before* normalization. crop is the
    exact horizontal range retained by the pinned identifier's normalization.
    """
    raw, normalized, canonical = map(np.asarray, (raw, normalized, canonical))
    height, width = shape
    if (raw.ndim != 2 or normalized.ndim != 2 or canonical.ndim != 2
            or raw.shape[0] != normalized.shape[0]
            or source_offset is None or source_offset < 0
            or raw.shape[1] + source_offset > width
            or canonical.shape != (12, normalized.shape[1])
            or columns < 1 or columns > normalized.shape[1]):
        raise ValueError('Unsupported digitizer geometry')
    start, stop = crop
    if not 0 <= start < stop <= raw.shape[1]:
        raise ValueError('Invalid normalization crop')
    start, stop = start + source_offset, stop + source_offset
    if flipped:
        normalized = normalized[::-1, ::-1].copy()
        valid = normalized[np.isfinite(normalized)]
        normalized = (valid.max() if valid.size else 1) - normalized
        raw = height - 1 - raw[::-1, ::-1]
        start, stop = width - stop, width - start
    size = normalized.shape[1]
    chunk = size // columns
    medians = np.array([np.nanmedian(row) for row in raw])
    # A row must be spatially separable from its neighbors before verifying it.
    gaps = np.diff(medians)
    if not np.all(np.isfinite(medians)) or (gaps <= 0).any():
        raise ValueError('Ambiguous source rows')
    regions = {}
    for name, output in zip(LEADS, canonical):
        if not np.isfinite(output).any():
            continue
        matches = set()
        for row, values in enumerate(normalized):
            spans = {(0, size)} | {(c*chunk, (c+1)*chunk if c < columns-1 else size)
                                   for c in range(columns)}
            for a, b in spans:
                for sign in (1, -1):
                    expected = np.full(size, np.nan)
                    expected[a:b] = values[a:b] * sign
                    if np.array_equal(expected, output, equal_nan=True):
                        matches.add((row, a, b, sign))
        if len(matches) != 1:
            regions[name] = {'reason': 'ambiguous_source_trace'}
            continue
        row, a, b, sign = matches.pop()
        if sign < 0:
            regions[name] = {'reason': 'inverted_lead_requires_review'}
            continue
        # Normalize/resample uses linspace across the retained source columns.
        x = start + a * (stop-start-1) / max(1, size-1)
        end = start + (b-1) * (stop-start-1) / max(1, size-1)
        local_gaps = [gaps[i] for i in (row-1, row) if 0 <= i < len(gaps)]
        gap = min(local_gaps) if local_gaps else height / 3
        y = medians[row]
        regions[name] = {'box': [float(value) for value in (
                                max(0, x-width*.04), max(0, y-gap*.8),
                                min(width, x+max(12, (end-x)*.3)),
                                min(height, y+gap*.12))],
                         'sourceRow': int(row), 'sampleRange': [int(a), int(b)]}
    return regions


def compare_labels(regions, ocr, names):
    if ocr.get('coordinate_space') != 'input_pixels':
        return review('missing_ocr_coordinates', names)
    if ocr.get('ocr_timed_out'):
        return review('ocr_timeout', names)
    detections = []
    for item in ocr.get('detections', []):
        if item['confidence'] >= 70 and item['height'] >= (6 if item.get('local_support',0)>=2 else 10):
            x, y, w, h = item['box']
            if np.isfinite([x, y, w, h]).all() and w > 0 and h > 0:
                detections.append((item['lead'].upper(), x+w/2, y+h/2))
    evidence = {name: set() for name in names}
    ambiguous = set()
    for label, x, y in detections:
        owners = [name for name in names if 'box' in regions.get(name, {})
                  and regions[name]['box'][0] <= x <= regions[name]['box'][2]
                  and regions[name]['box'][1] <= y <= regions[name]['box'][3]]
        if len(owners) > 1:
            ambiguous.update(owners)
        elif owners:
            evidence[owners[0]].add(label)
    results = {}
    for name in names:
        observed = evidence[name]
        reason = regions.get(name, {}).get('reason')
        if name in ambiguous:
            status, reason = 'unverified', 'ambiguous_label_location'
        elif not observed or reason:
            status, reason = 'unverified', reason or 'no_confident_local_label'
        elif observed == {name.upper()}:
            status, reason = 'verified', 'local_label_agrees'
        elif name.upper() not in observed and len(observed) == 1:
            status, reason = 'conflict', 'local_label_disagrees'
        else:
            status, reason = 'unverified', 'conflicting_ocr_evidence'
        results[name] = {'status': status, 'reason': reason, 'observedLabels': sorted(observed),
                         **regions.get(name, {})}
        results[name]['reason'] = reason
    statuses = [item['status'] for item in results.values()]
    status = ('conflict' if 'conflict' in statuses else
              'verified' if statuses and all(s == 'verified' for s in statuses) else 'needs_review')
    return {'status': status, 'leads': results,
            'scope': 'Printed label agrees with source region; waveform accuracy and timing are not validated.'}
