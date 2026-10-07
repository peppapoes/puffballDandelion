/**
 * Hoogte van de glooiende wei op positie (x, z).
 * Gebruikt door de grond (vorm) en door de wei (bloemen op de grond plaatsen).
 */
export function heightAt(x, z) {
  return (
    Math.sin(x * 0.15) * 0.8 +
    Math.cos(z * 0.12) * 0.6 +
    Math.sin((x + z) * 0.07) * 1.0
  );
}
