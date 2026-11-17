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
}
