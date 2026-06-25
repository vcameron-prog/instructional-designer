import { useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type { UseMutationOptions, UseMutationResult } from "@tanstack/react-query";

/**
 * Wraps useMutation with a leading-edge cooldown guard so that rapid successive
 * clicks cannot fire the same mutation twice.  During the cooldown window (default
 * 500 ms) any extra calls to `mutate` are silently dropped.  The guard also
 * short-circuits while the previous request is still in-flight (`isPending`).
 *
 * The returned object is a standard UseMutationResult — callers swap
 * `useMutation` for `useDebouncedMutation` and everything else stays the same.
 */
export function useDebouncedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
  cooldownMs = 500,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const cooldownRef = useRef(false);
  const mutation = useMutation(options);

  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const isPendingRef = useRef(mutation.isPending);
  isPendingRef.current = mutation.isPending;

  const debouncedMutate: typeof mutation.mutate = useCallback(
    (...args) => {
      if (cooldownRef.current || isPendingRef.current) return;
      cooldownRef.current = true;
      setTimeout(() => {
        cooldownRef.current = false;
      }, cooldownMs);
      mutateRef.current(...args);
    },
    [cooldownMs],
  );

  return { ...mutation, mutate: debouncedMutate };
}
