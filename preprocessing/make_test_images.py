import sys
import cv2
import numpy as np

#takes one clean ECG image and creates "bad photo" versions of it in the samples/ fodler 

path = sys.argv[1]

#load the clean image (OpenCV loads it as a grid of BGR color values)
img = cv2.imread(path)
if img is None: 
    sys.exit(f"Could not read {path}")

#height and width in pixels
h, w = img.shape[:2] 

#make a bigger canvas so the tilted "paper" fits inside w/ visible background around it
#since preprocess.py finds paper by edges, background must look different from paper 
W, H = int(w * 1.3), int(h * 1.3)
background = (60, 60, 60) #dark gray

def tilt(image, dst_corners):
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32(dst_corners)
    #build perspective transform that moves src corners to dst corners 
    M = cv2.getPerspectiveTransform(src, dst) 
    return cv2.warpPerspective(image, M, (W, H), borderValue=background)


def add_shadow(image):
    #make left-to-right brightness ramp from 1.0 (full) down to 0.4 (dark) to replicate shadow 
    ramp = np.linspace(1.0, 0.4, image.shape[1], dtype = np.float32)
    ramp = np.tile(ramp, (image.shape[0], 1))[:, :, None]
    return np.clip(image * ramp, 0, 255).astype(np.uint8)

#Mild tilt
mild = tilt(img, [[0.10 * W, 0.12 * H], [0.88 * W, 0.08 * H], [0.90 * W, 0.90 * H], [0.08 * W, 0.86 * H]])

#strong tilt 
strong = tilt(img, [[0.18 * W, 0.15 * H], [0.90 * W, 0.04* H], [0.85 * W, 0.92 * H], [0.06 * W, 0.78 * H]])

#save variations into samples/
cv2.imwrite("samples/angled_mild.jpg", mild)
cv2.imwrite("samples/angled_strong.jpg", strong)
cv2.imwrite("samples/shadow_mild.jpg", add_shadow(mild))
cv2.imwrite("samples/shadow_strong.jpg", add_shadow(strong))

print("Saved 4 test images to samples/")
