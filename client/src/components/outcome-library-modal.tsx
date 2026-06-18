import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Library } from "lucide-react";
import {
  OUTCOME_LIBRARY,
  BLOOMS_LEVELS,
  DISCIPLINES,
  type BloomsLevel,
  type Discipline,
  type LearningOutcome,
} from "@/lib/outcome-library";

const BLOOMS_COLORS: Record<BloomsLevel, string> = {
  Remember: "bg-slate-100 text-slate-700 border-slate-200",
  Understand: "bg-blue-50 text-blue-700 border-blue-200",
  Apply: "bg-green-50 text-green-700 border-green-200",
  Analyze: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Evaluate: "bg-orange-50 text-orange-700 border-orange-200",
  Create: "bg-purple-50 text-purple-700 border-purple-200",
};

interface OutcomeLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onAddOutcomes: (texts: string[]) => void;
}

export function OutcomeLibraryModal({ open, onClose, onAddOutcomes }: OutcomeLibraryModalProps) {
  const [search, setSearch] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");
  const [bloomsFilter, setBloomsFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = () => {
    const texts = OUTCOME_LIBRARY.filter((o) => selected.has(o.id)).map((o) => o.text);
    onAddOutcomes(texts);
    setSelected(new Set());
    setSearch("");
    setDisciplineFilter("all");
    setBloomsFilter("all");
    onClose();
  };

  const handleClose = () => {
    setSelected(new Set());
    setSearch("");
    setDisciplineFilter("all");
    setBloomsFilter("all");
    onClose();
  };

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
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row justify-between gap-3">
          <Button variant="outline" onClick={handleClose} data-testid="button-outcome-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={selected.size === 0}
            data-testid="button-add-outcomes"
          >
            Add {selected.size > 0 ? `${selected.size} selected` : "selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
