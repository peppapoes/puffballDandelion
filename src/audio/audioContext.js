let context = null;

export function getAudioContext() {
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume().catch(() => {}); // voor de klik: mag nog niet, geen fout
  return context;
}
