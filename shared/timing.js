// Per-request timing, the counterpart of the Quarkus TimingContext: named steps in ms.
export class Timing {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.start = now();
    this.steps = {};
  }

  async step(name, fn) {
    const t = this.now();
    try {
      return await fn();
    } finally {
      this.steps[name] = (this.steps[name] ?? 0) + Math.round(this.now() - t);
    }
  }

  total() {
    return Math.round(this.now() - this.start);
  }

  details() {
    return { ...this.steps, total: this.total() };
  }

  // A copy of the response that carries this request's timing: x-time-ms and x-timing-details.
  stamp(response) {
    const headers = new Headers(response.headers);
    headers.set("x-time-ms", String(this.total()));
    headers.set("x-timing-details", JSON.stringify(this.details()));
    return new Response(response.body, { status: response.status, headers });
  }
}
