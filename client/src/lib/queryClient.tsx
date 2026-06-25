import { QueryClient, QueryFunction, MutationCache, QueryCache } from "@tanstack/react-query";
import { SESSION_EXPIRED_MESSAGE, isSessionExpiredMessage } from "./upload-error-utils";
import { buildLoginRedirectUrl } from "./auth-utils";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    if (res.status === 401 || res.status === 403 || text.trimStart().startsWith("<")) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

function showSessionExpiredToast() {
  toast({
    title: "Session expired",
    description: SESSION_EXPIRED_MESSAGE,
    variant: "destructive",
    duration: Infinity,
    action: (
      <ToastAction
        altText="Sign in again"
        onClick={() => {
          window.location.href = buildLoginRedirectUrl(
            window.location.pathname,
            window.location.search,
          );
        }}
      >
        Sign in again
      </ToastAction>
    ),
  });
}

function handleGlobalError(error: unknown) {
  if (error instanceof Error && isSessionExpiredMessage(error.message)) {
    showSessionExpiredToast();
  }
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: handleGlobalError,
  }),
  queryCache: new QueryCache({
    onError: handleGlobalError,
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
