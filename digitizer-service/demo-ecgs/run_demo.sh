#!/bin/bash
# Sends every demo ECG in this folder to the digitizer service and opens each T-wave plot.
# Start the service first (see the README one folder up). Paper speed is read from the
# file name: "_50mm" means 50 mm/s, anything else 25 mm/s.
# Usage: ./run_demo.sh            all images
#        ./run_demo.sh 3_*.jpg    one image

cd "$(dirname "$0")"
PLOTS=../trace-plots
mkdir -p "$PLOTS"
files=("$@")
[ ${#files[@]} -eq 0 ] && files=([0-9]_*.png [0-9]_*.jpg)

for image in "${files[@]}"; do
    speed=25
    [[ "$image" == *_50mm.* ]] && speed=50
    echo "Sending $image at $speed mm/s..."
    if ! curl -sf -F "image=@$image" -F "paper_speed=$speed" http://127.0.0.1:8000/digitize \
        -o "$PLOTS/${image%.*}_data.json"; then
        echo "  failed: is the service running on port 8000?"
        continue
    fi
    open "$(ls -t "$PLOTS"/*_t-waves.png | head -1)"
done
