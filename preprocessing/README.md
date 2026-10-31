# EKG Image Preprocessing Prototype

Part of Sprint 2, User Story #3 (handling imperfect EKG printouts), task #43. 

##What it does
Takes a photo of an EKG (paper or screen) and returns a cleaned-up image: 

1. Finds the EKG boundary: looks for the largest four-cornered shape in the photo. 
2. Corrects skew and perspectives: applies a perpsective transform so an angled photo becomes a flat, top-down rectangle. 
3. Normalizes lighting: flattens shadows and boosts local contrast so the trace stays visible. 

This step only fixes images. 

## Setup
Requires Python 3. From inside the preprocessing folder: 

```bash
python3 -m venv venv
source venv/bin/activate
pip install opencv-python numpy 
```

## Usage
```bash
python3 preprocess.py <input_image> <output_image>
```

Example: 
```bash
python3 preprocess.py samples/angled_mild.jpg output/angled_mild_clean.jpg
```

The script prints "boundary_found=True" or "boundary_found=False":
- True: a boundary was found, and the output is flattened, lighting-corrected image. 
- False: no usable boundary was found. The output is the original image, unchanged, so a later step can handle it. 

In code, "preprocess(img)" returns "(image, boundary_found)".

To run every image in samples/
```bash
for f in samples/*.jpg; do python3 preprocess.py "$f" "output/$(basename "$f" .jpg)_clean.jpg"; done
```

## Testing
Tested on 8 images. These are variations of one non-patient sample EKG shown on laptop screen and photographed with a phone. "make_test_images.py" generates additional angled and shadowed versions from a source image. 

Before/after examples are in "sample/" (inputs) and "output/" (results).

## Known limitations 
- Test images come from a single EKG, so results may differ on other paper types, glare, or creases. 
- Cluttered scenes with several nested rectangles (toolbars, bezels, etc.) can lead to the wrong boundary being picked. 
- Very dark one-sided shadows can hide an edge, which returns "boundary_found=False".
- thin strips of border (such as a screen bezel) can remain at the image edges. 
- The script can't yet check whether a "found" boundary is the real page, so a wrong crop is possible. 
- Glare and low-resolution handling are not covered here. 
- Python/OpenCV prototype only. It is not yet conencted to the Next.js capture screen. That integration (opencv.js in the browser, or a backend step) is a later decision. 