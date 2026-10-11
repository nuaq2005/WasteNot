import { useEffect, useRef, useState } from "react";
import { createVitalsSession, getVitalsWebSocketUrl, stopVitalsSession } from "../api";

// 40 ms yields 25 sampled camera frames per second.
const FRAME_INTERVAL_MS = 40;
const SDK_STATUS_LABELS = ["Uninitialized", "Idle", "Starting", "Running", "Stopping", "Error"];

function metricText(metric, suffix = "") {
  if (!metric) return "Waiting for signal";
  const value = Number(metric.value);
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function confidenceText(metric) {
  if (!metric || metric.confidence == null) return "Confidence pending";
  return `${Math.round(metric.confidence)}% confidence${metric.stable ? " · stable" : " · building confidence"}`;
}

export default function Vitals() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const captureTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const startedAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(false);
  const frameBusyRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState("Camera is off");
  const [validation, setValidation] = useState("Start a session and keep your face centered in even light.");
  const [metrics, setMetrics] = useState({ pulseRate: null, breathingRate: null, hrv: null });
  const [sdkFrameRate, setSdkFrameRate] = useState(null);
  const [sdkProcessingStatus, setSdkProcessingStatus] = useState(null);
  const [error, setError] = useState("");

  function releaseResources() {
    clearInterval(captureTimerRef.current);
    clearInterval(elapsedTimerRef.current);
    captureTimerRef.current = null;
    elapsedTimerRef.current = null;
    if (socketRef.current) {
      const socket = socketRef.current;
      socketRef.current = null;
      socket.onclose = null;
      socket.close();
    }
    if (sessionTokenRef.current) {
      const token = sessionTokenRef.current;
      sessionTokenRef.current = null;
      void stopVitalsSession(token).catch(() => {});
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    frameBusyRef.current = false;
  }

  function stopMeasurement(message = "Measurement stopped. Camera is off.") {
    stoppingRef.current = true;
    releaseResources();
    setStarting(false);
    setMeasuring(false);
    setStatus(message);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stoppingRef.current = true;
      releaseResources();
    };
  }, []);

  async function startMeasurement() {
    if (starting || measuring) return;
    setError("");
    setMetrics({ pulseRate: null, breathingRate: null, hrv: null });
    setSdkFrameRate(null);
    setSdkProcessingStatus(null);
    setElapsedSeconds(0);
    setValidation("Center your face in the frame and stay still.");
    setStatus("Requesting camera access…");
    setStarting(true);
    stoppingRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires localhost or a secure HTTPS connection in a supported browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, min: 25, max: 30 },
        },
      });
      const cameraTrack = stream.getVideoTracks()[0];
      const cameraFps = Number(cameraTrack?.getSettings().frameRate);
      if (Number.isFinite(cameraFps) && cameraFps < 25) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(`Your camera is running at ${cameraFps} FPS. Select a camera mode that supports at least 25 FPS, then try again.`);
      }
      if (!mountedRef.current || stoppingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current || stoppingRef.current) {
        releaseResources();
        return;
      }

      setStatus("Starting SmartSpectra…");
      const session = await createVitalsSession();
      sessionTokenRef.current = session.token;
      if (!mountedRef.current || stoppingRef.current) {
        releaseResources();
        return;
      }
      const socket = new WebSocket(getVitalsWebSocketUrl(session.token));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          setError("The vitals service returned an unreadable response.");
          stopMeasurement("Measurement stopped after a service error.");
          return;
        }
        if (payload.type === "ready") {
          startedAtRef.current = Date.now();
          setStarting(false);
          setMeasuring(true);
          setStatus(`Measuring from live camera video${cameraFps ? ` · ${Math.round(cameraFps)} FPS` : ""}`);
          captureTimerRef.current = setInterval(sendFrame, FRAME_INTERVAL_MS);
          elapsedTimerRef.current = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
          }, 1000);
        } else if (payload.type === "validation") {
          setValidation(payload.hint || "Adjust your position for a better signal.");
        } else if (payload.type === "metrics") {
          setMetrics(payload.metrics);
        } else if (payload.type === "frameRate") {
          setSdkFrameRate(payload.framesPerSecond);
        } else if (payload.type === "processingStatus") {
          setSdkProcessingStatus(payload.status);
        } else if (payload.type === "error") {
          setError(payload.error || "SmartSpectra could not process this session.");
          stopMeasurement("Measurement stopped after a service error.");
        } else if (payload.type === "ended") {
          stopMeasurement("Session time limit reached. Camera is off.");
        }
      };
      socket.onerror = () => {
        if (stoppingRef.current) return;
        setError("Could not connect to the vitals service. Check that the API server is running.");
        stopMeasurement("Measurement stopped after a connection error.");
      };
      socket.onclose = () => {
        if (!stoppingRef.current && streamRef.current) {
          setError("The vitals connection closed. Start a new measurement to try again.");
          stopMeasurement("Measurement connection closed. Camera is off.");
        }
      };
    } catch (startError) {
      releaseResources();
      setStarting(false);
      setMeasuring(false);
      setStatus("Camera is off");
      if (startError.name === "NotAllowedError") {
        setError("Camera permission was denied. Allow camera access in your browser settings and try again.");
      } else if (startError.name === "NotFoundError") {
        setError("No camera was found on this device.");
      } else if (startError.name === "OverconstrainedError" && startError.constraint === "frameRate") {
        setError("This camera mode cannot provide 25 FPS. Select a mode that supports at least 25 FPS and try again.");
      } else {
        setError(startError.message || "Could not start the vitals measurement.");
      }
    }
  }

  function sendFrame() {
    const socket = socketRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !video || !canvas || frameBusyRef.current) return;
    if (socket.bufferedAmount > 512 * 1024 || video.videoWidth === 0 || video.videoHeight === 0) return;

    frameBusyRef.current = true;
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob && socket.readyState === WebSocket.OPEN && !stoppingRef.current) socket.send(blob);
      frameBusyRef.current = false;
    }, "image/jpeg", 0.72);
  }

  const styles = {
    page: { textAlign: "left", maxWidth: "900px", margin: "auto", color: "#222" },
    header: { marginBottom: 20 },
    description: { color: "#666", marginTop: 8, maxWidth: 700 },
    layout: { display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(250px, 0.8fr)", gap: 18 },
    card: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, boxShadow: "var(--shadow)" },
    preview: { width: "100%", display: "block", borderRadius: 8, background: "#111", aspectRatio: "4 / 3", objectFit: "cover", transform: "scaleX(-1)" },
    button: { marginTop: 14, padding: "10px 18px", border: 0, borderRadius: 7, background: measuring ? "#a32626" : "#6a2dbd", color: "white", fontWeight: 700, cursor: starting ? "wait" : "pointer" },
    status: { marginTop: 12, color: "#51495e", fontWeight: 600 },
    validation: { marginTop: 8, color: "#51495e", minHeight: "3em" },
    eyebrow: { margin: "0 0 6px", color: "#756a80", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" },
    cardTitle: { margin: "0 0 12px", fontSize: 18, color: "var(--text-h)" },
    metric: { borderTop: "1px solid var(--border)", padding: "12px 0" },
    metricName: { display: "block", fontWeight: 700, color: "var(--text-h)" },
    metricValue: { display: "block", fontSize: 22, fontWeight: 700, margin: "5px 0" },
    confidence: { display: "block", color: "#716a7a", fontSize: 13 },
    notice: { marginTop: 18, padding: 14, borderRadius: 8, background: "#fff8e8", color: "#58431d", fontSize: 14 },
    error: { marginTop: 12, color: "crimson" },
    statusPill: { display: "inline-block", padding: "4px 9px", borderRadius: 99, background: "#f1eef6", color: "#51495e", fontSize: 13 },
  };
  const hasAnyMetric = Object.values(metrics).some((metric) => metric && Number.isFinite(Number(metric.value)));

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <p style={styles.eyebrow}>PRESAGETECH SMARTSPECTRA</p>
        <h2>Camera vitals</h2>
        <p style={styles.description}>
          Use bright, even light on your face and keep the camera steady. Low light can make the camera lower its frame rate. A single still photo cannot provide these measurements.
        </p>
      </header>

      <div style={styles.layout}>
        <section style={styles.card} aria-label="Camera measurement">
          <video ref={videoRef} style={styles.preview} muted playsInline />
          <canvas ref={canvasRef} hidden />
          <div style={styles.status} aria-live="polite">
            <span style={styles.statusPill}>{status}</span>
            {(measuring || starting) && <span> · {elapsedSeconds}s</span>}
          </div>
          <p style={styles.validation} aria-live="polite">{validation}</p>
          {measuring && sdkFrameRate != null && (
            <p style={sdkFrameRate < 25 ? styles.error : styles.status} aria-live="polite">
              Frames reaching SmartSpectra: {sdkFrameRate} FPS
              {sdkFrameRate < 25 ? " · add bright, even light and close other camera or CPU-heavy apps" : ""}
            </p>
          )}
          {measuring && sdkProcessingStatus != null && (
            <p style={styles.status} aria-live="polite">
              SmartSpectra pipeline: {SDK_STATUS_LABELS[sdkProcessingStatus] ?? `status ${sdkProcessingStatus}`}
            </p>
          )}
          {measuring && elapsedSeconds >= 60 && !hasAnyMetric && (
            <p role="alert" style={styles.error}>
              No readings yet after 60 seconds. Confirm the SDK input is at least 25 FPS, use bright even light, keep one face centered and still, and check the server terminal for a SmartSpectra SDK error.
            </p>
          )}
          {measuring ? (
            <button type="button" style={styles.button} onClick={() => stopMeasurement()}>
              Stop measurement
            </button>
          ) : (
            <button type="button" style={styles.button} onClick={startMeasurement} disabled={starting}>
              {starting ? "Starting camera…" : "Start camera measurement"}
            </button>
          )}
          {error && <p role="alert" style={styles.error}>{error}</p>}
        </section>

        <section style={styles.card} aria-label="Measured wellness information">
          <p style={styles.eyebrow}>LIVE SESSION</p>
          <h3 style={styles.cardTitle}>Wellness readings</h3>
          <div style={styles.metric}>
            <span style={styles.metricName}>Pulse rate</span>
            <span style={styles.metricValue}>{metricText(metrics.pulseRate, " bpm")}</span>
            <span style={styles.confidence}>{confidenceText(metrics.pulseRate)} · about 12 seconds</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricName}>Breathing rate</span>
            <span style={styles.metricValue}>{metricText(metrics.breathingRate, " breaths/min")}</span>
            <span style={styles.confidence}>{confidenceText(metrics.breathingRate)} · about 30 seconds</span>
          </div>
          <div style={styles.metric}>
            <span style={styles.metricName}>Heart rate variability (RMSSD)</span>
            <span style={styles.metricValue}>{metricText(metrics.hrv, " ms")}</span>
            <span style={styles.confidence}>{confidenceText(metrics.hrv)} · about 60 seconds</span>
          </div>
        </section>
      </div>

      <aside style={styles.notice}>
        <strong>Privacy and use:</strong> With your permission, live camera frames are sent to the WasteNot server for processing and are not saved. Keep still in even light, with your face centered; include your chest for breathing readings. These measurements are for general wellness only, not medical diagnosis or treatment.
      </aside>
    </div>
  );
}
