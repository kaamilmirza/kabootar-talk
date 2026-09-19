/**
 * Naming a kabootar.
 *
 * Every bird gets a name the moment she hatches, and keeps it. A bird you have
 * been writing with for a month should not be "pigeon 2" — she should be Heer,
 * and you should mind when she comes home exhausted. You can rename her, but
 * she will never be nameless.
 */

import { PIGEON_NAMES } from '../flight/states';

/** Two different names, for the pair a nest starts with. */
export function hatchNames(): [string, string] {
  const first = Math.floor(Math.random() * PIGEON_NAMES.length);
  let second = Math.floor(Math.random() * PIGEON_NAMES.length);
  if (second === first) second = (first + 1) % PIGEON_NAMES.length;

  return [PIGEON_NAMES[first], PIGEON_NAMES[second]];
}
