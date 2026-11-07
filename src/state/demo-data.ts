/**
 * Embedded demo dataset (F5) — data, not onboarding.
 *
 * Eight rows of a real table so the stepper, the source table and the split
 * view are discoverable for a first-timer with no CSV. Four columns: each row
 * is a rotation of the sine table, a ramp word, and a 16-bit mask; importing
 * it binds lane 1 to the widest column (32-bit `sine`) and lanes 2/3 to the
 * other payload columns.
 */

export const DEMO_NAME = "demo dataset";

export const DEMO_CSV = [
  "step,sine,ramp,mask",
  "1,8ADEFEDA,01234567,1111000011110000",
  "2,ADEFEDA8,12345678,0000111100001111",
  "3,DEFEDA8A,23456789,1111000011110000",
  "4,EFEDA8AD,3456789A,0000111100001111",
  "5,FEDA8ADE,456789AB,1111000011110000",
  "6,EDA8ADEF,56789ABC,0000111100001111",
  "7,DA8ADEFE,6789ABCD,1111000011110000",
  "8,A8ADEFED,789ABCDE,0000111100001111",
  "",
].join("\n");
