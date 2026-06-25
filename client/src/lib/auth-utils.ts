export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

/**
 * Build the /api/login URL that sends the user back to the page they were on
 * after a successful sign-in. Accepts the path and query string separately so
 * the function can be tested without touching window.location.
 *
 * Hash fragments are intentionally excluded: the server never receives them, so
 * including them in returnTo would produce a URL the server cannot round-trip
 * correctly.
 */
export function buildLoginRedirectUrl(pathname: string, search: string): string {
  const returnTo = pathname + search;
  return `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
}

// Redirect to login with a toast notification
export function redirectToLogin(toast?: (options: { title: string; description: string; variant: string }) => void) {
  if (toast) {
    toast({
      title: "Unauthorized",
      description: "You are logged out. Logging in again...",
      variant: "destructive",
    });
  }
  setTimeout(() => {
    window.location.href = buildLoginRedirectUrl(
      window.location.pathname,
      window.location.search,
    );
  }, 500);
}
