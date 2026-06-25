/**
 * Updates the browser URL query string without triggering navigation.
 * Always derives the base path from window.location.pathname, so no
 * hard-coded route string can drift out of sync with the router.
 *
 * @param params - URLSearchParams or a plain key/value record to serialize.
 *                 Pass an empty URLSearchParams (or {}) to strip all params.
 */
export function pushFilterState(
  params: URLSearchParams | Record<string, string>
): void {
  const searchParams =
    params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const qs = searchParams.toString();
  const newUrl = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}
