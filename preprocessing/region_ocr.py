"""Independent local label candidates; no expected label is used in OCR."""
import cv2
import numpy as np


def ink(image, threshold=110):
    channel=image[:,:,2] if image.ndim==3 else image
    background=cv2.GaussianBlur(channel,(0,0),15)
    return (cv2.divide(channel,background,scale=255)<threshold).astype(np.uint8)*255


def candidates(mask):
    count, labels, stats,_=cv2.connectedComponentsWithStats(mask)
    glyphs=[]
    for x,y,w,h,area in stats[1:]:
        if 5<=h<=40 and 1<=w<=h*1.5 and area>=5 and area/(w*h)>.12:
            glyphs.append(tuple(map(int,(x,y,w,h))))
    # Group adjacent glyphs with compatible baselines and sizes.
    groups=[]
    for box in sorted(glyphs):
        x,y,w,h=box
        owners=[]
        for i,g in enumerate(groups):
            a,b,c,d=g[-1]
            if 0<=x-a-c<=max(h,d)*.85 and abs(y-b)<min(h,d)*.35 and abs(y+h-b-d)<max(h,d)*.35:
                owners.append(i)
        if len(owners)==1:groups[owners[0]].append(box)
        else:groups.append([box])
    result=[]
    for group in groups:
        x=min(g[0] for g in group);y=min(g[1] for g in group)
        w=max(g[0]+g[2] for g in group)-x;h=max(g[1]+g[3] for g in group)-y
        if len(group)<=4 and w<=h*4:
            result.append((x,y,w,h,group))
    return result


def roman_supported(image, box, name):
    """Reject missing bars and isolated waveform/grid strokes; never guess a name."""
    x,y,w,h=map(float,box)
    if h<6 or x<1 or y<1 or x+w>=image.shape[1]-1 or y+h>=image.shape[0]-1:
        return False
    mask=ink(image,145)
    a=max(0,int(x-h));b=max(0,int(y-2));c=min(mask.shape[1],int(x+w+h+1));d=min(mask.shape[0],int(y+h+3))
    patch=mask[b:d,a:c]
    n,l,stats,_=cv2.connectedComponentsWithStats(patch)
    bars=[]
    for xx,yy,ww,hh,area in stats[1:]:
        xx+=a;yy+=b
        if abs(yy-y)>h*.25 or abs(yy+hh-y-h)>h*.25:continue
        if not .08*h<=ww<=.8*h or not .7*h<=hh<=1.3*h:continue
        glyph=mask[yy:yy+hh,xx:xx+ww]>0
        if np.max(glyph.sum(axis=0))<hh*.7:continue
        bars.append((xx,yy,ww,hh,glyph))
    intersect=[g for g in bars if g[0]<x+w+1 and g[0]+g[2]>x-1]
    if not intersect:return False
    # Include adjacent bars the OCR box may have omitted.
    selected=intersect[:]
    for g in bars:
        if any(abs(g[0]-(p[0]+p[2]))<h*.65 or abs(p[0]-(g[0]+g[2]))<h*.65 for p in intersect):
            if not any(g is p for p in selected):selected.append(g)
    if len(selected)!=len(name):return False
    if name=='I':
        _,_,ww,hh,glyph=selected[0]
        # A lone sans-serif bar is indistinguishable from a trace fragment.
        if ww<hh*.3:return False
        if min(glyph[:max(1,hh//4)].sum(axis=1).max(),glyph[-max(1,hh//4):].sum(axis=1).max())<ww*.65:return False
        if glyph[hh//2].sum()>ww*.7:return False
    return True


def refine_labels(image, regions, ocr, *, budget_seconds=20):
    """Read small label components and require repeat support for small text.

    Expected names are deliberately unused: only source boxes constrain search.
    Baseline Roman-numeral detections are also checked against pixel strokes.
    """
    import time
    import pytesseract
    from lead_ocr import token, LEAD_TOKENS
    result=dict(ocr)
    detections=[dict(d) for d in ocr.get('detections',[])]
    # Orientation from noisy full-page text can be wrong; local reads remain in
    # the source coordinate frame. Existing rotated Roman proposals are unsafe.
    detections=[d for d in detections if d['lead'] not in ('I','II','III') or
                (ocr.get('rotation_degrees',0)==0 and roman_supported(image,d['box'],d['lead']))]
    deadline=time.monotonic()+budget_seconds
    boxes=[r['box'] for r in regions.values() if 'box' in r]
    proposals=[]
    def inside(box):
        x,y,w,h=box
        return any(a<=x+w/2<=c and b<=y+h/2<=d for a,b,c,d in boxes)
    def read(view,scale,offset,method,psm=11):
        remaining=deadline-time.monotonic()
        if remaining<.2:return
        try:
            data=pytesseract.image_to_data(view,config=f'--psm {psm} -c load_system_dawg=0 -c load_freq_dawg=0',output_type=pytesseract.Output.DICT,timeout=min(3,remaining))
        except RuntimeError as exc:
            if 'timeout' not in str(exc).lower():raise
            return
        for i,word in enumerate(data['text']):
            name=token(word);confidence=float(data['conf'][i])
            if name not in LEAD_TOKENS or confidence<70:continue
            x,y,w,h=[float(data[k][i])/scale for k in ('left','top','width','height')]
            x+=offset[0];y+=offset[1]
            if not 6<=h<=40 or not inside((x,y,w,h)):continue
            if name in ('I','II','III') and not roman_supported(image,(x,y,w,h),name):continue
            proposals.append({'lead':name,'confidence':confidence,'height':h,'box':[x,y,w,h],'method':method})
    # Gentler foreground thresholds preserve antialiased small glyphs.
    for threshold in (145,175):
        mask=ink(image,threshold)
        n,l,stats,_=cv2.connectedComponentsWithStats(mask)
        keep=np.array([0]+[255 if 5<=h<=45 and 1<=w<=100 and area>=5 else 0 for x,y,w,h,area in stats[1:]],np.uint8)
        view=cv2.resize(255-keep[l],None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
        read(view,3,(0,0),f'page-{threshold}')
    # Tight component crops remove the surrounding waveform from segmentation.
    groups=[]
    for threshold in (110,175):
        for x,y,w,h,g in candidates(ink(image,threshold)):
            if not inside((x,y,w,h)) or w<h*.7 or h>30 or x<2 or y<2:continue
            if any(abs(x-a)<3 and abs(y-b)<3 for a,b,_,_ in groups):continue
            groups.append((x,y,w,h))
    # Bound work without privileging the expected name or a particular lead.
    groups=sorted(groups,key=lambda b:(-min(b[2]/b[3],2),b[1],b[0]))[:48]
    for x,y,w,h in groups:
        if deadline-time.monotonic()<.2:break
        crop=image[y-2:y+h+2,x-2:x+w+2]
        red=crop[:,:,2] if crop.ndim==3 else crop
        for scale in (3,5):
            view=cv2.resize(red,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC)
            view=cv2.copyMakeBorder(view,20,20,20,20,cv2.BORDER_CONSTANT,value=255)
            read(view,scale,(x-2-20/scale,y-2-20/scale),f'crop-{scale}',7)
    # Repeated detections must refer to the same glyph, not just the same name.
    all_items=detections+proposals
    for item in proposals:
        x,y,w,h=item['box'];methods={item['method']}
        for other in all_items:
            a,b,c,d=other['box']
            if other['confidence']>=70 and other['height']>=6 and other['lead']==item['lead'] and abs(x+w/2-a-c/2)<max(w,c)*.35 and abs(y+h/2-b-d/2)<max(h,d)*.35:
                methods.add(other.get('method','baseline'))
        if len(methods)>=2:
            item={**item,'local_support':len(methods)}
            detections.append(item)
    result['detections']=detections
    result['local_refinement_seconds']=budget_seconds-max(0,deadline-time.monotonic())
    result['local_refinement_truncated']=time.monotonic()>=deadline
    return result
