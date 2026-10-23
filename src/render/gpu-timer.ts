/**
 * GPU frame timing with EXT_disjoint_timer_query_webgl2. Results arrive a few frames
 * late, so queries are kept in a small queue and polled. Firefox and some drivers don't
 * expose the extension; `supported` is false there and callers fall back to CPU timing.
 */

interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  readonly supported: boolean;
  /** Most recent GPU time for one timed span, milliseconds. */
  lastMs: number | undefined;
  private readonly ext: TimerQueryExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | undefined;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    this.supported = this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = undefined;
  }

  /** Collects finished queries; call once per frame. */
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const query = this.pending[0] as WebGLQuery;
      if (!(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      this.pending.shift();
      if (!disjoint) {
        this.lastMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
      }
      gl.deleteQuery(query);
    }
  }
}
