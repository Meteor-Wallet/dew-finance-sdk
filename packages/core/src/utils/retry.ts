import { Wait } from "./wait";

export async function retry<T>(fn: () => Promise<T>, { times = 5, interval = 1000 } = {}) {
  try {
    return await fn();
  } catch (error) {
    if (times > 0) {
      await Wait.sleep({ms: interval});
      console.log(`Retrying... attempts remaining: ${times - 1}`);
      return retry(fn, { times: times - 1, interval });
    }
    throw error; // Re-throw the last error if no retries are left
  }
}