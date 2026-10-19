import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PALM_POINTS = [0, 5, 9, 13, 17];

let landmarker = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const delegate = await createLandmarker(data.delegates);
      self.postMessage({ type: 'ready', delegate });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error?.message ?? error) });
    }
    return;
  }

  if (data.type === 'frame') {
    const started = performance.now();
    let palm = null;
    if (landmarker) {
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      const hand = result.landmarks[0];
      if (hand) {
        let x = 0;
        let y = 0;
        for (const index of PALM_POINTS) {
          x += hand[index].x;
          y += hand[index].y;
        }
        palm = { x: 1 - x / PALM_POINTS.length, y: y / PALM_POINTS.length };
      }
    }
    data.bitmap.close(); // geheugen van het camerabeeld meteen vrijgeven
    self.postMessage({ type: 'hand', palm, timestamp: data.timestamp, ms: performance.now() - started });
  }
};

async function createLandmarker(delegates = ['CPU', 'GPU']) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL, true);
  let lastError;
  for (const delegate of delegates) {
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      return delegate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
