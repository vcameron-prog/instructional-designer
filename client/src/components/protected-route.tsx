import { useRequireAuth } from "@/hooks/use-require-auth";
import { LoadingScreen } from "@/components/loading-screen";

interface ProtectedRouteProps {
  component: React.ComponentType;
}

/**
 * Wraps a page component so that unauthenticated users are redirected to the
 * login page before any protected queries fire.  While the auth check is
 * in-flight it renders a loading screen instead of the page, preventing a
 * flash of restricted content.
 */
export function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated } = useRequireAuth();

  if (isLoading || !isAuthenticated) {
    return <LoadingScreen message="Checking sign-in status…" />;
  }

  return <Component />;
}
