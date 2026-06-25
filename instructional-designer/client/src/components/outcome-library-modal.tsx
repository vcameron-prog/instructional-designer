import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Library, Bookmark, BookmarkCheck, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  OUTCOME_LIBRARY,
  BLOOMS_LEVELS,
  DISCIPLINES,
  type BloomsLevel,
  type Discipline,
  type LearningOutcome,
} from "@/lib/outcome-library";
import type { SavedOutcome } from "@shared/schema";

const BLOOMS_COLORS: Record<BloomsLevel, string> = {
  Remember: "bg-slate-100 text-slate-700 border-slate-200",
  Understand: "bg-blue-50 text-blue-700 border-blue-200",
  Apply: "bg-green-50 text-green-700 border-green-200",
  Analyze: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Evaluate: "bg-orange-50 text-orange-700 border-orange-200",
  Create: "bg-purple-50 text-purple-700 border-purple-200",
};

type Tab = "library" | "my-outcomes";

interface OutcomeLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onAddOutcomes: (texts: string[]) => void;
}

export function OutcomeLibraryModal({ open, onClose, onAddOutcomes }: OutcomeLibraryModalProps) {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [search, setSearch] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");
  const [bloomsFilter, setBloomsFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedMine, setSelectedMine] = useState<Set<number>>(new Set());
  const [customText, setCustomText] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const { data: savedOutcomes = [], isLoading: isLoadingMine } = useQuery<SavedOutcome[]>({
    queryKey: ["/api/outcomes"],
    enabled: open && isAuthenticated,
  });

  const savedIds = useMemo(
    () => new Set(savedOutcomes.map((o) => o.text)),
    [savedOutcomes],
  );

  useEffect(() => {
    if (editingId === null) return;
    const stillExists = savedOutcomes.some((o) => o.id === editingId);
    if (!stillExists) {
      setEditingId(null);
      setEditingText("");
      toast({ title: "Outcome was already removed", description: "It has been removed from your list." });
    }
  }, [savedOutcomes, editingId]);

  const saveOutcomeMutation = useMutation({
    mutationFn: (text: string) => apiRequest("POST", "/api/outcomes", { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
    },
    onError: () => {
      toast({ title: "Could not save outcome", variant: "destructive" });
    },
  });

  const deleteOutcomeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outcomes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setSelectedMine((prev) => {
        const next = new Set(prev);
        return next;
      });
    },
    onError: (error: unknown, id: number) => {
      const is404 = error instanceof Error && error.message.startsWith("404:");
      if (is404) {
        queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
        setSelectedMine((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast({ title: "Outcome was already removed", description: "It has been removed from your list." });
      } else {
        toast({ title: "Could not delete outcome", variant: "destructive" });
      }
    },
  });

  const updateOutcomeMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) =>
      apiRequest("PATCH", `/api/outcomes/${id}`, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setEditingId(null);
      setEditingText("");
    },
    onError: (error: any) => {
      const isDuplicate = error?.message?.startsWith("409:");
      const isGone = error?.message?.startsWith("404:");
      if (isGone) {
        queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
        setEditingId(null);
        setEditingText("");
        toast({ title: "Outcome was already removed", description: "It has been removed from your list." });
      } else if (isDuplicate) {
        toast({ title: "That outcome already exists in your collection.", variant: "destructive" });
      } else {
        toast({ title: "Could not update outcome", variant: "destructive" });
      }
    },
  });

  const startEditing = (outcome: SavedOutcome) => {
    setEditingId(outcome.id);
    setEditingText(outcome.text);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingText("");
  };

  const commitEdit = (id: number) => {
    const text = editingText.trim();
    if (!text) return;
    updateOutcomeMutation.mutate({ id, text });
  };

  const filtered = useMemo<LearningOutcome[]>(() => {
    const q = search.toLowerCase().trim();
    return OUTCOME_LIBRARY.filter((o) => {
      if (disciplineFilter !== "all" && o.discipline !== disciplineFilter) return false;
      if (bloomsFilter !== "all" && o.bloomsLevel !== bloomsFilter) return false;
      if (q && !o.text.toLowerCase().includes(q) && !o.discipline.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, disciplineFilter, bloomsFilter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMine = (id: number) => {
    setSelectedMine((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveToMine = (text: string) => {
    if (savedIds.has(text)) return;
    saveOutcomeMutation.mutate(text);
  };

  const handleDeleteMine = (id: number) => {
    setSelectedMine((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    deleteOutcomeMutation.mutate(id);
  };

  const handleAddCustom = () => {
    const text = customText.trim();
    if (!text) return;
    saveOutcomeMutation.mutate(text, {
      onSuccess: () => {
        setCustomText("");
        toast({ title: "Outcome saved to My Outcomes" });
      },
    });
  };

  const handleAdd = () => {
    const libraryTexts = OUTCOME_LIBRARY.filter((o) => selected.has(o.id)).map((o) => o.text);
    const mineTexts = savedOutcomes.filter((o) => selectedMine.has(o.id)).map((o) => o.text);
    const all = [...libraryTexts, ...mineTexts];
    if (all.length === 0) return;
    onAddOutcomes(all);
    reset();
    onClose();
  };

  const reset = () => {
    setSelected(new Set());
    setSelectedMine(new Set());
    setSearch("");
    setDisciplineFilter("all");
    setBloomsFilter("all");
    setCustomText("");
    setEditingId(null);
    setEditingText("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const totalSelected = selected.size + selectedMine.size;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl w-full flex flex-col gap-0 p-0 overflow-hidden max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Library className="w-5 h-5 text-primary" aria-hidden="true" />
            <DialogTitle>Learning Outcome Library</DialogTitle>
          </div>
          <DialogDescription>
            Browse and select pre-written, discipline-specific outcomes organized by Bloom's taxonomy level. Selected outcomes will be appended to your Learning Outcomes field.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b shrink-0" role="tablist" aria-label="Outcome library tabs">
          <button
            role="tab"
            aria-selected={activeTab === "library"}
            data-testid="tab-library"
            onClick={() => setActiveTab("library")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
              activeTab === "library"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Library
          </button>
          {isAuthenticated && (
            <button
              role="tab"
              aria-selected={activeTab === "my-outcomes"}
              data-testid="tab-my-outcomes"
              onClick={() => setActiveTab("my-outcomes")}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
                activeTab === "my-outcomes"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              My Outcomes
              {savedOutcomes.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs px-1.5 py-0 min-w-[1.25rem]">
                  {savedOutcomes.length}
                </span>
              )}
            </button>
          )}
        </div>

        {activeTab === "library" && (
          <>
            <div className="px-6 py-4 space-y-3 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Search outcomes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-outcome-search"
                />
              </div>
              <div className="flex gap-3 flex-wrap">
                <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
                  <SelectTrigger className="w-44" data-testid="select-outcome-discipline">
                    <SelectValue placeholder="All disciplines" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All disciplines</SelectItem>
                    {DISCIPLINES.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={bloomsFilter} onValueChange={setBloomsFilter}>
                  <SelectTrigger className="w-44" data-testid="select-outcome-blooms">
                    <SelectValue placeholder="All Bloom's levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Bloom's levels</SelectItem>
                    {BLOOMS_LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(disciplineFilter !== "all" || bloomsFilter !== "all" || search) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDisciplineFilter("all"); setBloomsFilter("all"); setSearch(""); }}
                    data-testid="button-clear-filters"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {filtered.length} outcome{filtered.length !== 1 ? "s" : ""} shown
                {selected.size > 0 && <> · <span className="font-medium text-primary">{selected.size} selected</span></>}
              </p>
            </div>

            <ScrollArea className="flex-1 min-h-0 px-6 py-3">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No outcomes match your filters. Try adjusting the search or filters.
                </p>
              ) : (
                <ul className="space-y-2" role="list" aria-label="Learning outcomes">
                  {filtered.map((outcome) => {
                    const isChecked = selected.has(outcome.id);
                    const isSaved = savedIds.has(outcome.text);
                    return (
                      <li key={outcome.id}>
                        <label
                          htmlFor={`outcome-${outcome.id}`}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            isChecked
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background hover:bg-muted/50"
                          }`}
                          data-testid={`outcome-row-${outcome.id}`}
                        >
                          <Checkbox
                            id={`outcome-${outcome.id}`}
                            checked={isChecked}
                            onCheckedChange={() => toggle(outcome.id)}
                            className="mt-0.5 shrink-0"
                            data-testid={`checkbox-outcome-${outcome.id}`}
                            aria-label={outcome.text}
                          />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="text-sm leading-snug">{outcome.text}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge
                                variant="outline"
                                className={`text-xs px-1.5 py-0 ${BLOOMS_COLORS[outcome.bloomsLevel]}`}
                              >
                                {outcome.bloomsLevel}
                              </Badge>
                              <Badge variant="outline" className="text-xs px-1.5 py-0 bg-card">
                                {outcome.discipline}
                              </Badge>
                            </div>
                          </div>
                          {isAuthenticated && (
                            <button
                              type="button"
                              aria-label={isSaved ? "Already saved to My Outcomes" : "Save to My Outcomes"}
                              title={isSaved ? "Already saved to My Outcomes" : "Save to My Outcomes"}
                              data-testid={`button-save-outcome-${outcome.id}`}
                              disabled={isSaved || saveOutcomeMutation.isPending}
                              onClick={(e) => { e.preventDefault(); handleSaveToMine(outcome.text); }}
                              className={`shrink-0 p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                isSaved
                                  ? "text-primary cursor-default"
                                  : "text-muted-foreground hover:text-primary"
                              }`}
                            >
                              {isSaved ? (
                                <BookmarkCheck className="w-4 h-4" />
                              ) : (
                                <Bookmark className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </>
        )}

        {activeTab === "my-outcomes" && isAuthenticated && (
          <>
            <div className="px-6 py-4 space-y-3 border-b shrink-0">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a custom outcome and save it..."
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); }}
                  data-testid="input-custom-outcome"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddCustom}
                  disabled={!customText.trim() || saveOutcomeMutation.isPending}
                  data-testid="button-save-custom-outcome"
                  aria-label="Save custom outcome"
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {savedOutcomes.length} saved outcome{savedOutcomes.length !== 1 ? "s" : ""}
                {selectedMine.size > 0 && <> · <span className="font-medium text-primary">{selectedMine.size} selected</span></>}
              </p>
            </div>

            <ScrollArea className="flex-1 min-h-0 px-6 py-3">
              {isLoadingMine ? (
                <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
              ) : savedOutcomes.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <Bookmark className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-sm font-medium">No saved outcomes yet</p>
                  <p className="text-xs text-muted-foreground">
                    Bookmark outcomes from the Library tab or type a custom one above.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2" role="list" aria-label="My saved outcomes">
                  {savedOutcomes.map((outcome) => {
                    const isChecked = selectedMine.has(outcome.id);
                    const isEditing = editingId === outcome.id;
                    return (
                      <li key={outcome.id}>
                        <div
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            isChecked
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background"
                          }`}
                          data-testid={`my-outcome-row-${outcome.id}`}
                        >
                          <Checkbox
                            id={`my-outcome-${outcome.id}`}
                            checked={isChecked}
                            onCheckedChange={() => { if (!isEditing) toggleMine(outcome.id); }}
                            className="mt-0.5 shrink-0"
                            data-testid={`checkbox-my-outcome-${outcome.id}`}
                            aria-label={outcome.text}
                            disabled={isEditing}
                          />
                          {isEditing ? (
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <Input
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEdit(outcome.id);
                                  if (e.key === "Escape") cancelEditing();
                                }}
                                autoFocus
                                className="h-7 text-sm py-1"
                                data-testid={`input-edit-outcome-${outcome.id}`}
                                aria-label="Edit outcome text"
                              />
                              <button
                                type="button"
                                aria-label="Save edit"
                                title="Save"
                                data-testid={`button-save-edit-outcome-${outcome.id}`}
                                onClick={() => commitEdit(outcome.id)}
                                disabled={!editingText.trim() || updateOutcomeMutation.isPending}
                                className="shrink-0 p-1 rounded text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                aria-label="Cancel edit"
                                title="Cancel"
                                data-testid={`button-cancel-edit-outcome-${outcome.id}`}
                                onClick={cancelEditing}
                                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <label
                                htmlFor={`my-outcome-${outcome.id}`}
                                className="flex-1 min-w-0 text-sm leading-snug cursor-pointer"
                              >
                                {outcome.text}
                              </label>
                              <button
                                type="button"
                                aria-label="Edit this outcome"
                                title="Edit"
                                data-testid={`button-edit-outcome-${outcome.id}`}
                                onClick={() => startEditing(outcome)}
                                disabled={deleteOutcomeMutation.isPending}
                                className="shrink-0 p-1 rounded text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete this outcome"
                                title="Delete"
                                data-testid={`button-delete-outcome-${outcome.id}`}
                                onClick={() => handleDeleteMine(outcome.id)}
                                disabled={deleteOutcomeMutation.isPending}
                                className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </>
        )}

        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row justify-between gap-3">
          <Button variant="outline" onClick={handleClose} data-testid="button-outcome-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={totalSelected === 0}
            data-testid="button-add-outcomes"
          >
            Add {totalSelected > 0 ? `${totalSelected} selected` : "selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
