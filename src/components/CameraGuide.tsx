"use client";

import {useEffect, useRef, useState} from "react";
import type {CSSProperties} from "react";

//live camera view with framing box and lighting tips 
interface CameraGuideProps {
    //called w/ captured frame as a JPEG data URL 
    onPhoto: (dataUrl: string) => void; 
    //called when user backs out 
    onCancel: () => void; 
}

export default function CameraGuide({onPhoto, onCancel}: CameraGuideProps) {
    //refs give direct access to video element and camera stream 
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    //friendly message shown if camera can't be used 
    const [error, setError] = useState<string | null>(null);

    //true once video is playing, so we never captures a blank frame 
    const [ready, setReady] = useState(false);

    useEffect(() => {
        //guards against component closing while waiting for permission
        let cancelled = false; 
        
        const startCamera = async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
                setError(
                    "Live camera isn't available here (it needs HTTPS or localhost). Go back and use the photo picker."
                );
                return;
            }
            try {
                //ask for back camera ("environment") at a high resolution 
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: {ideal: "environment"},
                        width: {ideal: 1920}, 
                        height: {ideal: 1080},
                    },
                    audio: false, 
                });
                //if user left, shut camera off 
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;

                //connect camera stream to video element 
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch {
                //permission denied, or no camera found 
                setError("Camera access was denied or no camera was found. Go back and use the photo picker.");
            }
        };
        startCamera();

        //cleanup: turn camera off when this component goes away
        return () => { 
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    const takePhoto = () => {
        const video = videoRef.current;

        //videoWidth is 0 until cmaera is running 
        if (!video || !video.videoWidth) return; 

        //copy current video frame onto canvas at full camera resolution
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        //hand frame to parent as JPEG 
        onPhoto(canvas.toDataURL("image/jpeg", 0.92));
    };

    if (error) {
        return (
            <>
                <p style={styles.error}>{error}</p> 
                <button style={styles.btnSecondary} onClick={onCancel}>
                    Back
                </button>
            </>
        );
    }

    return (
        <>
            <div style = {styles.videoWrap}>
                { /*playsInline + muted are required for the video to play on iPhones */ }
                   <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        onLoadedMetadata={() => setReady(true)}
                        style={styles.video} 
                    />
                { /* framing box sits on top of video. pointerEvents none means taps pass through it to the page underneath */ }  
                    <div style = {styles.frameBox} />
                    <div style = {styles.frameLabel}>Fit the whole EKG inside the box</div>       
            </div>

            <ul style={styles.tips}>
                <li>Turn your phone sideways (landscape) to match the strip.</li>
                <li>Hold the phone parallel to the paper or screen, not at an angle.</li>
                <li>Avoid glare: if you see a bright reflection, tilt slightly or move away from overhead lights.</li>
                <li>Keep all four edges visible and hold steady before you tap.</li>
            </ul>

            <div style={styles.row}>
                <button style={styles.btnSecondary} onClick={onCancel}>
                    Cancel
                </button>
                <button
                    style={{ ...styles.btnPrimary, opacity: ready ? 1 : 0.5 }}
                    disabled={!ready}
                    onClick={takePhoto}
                >
                    Take photo
                </button>
            </div>
        </>
    );
}

const styles: Record<string, CSSProperties> = {
    videoWrap: { position: "relative", borderRadius: 8, overflow: "hidden", background: "#000"},
    video: {display: "block", width: "100%", height: "auto"},
    //dashed box; box-shadow dims everything outside it
    frameBox: {
        position: "absolute",
        left: "6%",
        right: "6%",
        top: "18%",
        bottom: "18%",
        border: "2px dashed #fff",
        borderRadius: 4, 
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
        pointerEvents: "none",
    },
    frameLabel: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 8,
        textAlign: "center",
        color: "#fff",
        fontSize: 13,
        textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    },
    tips: {margin: "16px 0 0", paddingLeft: 20, fontSize: 14, color: "#16202a", lineHeight: 1.5},
    row: {display: "flex", gap: 10, marginTop: 16},
    btnPrimary: {
        background: "#2f6f5e",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "12px 18px",
        flex: 1,
        cursor: "pointer",
        font: "inherit",
    },
    btnSecondary: {
        background: "transparent",
        border: "1px solid #dde1e4",
        color: "#16202a",
        borderRadius: 8,
        padding: "12px 18px",
        flex: 1,
        cursor: "pointer",
        font: "inherit",
    },
    error: { color: "#b3261e", fontSize: 14, margin: "0 0 12px" },
};
