#Capture prototype (task #38) 

The capture screen is 'src/components/EKGCaptureScreen.tsx'. A user chooses or takes a photo of an EKG (paper or screen), crops it, and gets. JPEG result. Part of Sprint 2, User Story #3.

##Run it locally

Requires Node.js (LTS).From the repo root:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## What it does 
- Opens the device's camera or photo library through a standard file input ('accept="image/*"').
- Lets the user drag a crop box over the photo, then exports the crop as. JPEG (92% quality, smaller than PNG).
- Cancelling the picker does nothing, and non-image files can't be selected. 
- If the browser can't decode a photo (for example HEIC on some browsers), it shows "This photo couldn't be displayed. Try a JPEG or PNG."and returns to the start screen.

## Testing on a phone (development only) 
1. Put the phone and laptop on the same Wi-Fi.
2. Open the `Network:  ` address that `npm run dev` prints in the phone's browser. 

## Tested on 
- Laptop browser: choose, crop, and save all work.
- iPhone (via local network): choose, crop, and result screens work. 

## Known issues 
- Save on iPhone doesn't save. Tapping save shows a "Download" prompt, but no file appears. The Save control is a plain download link, and the likely cause is mobile Safari not handling it. This hasn't been confirmed. It matters little for the real app, since the image will be handed to the pipeline instead of downloaded. 
- HEIC from iPhone photos is untested. Some browsers can't display HEIC. A conversion step (a library such as `heic2any`) would need team approval. 

