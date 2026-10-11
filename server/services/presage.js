const { randomBytes } = require("node:crypto");
const sharp = require("sharp");
const {
  SmartSpectraSDK,
  PixelFormat,
  ValidationCode,
  SmartSpectraErrorCode,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
} = require("@smartspectra/node-sdk");

const MAX_ACTIVE_SESSIONS = 2;
const MAX_SESSION_MS = 90_000;
// Allow 25 FPS input (40 ms per frame) with a little timing jitter.
const FRAME_INTERVAL_MS = 35;
const MAX_FRAME_BYTES = 512 * 1024;
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;
const sessions = new Map();

function latest(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sample = values[values.length - 1];
  if (!Number.isFinite(Number(sample?.value))) return null;
  return {
    value: Number(sample.value),
    confidence: Number.isFinite(Number(sample.confidence)) ? Number(sample.confidence) : null,
    stable: Boolean(sample.stable),
  };
}

function readMetrics(packet) {
  const metrics = decodeMetrics(packet);
  return {
    pulseRate: latest(metrics?.cardio?.pulseRate),
    breathingRate: latest(metrics?.breathing?.rate),
    hrv: (() => {
      const sample = metrics?.cardio?.hrv?.at(-1);
      if (!sample || !Number.isFinite(Number(sample.rmssd))) return null;
      return {
        value: Number(sample.rmssd),
        confidence: Number.isFinite(Number(sample.confidence)) ? Number(sample.confidence) : null,
        stable: Boolean(sample.stable),
      };
    })(),
  };
}

function publicError(code) {
  if (code === SmartSpectraErrorCode.kAuthenticationFailed) return "SmartSpectra rejected the configured API key.";
  if (code === SmartSpectraErrorCode.kCreditExhausted) return "The SmartSpectra account has no remaining measurement credits.";
  if (code === SmartSpectraErrorCode.kInputUnavailable) return "SmartSpectra could not initialize camera frame processing.";
  return "SmartSpectra could not process this camera session.";
}

function send(session, payload) {
  const socket = session.socket;
  if (socket?.readyState === 1) socket.send(JSON.stringify(payload));
}

async function destroySession(session, { notify = false, error } = {}) {
  if (!session || session.closed) return;
  session.closed = true;
  clearTimeout(session.expiryTimer);
  sessions.delete(session.token);
  if (notify) send(session, error ? { type: "error", error } : { type: "ended" });
  try {
    await session.sdk.stopAsync();
  } catch {
    // A partially initialized or failed session may already be stopped.
  }
  try {
    await session.sdk.destroy();
  } catch {
    // SDK teardown errors should not prevent session cleanup.
  }
}

async function createSession() {
  const apiKey = process.env.PRESAGE_API_KEY;
  if (!apiKey) {
    const error = new Error("PRESAGE_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    const error = new Error("Vitals measurements are busy. Try again shortly.");
    error.status = 429;
    throw error;
  }

  const token = randomBytes(32).toString("base64url");
  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    enableTelemetry: false,
  });
  const session = {
    token,
    sdk,
    socket: null,
    closed: false,
    frameBusy: false,
    lastFrameAt: 0,
    frameRateWindowStartedAt: Date.now(),
    framesInRateWindow: 0,
    lastTimestampUs: 0,
    startedAt: Date.now(),
    expiryTimer: null,
  };

  sdk.on("validationStatus", (code, _timestampUs, hint) => {
    send(session, {
      type: "validation",
      code,
      hint: String(hint || ValidationCode[code] || "Adjust your camera position and lighting."),
    });
  });
  sdk.on("metrics", (packet) => {
    try {
      send(session, { type: "metrics", metrics: readMetrics(packet) });
    } catch {
      send(session, { type: "error", error: "SmartSpectra returned data the app could not read." });
    }
  });
  sdk.on("error", (code) => {
    send(session, { type: "error", error: publicError(code) });
    void destroySession(session);
  });

  sessions.set(token, session);
  try {
    sdk.useCustomInput();
    sdk.start();
  } catch (error) {
    await destroySession(session);
    if (error.code === SmartSpectraErrorCode.kAuthenticationFailed) {
      error.status = 502;
      error.message = publicError(error.code);
    }
    throw error;
  }
  session.expiryTimer = setTimeout(() => {
    void destroySession(session, { notify: true });
  }, MAX_SESSION_MS);
  session.expiryTimer.unref?.();
  return { token, maxDurationSeconds: MAX_SESSION_MS / 1000 };
}

function attachSocket(token, socket) {
  const session = sessions.get(token);
  if (!session || session.closed || session.socket) {
    socket.close(1008, "Invalid or already connected measurement session");
    return;
  }
  session.socket = socket;
  send(session, { type: "ready" });

  socket.on("message", (data, isBinary) => {
    if (!isBinary || session.closed || session.frameBusy) return;
    const jpeg = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (jpeg.length === 0 || jpeg.length > MAX_FRAME_BYTES) {
      send(session, { type: "error", error: "Camera frame is too large. Reduce camera resolution and try again." });
      return;
    }
    const now = Date.now();
    if (now - session.lastFrameAt < FRAME_INTERVAL_MS) return;
    session.lastFrameAt = now;
    session.frameBusy = true;

    sharp(jpeg, { limitInputPixels: 4_000_000 })
      .resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer()
      .then((rgb) => {
        if (session.closed) return;
        const timestampUs = Number(process.hrtime.bigint() / 1000n);
        session.lastTimestampUs = Math.max(timestampUs, session.lastTimestampUs + 1);
        session.sdk.sendFrame(
          rgb,
          FRAME_WIDTH,
          FRAME_HEIGHT,
          FRAME_WIDTH * 3,
          PixelFormat.kRGB,
          session.lastTimestampUs
        );
        session.framesInRateWindow += 1;
        const now = Date.now();
        const elapsed = now - session.frameRateWindowStartedAt;
        if (elapsed >= 1000) {
          send(session, {
            type: "frameRate",
            framesPerSecond: Math.round((session.framesInRateWindow * 1000) / elapsed),
          });
          session.framesInRateWindow = 0;
          session.frameRateWindowStartedAt = now;
        }
      })
      .catch(() => send(session, { type: "error", error: "Could not process a camera frame." }))
      .finally(() => { session.frameBusy = false; });
  });

  socket.on("close", () => { void destroySession(session); });
  socket.on("error", () => { void destroySession(session); });
}

function hasSession(token) {
  return sessions.has(token);
}

function closeSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  if (session.socket?.readyState === 1) session.socket.close(1000, "Measurement ended by user");
  void destroySession(session);
  return true;
}

module.exports = { attachSocket, closeSession, createSession, hasSession };
