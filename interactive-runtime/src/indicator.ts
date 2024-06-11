export type IndicatorStatus = {
  running: boolean;
  busy: boolean;
  destroyed: boolean;
}

export type IndicatorCallbacks = {
  busyCallback: () => void;
  idleCallback: () => void;
  runningCallback: () => void;
  finishedCallback: () => void;
}

interface IndicatorInterface {
  running: () => void;
  finished: () => void;
  destroy: () => void;
  status: () => IndicatorStatus;
}

const indicatorRegistry: Indicator[] = [];

export class Indicator implements IndicatorInterface {
  isRunning: boolean = false;
  isDestroyed: boolean = false;
  callbacks?: IndicatorCallbacks;

  constructor(callbacks?: IndicatorCallbacks) {
    indicatorRegistry.push(this);
    if (callbacks) {
      this.callbacks = callbacks;
    } else {
      this.callbacks = {
        busyCallback: () => {},
        idleCallback: () => {},
        runningCallback: () => {},
        finishedCallback: () => {},
      }
    }
  }

  running() {
    this.isRunning = true;
    indicatorRegistry.forEach((ind) => ind.callbacks.busyCallback());
    this.callbacks.runningCallback();
  }

  finished() {
    this.isRunning = false;
    this.callbacks.finishedCallback();
    // If we're now idle, send idle signal
    if (!this.status().busy) {
      indicatorRegistry.forEach((ind) => ind.callbacks.idleCallback());
    }
  }

  status() {
    const running = this.isRunning;
    const destroyed = this.isDestroyed;
    const busy = indicatorRegistry.some((ind) => ind.isRunning);
    return { running, busy, destroyed };
  }

  destroy() {
    this.isDestroyed = true;
    const idx = indicatorRegistry.indexOf(this);
    indicatorRegistry.splice(idx, 1);
  }
}

