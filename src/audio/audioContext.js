/**
 * Eén gedeelde AudioContext voor de hele app (muziek én microfoon): één geluidsstroom naar
 * macOS/Windows, in plaats van twee die het besturingssysteem apart moet verwerken.
 *
 * Pas aanmaken na een klik: browsers laten geen geluid toe zonder gebruikersgebaar.
 */
let context = null;

export function getAudioContext() {
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  return context;
}
