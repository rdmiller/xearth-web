// The simulated clock: the moment on screen, moving at `speed` times real time from an
// anchor. Every change re-anchors at the moment then shown, so the clock carries on from
// where it is rather than jumping (xearth's -time and a rate, made continuous).

export interface Clock {
  /** The moment shown at `anchor`, or null to start from the real time at `anchor`. */
  time: Date | null;
  /** 1 = real time, 0 = paused, negative = backwards. */
  speed: number;
  /** Wall-clock ms at which `time` was shown. */
  anchor: number;
}

/** The real present, in real time. */
export const isLive = (c: Clock) => !c.time && c.speed === 1;

/** The moment shown at wall-clock `wall` (ms). */
export function clockAt(c: Clock, wall: number): Date {
  if (isLive(c)) return new Date(wall);
  const origin = c.time ? c.time.getTime() : c.anchor;
  return new Date(origin + (wall - c.anchor) * c.speed);
}

/** A new rate, carrying on from the moment shown. */
export function withSpeed(c: Clock, speed: number, wall: number): Clock {
  return { time: clockAt(c, wall), speed, anchor: wall };
}

/** Show `at` now, at the same rate: paused stays paused, real time plays on from there. */
export function jumpTo(c: Clock, at: Date, wall: number): Clock {
  return { time: new Date(at.getTime()), speed: c.speed, anchor: wall };
}

/** Jump `ms` forward (negative: back) from the moment shown. */
export function stepBy(c: Clock, ms: number, wall: number): Clock {
  return jumpTo(c, new Date(clockAt(c, wall).getTime() + ms), wall);
}

/** Back to the present, in real time. */
export const live = (wall: number): Clock => ({ time: null, speed: 1, anchor: wall });
