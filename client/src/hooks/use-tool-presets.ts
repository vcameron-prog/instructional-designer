import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export interface ToolPreset {
  name: string;
  values: Record<string, any>;
  savedAt: string;
}

export interface ToolPresetEntry {
  toolId: string;
  preset: ToolPreset;
}

const storageKey = (toolId: string) => `bsu-tool-presets-${toolId}`;

function loadLocalPresets(toolId: string): ToolPreset[] {
  try {
    const raw = localStorage.getItem(storageKey(toolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ToolPreset[];
    return [];
  } catch {
    return [];
  }
}

function persistLocalPresets(toolId: string, presets: ToolPreset[]) {
  try {
    localStorage.setItem(storageKey(toolId), JSON.stringify(presets));
  } catch {}
}

export function useToolPresets(toolId: string | undefined) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const serverQuery = useQuery<ToolPreset[]>({
    queryKey: ["/api/presets", toolId],
    enabled: !!toolId && isAuthenticated && !authLoading,
  });

  const serverMutation = useMutation({
    mutationFn: async (presets: ToolPreset[]) => {
      const res = await apiRequest("PUT", `/api/presets/${toolId}`, presets);
      return res.json() as Promise<ToolPreset[]>;
    },
  });

  const [localPresets, setLocalPresets] = useState<ToolPreset[]>([]);

  useEffect(() => {
    if (!toolId || isAuthenticated || authLoading) return;
    setLocalPresets(loadLocalPresets(toolId));
  }, [toolId, isAuthenticated, authLoading]);

  const presets: ToolPreset[] = isAuthenticated
    ? (serverQuery.data ?? [])
    : localPresets;

  const savePreset = useCallback(
    (name: string, values: Record<string, any>) => {
      if (!toolId) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      if (isAuthenticated) {
        const current = queryClient.getQueryData<ToolPreset[]>(["/api/presets", toolId]) ?? [];
        const filtered = current.filter((p) => p.name !== trimmed);
        const next: ToolPreset[] = [
          ...filtered,
          { name: trimmed, values, savedAt: new Date().toISOString() },
        ];
        queryClient.setQueryData(["/api/presets", toolId], next);
        serverMutation.mutate(next);
      } else {
        setLocalPresets((prev) => {
          const filtered = prev.filter((p) => p.name !== trimmed);
          const next: ToolPreset[] = [
            ...filtered,
            { name: trimmed, values, savedAt: new Date().toISOString() },
          ];
          persistLocalPresets(toolId, next);
          return next;
        });
      }
    },
    [toolId, isAuthenticated, queryClient, serverMutation]
  );

  const deletePreset = useCallback(
    (name: string) => {
      if (!toolId) return;

      if (isAuthenticated) {
        const current = queryClient.getQueryData<ToolPreset[]>(["/api/presets", toolId]) ?? [];
        const next = current.filter((p) => p.name !== name);
        queryClient.setQueryData(["/api/presets", toolId], next);
        serverMutation.mutate(next);
      } else {
        setLocalPresets((prev) => {
          const next = prev.filter((p) => p.name !== name);
          persistLocalPresets(toolId, next);
          return next;
        });
      }
    },
    [toolId, isAuthenticated, queryClient, serverMutation]
  );

  return { presets, savePreset, deletePreset };
}

export function useAllToolPresets(toolIds: string[]) {
  const buildEntries = useCallback((): ToolPresetEntry[] => {
    const entries: ToolPresetEntry[] = [];
    for (const toolId of toolIds) {
      for (const preset of loadPresets(toolId)) {
        entries.push({ toolId, preset });
      }
    }
    return entries;
  }, [toolIds.join(",")]);

  const [entries, setEntries] = useState<ToolPresetEntry[]>(buildEntries);

  const refresh = useCallback(() => {
    setEntries(buildEntries());
  }, [buildEntries]);

  const deleteEntry = useCallback((toolId: string, presetName: string) => {
    const updated = loadPresets(toolId).filter((p) => p.name !== presetName);
    persistPresets(toolId, updated);
    setEntries((prev) =>
      prev.filter((e) => !(e.toolId === toolId && e.preset.name === presetName))
    );
  }, []);

  return { entries, refresh, deleteEntry };
}

export const PRESET_PREFILL_KEY = "bsu-preset-prefill";
