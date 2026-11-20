# Demo ECGs

Images that digitize well and give clear T-wave plots. The paper speed is in each
file name; `run_demo.sh` sends it with the image.

| File | Layout | Speed | What it shows |
|---|---|---|---|
| 1_normal_v1-v6_50mm.png | V1–V6 only | 50 mm/s | Clean normal ECG, upright T waves, 6/6 leads |
| 2_wide-qrs-lbbb_v1-v6_50mm.png | V1–V6 only | 50 mm/s | Wide QRS (bundle branch block): T wave found after the QRS, 6/6 leads |
| 3_normal_3x4_25mm.jpg | 3x4 + rhythm strips | 25 mm/s | Normal 12-lead, 12/12 leads |
| 4_rbbb-inverted-t_3x4_25mm.jpg | 3x4 + rhythm strip | 25 mm/s | RBBB: inverted T waves in V1–V3, some leads marked no_twave |
| 5_lvh-slow-hr_3x4_25mm.jpg | 3x4 + rhythm strip | 25 mm/s | Slow heart rate (47 bpm), 11/12 leads |
| 6_normal_6x2_25mm.jpg | 6x2 | 25 mm/s | Normal 12-lead in a 6x2 layout, 10/12 leads |

Before/after for the paper speed fix: send image 1 without `paper_speed` (treated as
25 mm/s), so time is stretched 2x and the T waves are cut off:

    curl -s -F image=@1_normal_v1-v6_50mm.png http://127.0.0.1:8000/digitize -o /dev/null

Plots and the returned data (`*_data.json`) are saved to `../trace-plots/`.

Sources: images 1 and 2 are from Open-ECG-Digitizer's test data
(`test/test_data/data/ecg_data/12_1.png`, `10_1.png`). Images 3–6 are from Wikimedia
Commons: "Normal 12 lead EKG.jpg", "ECG NSR with RBBB 74 bpm.jpg", "12 lead ECG.jpg",
"Ekg normal bionerd.jpg". Check their licences before sharing them outside the team.
