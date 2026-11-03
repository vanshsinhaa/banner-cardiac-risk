"""Record the horizontal crop that upstream signal extraction applies."""
from src.model.signal_extractor import SignalExtractor


class TrackedSignalExtractor(SignalExtractor):
    @classmethod
    def wrap(cls, extractor):
        if type(extractor) is not SignalExtractor:
            raise TypeError('Unsupported signal extractor')
        instance = cls.__new__(cls)
        instance.__dict__.update(extractor.__dict__)
        instance.source_offset = None
        return instance

    def preprocess_lines(self, lines):
        # Upstream treats zeros as missing before finding the retained columns.
        valid = lines.nan_to_num(0.0).abs().sum(0) > 0
        self.source_offset = int(valid.nonzero()[0].item())
        return super().preprocess_lines(lines)
