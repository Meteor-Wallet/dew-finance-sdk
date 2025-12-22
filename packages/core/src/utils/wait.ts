/**
 * Dew Finance SDK - Wait Utility
 * @packageDocumentation
 */

/** Options for Wait.for */
export interface WaitForOptions<T> {
  /** Condition function that returns true when waiting should stop */
  condition: () => T | Promise<T>;
  /** Polling interval in milliseconds */
  interval?: number;
  /** Maximum time to wait in milliseconds */
  timeout?: number;
  /** Optional message for timeout error */
  timeoutMessage?: string;
}

/** Options for Wait.poll */
export interface WaitPollOptions<T, R = T> {
  /** Function to fetch the latest state */
  fetch: () => Promise<T>;
  /** Condition to check if we should stop polling */
  until: (value: T) => boolean;
  /** Polling interval in milliseconds */
  interval?: number;
  /** Maximum time to wait in milliseconds */
  timeout?: number;
  /** Optional transform function for the result */
  transform?: (value: T) => R;
  /** Optional message for timeout error */
  timeoutMessage?: string;
  /** Callback on each poll iteration */
  onPoll?: (value: T, elapsed: number) => void;
}

/**
 * Wait utility for async operations
 */
export const Wait = {
  /**
   * Sleep for a specified duration
   * @param ms - Duration in milliseconds
   */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Sleep for a specified number of seconds
   * @param s - Duration in seconds
   */
  seconds(s: number): Promise<void> {
    return Wait.sleep(s * 1000);
  },

  /**
   * Sleep for a specified number of minutes
   * @param m - Duration in minutes
   */
  minutes(m: number): Promise<void> {
    return Wait.sleep(m * 60 * 1000);
  },

  /**
   * Wait until a specific timestamp
   * @param timestamp - Unix timestamp in milliseconds
   */
  async until(timestamp: number): Promise<void> {
    const now = Date.now();
    if (timestamp <= now) {
      return;
    }
    await Wait.sleep(timestamp - now);
  },

  /**
   * Wait for a condition to be true
   * @param options - Wait options
   * @returns The truthy value from the condition
   */
  async for<T>(options: WaitForOptions<T>): Promise<T> {
    const { condition, interval = 1000, timeout, timeoutMessage } = options;
    const startTime = Date.now();

    while (true) {
      const result = await condition();
      if (result) {
        return result;
      }

      if (timeout && Date.now() - startTime >= timeout) {
        throw new Error(timeoutMessage ?? `Wait.for timed out after ${timeout}ms`);
      }

      await Wait.sleep(interval);
    }
  },

  /**
   * Poll a function until a condition is met
   * @param options - Poll options
   * @returns The final value (optionally transformed)
   */
  async poll<T, R = T>(options: WaitPollOptions<T, R>): Promise<R> {
    const { fetch, until, interval = 1000, timeout, transform, timeoutMessage, onPoll } = options;
    const startTime = Date.now();

    while (true) {
      const value = await fetch();
      const elapsed = Date.now() - startTime;

      if (onPoll) {
        onPoll(value, elapsed);
      }

      if (until(value)) {
        return transform ? transform(value) : (value as unknown as R);
      }

      if (timeout && elapsed >= timeout) {
        throw new Error(timeoutMessage ?? `Wait.poll timed out after ${timeout}ms`);
      }

      await Wait.sleep(interval);
    }
  },

  /**
   * Wait for a minimum balance to be available
   * @param getBalance - Function to get current balance
   * @param minBalance - Minimum balance required
   * @param options - Additional options
   */
  async forBalance(
    getBalance: () => Promise<bigint>,
    minBalance: bigint,
    options: {
      interval?: number;
      timeout?: number;
      onPoll?: (balance: bigint, elapsed: number) => void;
    } = {}
  ): Promise<bigint> {
    return Wait.poll({
      fetch: getBalance,
      until: (balance) => balance >= minBalance,
      interval: options.interval ?? 5000,
      timeout: options.timeout,
      timeoutMessage: `Balance did not reach ${minBalance} within timeout`,
      onPoll: options.onPoll,
    });
  },

  /**
   * Wait for a transaction to be confirmed
   * @param checkConfirmations - Function to get current confirmations
   * @param requiredConfirmations - Number of confirmations required
   * @param options - Additional options
   */
  async forConfirmations(
    checkConfirmations: () => Promise<number>,
    requiredConfirmations: number,
    options: {
      interval?: number;
      timeout?: number;
      onPoll?: (confirmations: number, elapsed: number) => void;
    } = {}
  ): Promise<number> {
    return Wait.poll({
      fetch: checkConfirmations,
      until: (confirmations) => confirmations >= requiredConfirmations,
      interval: options.interval ?? 3000,
      timeout: options.timeout,
      timeoutMessage: `Transaction did not reach ${requiredConfirmations} confirmations within timeout`,
      onPoll: options.onPoll,
    });
  },

  /**
   * Create a timeout promise that rejects after the specified duration
   * @param ms - Timeout duration in milliseconds
   * @param message - Error message
   */
  timeout(ms: number, message?: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(message ?? `Operation timed out after ${ms}ms`));
      }, ms);
    });
  },

  /**
   * Race a promise against a timeout
   * @param promise - The promise to race
   * @param ms - Timeout duration in milliseconds
   * @param message - Error message on timeout
   */
  withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
    return Promise.race([promise, Wait.timeout(ms, message)]);
  },
};

/**
 * Shorthand for Wait.sleep
 */
export const sleep = Wait.sleep;

/**
 * Shorthand for Wait.seconds
 */
export const seconds = Wait.seconds;

/**
 * Shorthand for Wait.minutes
 */
export const minutes = Wait.minutes;

/** Options for waitUntil helper */
export interface WaitUntilOptions {
  /** Polling interval in milliseconds */
  intervalMs?: number;
  /** Maximum time to wait in milliseconds */
  timeoutMs?: number;
  /** Optional message for timeout error */
  timeoutMessage?: string;
}

/**
 * Convenience wrapper to wait until a predicate becomes true
 */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: WaitUntilOptions = {}
): Promise<void> {
  const { intervalMs = 1000, timeoutMs, timeoutMessage } = options;

  await Wait.for({
    condition: async () => {
      const result = await predicate();
      return Boolean(result);
    },
    interval: intervalMs,
    timeout: timeoutMs,
    timeoutMessage,
  });
}
