// 依姿勢分派到各自的產生器：平常坐著（sit.ts，正面）、睡覺捲成一圈（curl.ts，俯視）、
// 站著和之後的走路（side.ts，側面）。

import type { Creature, CreatureSpec, Frame } from './creature.ts';
import { drawCurl } from './curl.ts';
import { drawSide } from './side.ts';
import { drawSit } from './sit.ts';

export function drawCreature(spec: CreatureSpec, frame: Frame, seed = 0): Creature {
  if (frame.pose === 'sleep') return drawCurl(spec, frame, seed);
  if (frame.pose === 'stand' || spec.style.sideIdle) return drawSide(spec, frame, seed);
  return drawSit(spec, frame, seed);
}
