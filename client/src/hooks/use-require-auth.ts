import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { buildLoginRedirectUrl } from "@/lib/auth-utils";

/**
 * Redirects unauthenticated users to the login page, preserving the current
 * path and query string as the post-login return destination.
 *
 * Call this hook at the top of any page component that requires authentication.
 * While auth is loading, or once a redirect has been issued, the caller should
 * render nothing (or a loading indicator) to avoid flashing restricted content.
 *
 * @returns `{ isLoading, isAuthenticated }` — isLoading is true while the
 *   auth check is in-flight; isAuthenticated reflects the resolved state.
 */
export function useRequireAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      const search = window.location.search;
      window.location.href = buildLoginRedirectUrl(location, search);
    }
  }, [isLoading, isAuthenticated, location]);

  return { isLoading, isAuthenticated };
}
