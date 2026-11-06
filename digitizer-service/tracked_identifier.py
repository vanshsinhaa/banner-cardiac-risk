"""Provenance adapter for Open-ECG-Digitizer revision 97a1508."""
import numpy as np
import torch
from src.model.lead_identifier import LeadIdentifier


class TrackedLeadIdentifier(LeadIdentifier):
    @classmethod
    def wrap(cls, identifier):
        if type(identifier) is not LeadIdentifier:
            raise TypeError('Unsupported layout identifier; use the documented upstream revision')
        instance = cls.__new__(cls)
        instance.__dict__.update(identifier.__dict__)
        instance.reset()
        return instance

    def reset(self):
        self.match_inputs = None
        self.provenance = None
        self.raw_pixels = None
        self.crop = None

    def _match_layout(self, detected_pts, rows_in_layout, layouts, check_flipped):
        self.match_inputs = (detected_pts, rows_in_layout, layouts, check_flipped)
        return super()._match_layout(detected_pts, rows_in_layout, layouts, check_flipped)

    def recheck(self):
        """Ask the model matcher for its best alternative to the rejected layout.

        Reuse the same extracted traces and neural detections, avoiding random
        changes in extraction and preserving the source coordinate frame.
        """
        if not self.match_inputs or not self.provenance:
            return None
        points, rows, layouts, flipped = self.match_inputs
        alternatives = {k: v for k, v in layouts.items()
                        if k != self.provenance['layout']}
        if not alternatives:
            return None
        match = super()._match_layout(points, rows, alternatives, flipped)
        if not np.isfinite(match.get('cost', float('inf'))):
            return None
        return self._canonicalize_lines(
            torch.from_numpy(self.provenance['normalized'].copy()), match)

    def normalize(self, lines, avg_pixel_per_mm, mv_per_mm):
        self.raw_pixels = lines.detach().cpu().numpy().copy()
        valid = np.sum(~np.isnan(self.raw_pixels), axis=0)
        first = int(np.argmax(valid >= self.required_valid_samples))
        last = len(valid) - int(np.argmax((valid >= self.required_valid_samples)[::-1]))
        self.crop = (first, last) if first < last else (0, len(valid))
        return super().normalize(lines, avg_pixel_per_mm, mv_per_mm)

    def _canonicalize_lines(self, lines, match):
        canonical = super()._canonicalize_lines(lines, match)
        layout = self.layouts.get(match.get('layout'), {})
        self.provenance = {
            'layout': match.get('layout'),
            'raw': self.raw_pixels, 'normalized': lines.detach().cpu().numpy().copy(),
            'canonical': canonical.detach().cpu().numpy().copy(),
            'columns': layout.get('layout', {}).get('cols', 0), 'crop': self.crop,
            'flipped': bool(match.get('flip', False)),
            'matched': bool(np.isfinite(match.get('cost', float('inf')))),
        }
        return canonical
