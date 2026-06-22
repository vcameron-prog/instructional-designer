const DEFAULT_VERSION_HISTORY_LIMIT = 10;

/**
 * Parse the VERSION_HISTORY_LIMIT environment variable.
 *
 * - If the variable is unset/empty, returns the default (10) with no warning.
 * - If the value is non-numeric or <= 0, logs a console.warn and returns the default.
 * - Otherwise returns the parsed positive integer.
 */
export function parseVersionHistoryLimit(
  envValue: string | undefined,
  warn: (msg: string) => void = console.warn,
): number {
  const parsed = parseInt(envValue ?? "", 10);
  if (isNaN(parsed) || parsed <= 0) {
    if (envValue !== undefined) {
      warn(
        `[config] VERSION_HISTORY_LIMIT="${envValue}" is invalid (must be a positive integer). Falling back to default of ${DEFAULT_VERSION_HISTORY_LIMIT}.`,
      );
    }
    return DEFAULT_VERSION_HISTORY_LIMIT;
  }
  return parsed;
}
