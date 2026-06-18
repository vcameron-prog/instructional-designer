import { useState, useEffect, useCallback } from "react";

export interface ToolPreset {
  name: string;
  values: Record<string, any>;
  savedAt: string;
}

const storageKey = (toolId: string) => `bsu-tool-presets-${toolId}`;

function loadPresets(toolId: string): ToolPreset[] {
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

function persistPresets(toolId: string, presets: ToolPreset[]) {
  try {
    localStorage.setItem(storageKey(toolId), JSON.stringify(presets));
  } catch {
  }
}

export function useToolPresets(toolId: string | undefined) {
  const [presets, setPresets] = useState<ToolPreset[]>(() =>
    toolId ? loadPresets(toolId) : []
  );

  useEffect(() => {
    if (toolId) {
      setPresets(loadPresets(toolId));
    } else {
      setPresets([]);
    }
  }, [toolId]);

  const savePreset = useCallback(
    (name: string, values: Record<string, any>) => {
      if (!toolId) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      setPresets((prev) => {
        const filtered = prev.filter((p) => p.name !== trimmed);
        const next: ToolPreset[] = [
          ...filtered,
          { name: trimmed, values, savedAt: new Date().toISOString() },
        ];
        persistPresets(toolId, next);
        return next;
      });
    },
    [toolId]
  );

  const deletePreset = useCallback(
    (name: string) => {
      if (!toolId) return;
      setPresets((prev) => {
        const next = prev.filter((p) => p.name !== name);
        persistPresets(toolId, next);
        return next;
      });
    },
    [toolId]
  );

  return { presets, savePreset, deletePreset };
}
