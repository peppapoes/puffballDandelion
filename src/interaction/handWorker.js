/**
 * Web Worker: handherkenning met MediaPipe Hand Landmarker (Google), zonder ml5.
 * Draait in een aparte thread, zodat de wei vlot blijft renderen.
 *
 * In:  { type: 'init' }  → model laden
 *      { type: 'frame', bitmap, timestamp } → hand zoeken in dit camerabeeld
 * Uit: { type: 'ready', delegate } / { type: 'error', message }
 *      { type: 'hand', palm: { x, y } | null, timestamp, ms }  (palm: 0..1 in het beeld, gespiegeld zoals een spiegel)
 *
 * CameraVision start er meerdere tegelijk (HAND_WORKERS), elk met een eigen model.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Vaste versie, dezelfde als in package.json: een update verandert het project niet ongemerkt
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Midden van de handpalm: pols (0) en de knokkels van wijs-, middel-, ring- en pinkvinger
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
        // Gespiegeld: je hand naar rechts bewegen = naar rechts op het scherm
        palm = { x: 1 - x / PALM_POINTS.length, y: y / PALM_POINTS.length };
      }
    }
    data.bitmap.close(); // geheugen van het camerabeeld meteen vrijgeven
    // ms = hoe lang de herkenning duurde (voor de prestatiemeter);
    // timestamp terug: met meerdere workers kan een ouder beeld later klaar zijn
    self.postMessage({ type: 'hand', palm, timestamp: data.timestamp, ms: performance.now() - started });
  }
};

/** Model laden met de eerste rekenmethode die lukt ('CPU' of 'GPU') */
async function createLandmarker(delegates = ['CPU', 'GPU']) {
  // true = de versie voor module-workers (die geen importScripts kunnen gebruiken)
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
