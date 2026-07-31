/**
 * Assigns a numeric field only when the provider actually returned a usable number.
 *
 * Adapters deal in mostly-optional fields, and the naive way to write them is to
 * cast the target to `Record<string, unknown>` — which silently stops checking that
 * the key exists on the type, so a typo like `roi` instead of `roic` compiles and
 * then reads as "provider omitted this field" forever.
 *
 * Keying on `K extends keyof T` keeps that check. It also filters NaN and Infinity,
 * which several vendors emit for missing values.
 */
export function setNumber<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: number | null | undefined,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value as T[K];
  }
}
