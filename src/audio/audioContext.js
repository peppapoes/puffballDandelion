/**
 * Eén gedeelde AudioContext voor de hele app (muziek én microfoon): één geluidsstroom naar
 * macOS/Windows, in plaats van twee die het besturingssysteem apart moet verwerken.
 *
 * Mag al voor de klik aangemaakt worden: dan blijft ze gepauzeerd ('suspended') tot een klik.
 * Elke aanroep probeert ze te hervatten; binnen een klik lukt dat.
 */
let context = null;

export function getAudioContext() {
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume().catch(() => {}); // voor de klik: mag nog niet, geen fout
  return context;
}
