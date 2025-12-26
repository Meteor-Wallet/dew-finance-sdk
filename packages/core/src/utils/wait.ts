/**
 * Dew Finance SDK - Wait Utility
 * @packageDocumentation
 */

/**
 * Wait utility for async operations
 */
export const Wait = {
  /**
   * Sleep for a specified duration
   * @param ms - Duration in milliseconds
   */
  sleep({ ms }: { ms: number }): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Sleep for a specified number of seconds
   * @param s - Duration in seconds
   */
  seconds({ s }: { s: number }): Promise<void> {
    return Wait.sleep({ ms: s * 1000 });
  },

  /**
   * Sleep for a specified number of minutes
   * @param m - Duration in minutes
   */
  minutes({ m }: { m: number }): Promise<void> {
    return Wait.sleep({ ms: m * 60 * 1000 });
  },

  /**
   * Wait until a specific timestamp
   * @param timestamp - Unix timestamp in milliseconds
   */
  async until({ timestamp }: { timestamp: number }): Promise<void> {
    const now = Date.now();
    if (timestamp <= now) {
      return;
    }
    await Wait.sleep({ ms: timestamp - now });
  },

  /**
   * Wait for a condition to be true
   * @param options - Wait options
   * @returns The truthy value from the condition
   */
  async for<T>({
    condition,
    interval = 1000,
    timeout,
    timeoutMessage,
  }: {
    condition: () => T | Promise<T>;
    interval?: number;
    timeout?: number;
    timeoutMessage?: string;
  }): Promise<T> {
    const startTime = Date.now();

    while (true) {
      const result = await condition();
      if (result) {
        return result;
      }

      if (timeout && Date.now() - startTime >= timeout) {
        throw new Error(timeoutMessage ?? `Wait.for timed out after ${timeout}ms`);
      }

      await Wait.sleep({ ms: interval });
    }
  },

  /**
   * Poll a function until a condition is met
   * @param options - Poll options
   * @returns The final value (optionally transformed)
   */
  async poll<T, R = T>({
    fetch,
    until,
    interval = 1000,
    timeout,
    transform,
    timeoutMessage,
    onPoll,
  }: {
    fetch: () => Promise<T>;
    until: (value: T) => boolean;
    interval?: number;
    timeout?: number;
    transform?: (value: T) => R;
    timeoutMessage?: string;
    onPoll?: (value: T, elapsed: number) => void;
  }): Promise<R> {
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

      await Wait.sleep({ ms: interval });
    }
  },

  /**
   * Wait for a minimum balance to be available
   * @param getBalance - Function to get current balance
   * @param minBalance - Minimum balance required
   * @param options - Additional options
   */
  async forBalance({
    getBalance,
    minBalance,
    interval,
    timeout,
    onPoll,
  }: {
    getBalance: () => Promise<bigint>;
    minBalance: bigint;
    interval?: number;
    timeout?: number;
    onPoll?: (balance: bigint, elapsed: number) => void;
  }): Promise<bigint> {
    return Wait.poll({
      fetch: getBalance,
      until: (balance) => balance >= minBalance,
      interval: interval ?? 5000,
      timeout,
      timeoutMessage: `Balance did not reach ${minBalance} within timeout`,
      onPoll,
    });
  },

  /**
   * Wait for a transaction to be confirmed
   * @param checkConfirmations - Function to get current confirmations
   * @param requiredConfirmations - Number of confirmations required
   * @param options - Additional options
   */
  async forConfirmations({
    checkConfirmations,
    requiredConfirmations,
    interval,
    timeout,
    onPoll,
  }: {
    checkConfirmations: () => Promise<number>;
    requiredConfirmations: number;
    interval?: number;
    timeout?: number;
    onPoll?: (confirmations: number, elapsed: number) => void;
  }): Promise<number> {
    return Wait.poll({
      fetch: checkConfirmations,
      until: (confirmations) => confirmations >= requiredConfirmations,
      interval: interval ?? 3000,
      timeout,
      timeoutMessage: `Transaction did not reach ${requiredConfirmations} confirmations within timeout`,
      onPoll,
    });
  },

  /**
   * Create a timeout promise that rejects after the specified duration
   * @param ms - Timeout duration in milliseconds
   * @param message - Error message
   */
  timeout({ ms, message }: { ms: number; message?: string }): Promise<never> {
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
  withTimeout<T>({
    promise,
    ms,
    message,
  }: {
    promise: Promise<T>;
    ms: number;
    message?: string;
  }): Promise<T> {
    return Promise.race([promise, Wait.timeout({ ms, message })]);
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

/**
 * Convenience wrapper to wait until a predicate becomes true
 */
export async function waitUntil({
  predicate,
  intervalMs = 1000,
  timeoutMs,
  timeoutMessage,
}: {
  predicate: () => boolean | Promise<boolean>;
  intervalMs?: number;
  timeoutMs?: number;
  timeoutMessage?: string;
}): Promise<void> {
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
