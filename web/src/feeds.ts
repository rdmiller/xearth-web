// Data-feed status for the feeds dashboard: for each source on screen, when its data
// was published, when it was last checked, and when the next check is due.
//
// Two different clocks, kept apart on purpose: a source's data has its own time (the
// pipeline's run, a satellite scan, a radar frame), which is what "updated" means here;
// the app's polling is separate, and is what the countdown counts down to.

export type Freshness = 'fresh' | 'late' | 'stale';

export interface FeedState {
  /** Wall-clock ms the latest check started and last finished (either way). */
  startedAt?: number;
  checkedAt?: number;
  /** Publication time of the data now shown, ms; undefined when the source doesn't say. */
  dataAt?: number;
  /** Wall-clock ms the data last changed (a new file, a new frame). */
  changedAt?: number;
  /** When the next check is due, ms; undefined when there's no schedule. */
  nextAt?: number;
  busy: boolean;
  /** Why the latest check failed; cleared by the next one that works. */
  error?: string;
}

/** Times a source gives in its files: ISO strings, epoch ms, or nothing. */
export function toMs(t: string | number | null | undefined): number | undefined {
  if (t === null || t === undefined) return undefined;
  const ms = typeof t === 'number' ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Each source's checks, recorded as they start and finish. */
export class FeedLog {
  private readonly states = new Map<string, FeedState>();

  get(key: string): FeedState {
    let s = this.states.get(key);
    if (!s) this.states.set(key, (s = { busy: false }));
    return s;
  }

  /** A check started; with `everyMs`, the next comes that long after this one started. */
  begin(key: string, now: number, everyMs?: number) {
    const s = this.get(key);
    s.startedAt = now;
    s.busy = true;
    if (everyMs !== undefined) s.nextAt = now + everyMs;
  }

  done(key: string, now: number, dataAt?: string | number | null) {
    const s = this.get(key);
    const at = toMs(dataAt);
    if (s.checkedAt === undefined || at !== s.dataAt) s.changedAt = now;
    s.dataAt = at;
    s.checkedAt = now;
    s.busy = false;
    s.error = undefined;
  }

  fail(key: string, now: number, err: unknown) {
    const s = this.get(key);
    s.checkedAt = now;
    s.busy = false;
    s.error = err instanceof Error ? err.message : String(err);
  }

  /** Set (or clear) when the next check is due, for sources that schedule themselves. */
  next(key: string, at: number | undefined) {
    this.get(key).nextAt = at;
  }

  /** Forget a source's schedule when it's switched off; what it last held is kept. */
  stop(key: string) {
    const s = this.get(key);
    s.nextAt = undefined;
    s.busy = false;
  }
}

/**
 * How old the data is against how old it normally gets: up to `freshMs` is normal,
 * up to twice that is late, beyond is stale.
 */
export function freshness(ageMs: number, freshMs: number): Freshness {
  if (ageMs <= freshMs) return 'fresh';
  return ageMs <= 2 * freshMs ? 'late' : 'stale';
}

/** How far along the freshness bar the data's age is: the bar spans 0 to 2 × freshMs. */
export function ageFraction(ageMs: number, freshMs: number): number {
  return Math.max(0, Math.min(1, ageMs / (2 * freshMs)));
}

/** How much of the wait for the next check is over (0 just checked → 1 due). */
export function waitFraction(nextAt: number, everyMs: number, now: number): number {
  if (everyMs <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - (nextAt - now) / everyMs));
}

/** Time left before a check: "0:42", "12:05", "1 h 05". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The countdown squeezed into a ring's middle: "42s", "12m", "1h". */
export function shortCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** An age in words: "40 s", "12 min", "3 h", "2 days". */
export function formatAgeShort(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** A publication time as the readout shows them: "14:05Z", or "21 Oct 14:05Z" when not today. */
export function formatStamp(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${d.toISOString().slice(11, 16)}Z`;
  if (d.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) return hm;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${hm}`;
}
