## ECG Camera Image Test Dataset

This folder contains 50 images selected from the **PMcardio ECG Image Database (PM-ECG-ID)** for testing ECG lead labeling.

The source dataset contains photographs of ECG printouts generated from PTB-XL recordings, alongside scans and digitally augmented images. This subset includes iPhone, Samsung, and Doogee photographs, plus photographs of bent and crumpled paper.

### Files

- **JPEG images:** ECG photographs used as test inputs.
- **metadata.csv:** Metadata for the full source dataset, linking images to PTB-XL ECG IDs and describing page numbers, layout, and rhythm strips. It includes records beyond these 50 images.
- **manifest.json:** Lists the selected images, their original archive paths, file sizes, checksums, and sampling seed.

The image filenames preserve the source photograph category. Some ECG recordings span multiple pages; consult the metadata before assuming an image contains all 12 leads.

These images support testing image processing and lead labeling. They do not provide future cardiac arrest outcome labels.

### Source and Attribution

Iring, A., et al. (2024). *PMcardio ECG Image Database (PM-ECG-ID): A Diverse ECG Database for Evaluating Digitization Solutions.*

[https://doi.org/10.5281/zenodo.13617673](https://zenodo.org/records/13617673)

The underlying ECG waveforms originate from PTB-XL:
[https://doi.org/10.13026/kfzx-aw45](https://physionet.org/content/ptb-xl/1.0.3/)
