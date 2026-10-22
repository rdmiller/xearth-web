// Poll the pipeline's latest.json and hand each new cloud map to the renderer.

export interface CloudManifest {
  /** Scan start time, ISO 8601 UTC. */
  t: string;
  /** Image path, relative to latest.json. */
  url: string;
  width: number;
  height: number;
  source: string;
  coverage: [number, number];
}

export interface CloudSyncDeps<Img> {
  fetchJson: (url: string) => Promise<unknown>;
  loadImage: (url: string) => Promise<Img>;
}

export type CloudStatus =
  | { state: 'idle' }
  | { state: 'ok'; manifest: CloudManifest; checkedAt: Date }
  | { state: 'error'; message: string; manifest?: CloudManifest };

export function isManifest(v: unknown): v is CloudManifest {
  const m = v as Partial<CloudManifest> | null;
  return !!m && typeof m.t === 'string' && typeof m.url === 'string' && !Number.isNaN(Date.parse(m.t));
}

export class CloudSync<Img> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: CloudManifest | undefined;
  private inFlight: Promise<boolean> | undefined;
  status: CloudStatus = { state: 'idle' };
  /** Wall-clock ms the next scheduled check is due; undefined while stopped. */
  nextCheckAt: number | undefined;

  constructor(
    /** URL of the directory holding latest.json (absolute). */
    private readonly base: string,
    private readonly deps: CloudSyncDeps<Img>,
    private readonly onImage: (image: Img, manifest: CloudManifest) => void,
    private readonly onStatus: (status: CloudStatus) => void = () => {},
    readonly intervalMs = 10 * 60_000,
  ) {}

  get manifestUrl() {
    return new URL('latest.json', this.base).href;
  }

  start() {
    this.stop();
    const tick = async () => {
      await this.check();
      this.timer = setTimeout(tick, this.intervalMs);
      this.nextCheckAt = Date.now() + this.intervalMs;
    };
    void tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextCheckAt = undefined;
  }

  /** Check once; resolves true if a new map was delivered. Concurrent calls share one check. */
  check(): Promise<boolean> {
    this.inFlight ??= this.doCheck().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async doCheck(): Promise<boolean> {
    try {
      const m = await this.deps.fetchJson(this.manifestUrl);
      if (!isManifest(m)) throw new Error('latest.json is not a cloud manifest');
      if (this.current && this.current.t === m.t && this.current.url === m.url) {
        this.setStatus({ state: 'ok', manifest: m, checkedAt: new Date() });
        return false;
      }
      const image = await this.deps.loadImage(new URL(m.url, this.manifestUrl).href);
      this.current = m;
      this.onImage(image, m);
      this.setStatus({ state: 'ok', manifest: m, checkedAt: new Date() });
      return true;
    } catch (err) {
      this.setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err), manifest: this.current });
      return false;
    }
  }

  private setStatus(s: CloudStatus) {
    this.status = s;
    this.onStatus(s);
  }
}
