import sys
import cv2
import numpy as np 

def order_points(pts):
    #Sort 4 corners into: top-left, top-right, bottom-right, bottom-left
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect

def find_boundary(img): 
    #look for the largest 4-sided shape (the EKG paper or screen)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    #ignore shapes samller than 20% of the photo
    min_area = 0.2 * img.shape[0] * img.shape[1]

    #median brightness to tell us how dark or bright photo is 
    #dark photos need lower edge thresholds to still show edges 
    med = float(np.median(blur))
    auto = (int(max(0, 0.66 * med)), int(min(255, 1.33 * med)))

    #try several edge sensitivities, strictest first. we stop at the first one that finds the paper.
    for low, high in [(50, 150), auto, (10, 40)]:
        edges = cv2.Canny(blur, low, high)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        for c in contours: 
            #convex hull wraps shape in tight rubber band, smooths out bumps from shadows or glare on edge 
            hull = cv2.convexHull(c)
            peri = cv2.arcLength(hull, True)

            #try progressively looser corner simplification (0.02 to 0.08) until shape reduces to exactly 4 corners
            for eps in (0.02, 0.03):
                approx = cv2.approxPolyDP(hull, eps * peri, True)
                if len(approx) == 4:
                    if cv2.contourArea(approx) > min_area:
                        return approx.reshape(4, 2).astype("float32")
                    break
            
    return None


def warp(img, pts):
    #perspective transform turn the angled quad into a flat rectangle 
    rect = order_points(pts)
    tl, tr, br, bl = rect 
    w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, M, (w, h))

def normalize_lighting(img):
    #divide brightness by heavily blurred copy of itself to flatten shadows 
    # then boost local contrast so trace stays visible
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    # Estimate the smooth illumination field at bounded resolution. Blurring a
    # full phone photo with a thousand-pixel kernel can exceed the API timeout.
    scale = min(1.0, 512 / max(l.shape))
    small = cv2.resize(l, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else l
    bg = cv2.GaussianBlur(small, (0, 0), sigmaX=max(1, max(small.shape) / 10))
    if bg.shape != l.shape:
        bg = cv2.resize(bg, (l.shape[1], l.shape[0]), interpolation=cv2.INTER_LINEAR)
    flat = cv2.divide(l, bg, scale=200)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    flat = clahe.apply(flat)
    return cv2.cvtColor(cv2.merge((flat, a, b)), cv2.COLOR_LAB2BGR)

def preprocess(img):
    #returns (image, boundary_found). if no boundary is found, og comes back 
    # unchanged with False
    pts = find_boundary(img)
    if pts is None: 
        return img, False
    return normalize_lighting(warp(img, pts)), True

if __name__ == "__main__":
    path = sys.argv[1]
    out = sys.argv[2]
    img = cv2.imread(path)
    if img is None: 
        sys.exit(f"Could not read {path}")
    result, found = preprocess(img)
    cv2.imwrite(out, result)
    print(f"boundary_found={found} -> {out}")