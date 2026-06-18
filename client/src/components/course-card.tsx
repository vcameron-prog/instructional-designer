import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  BookOpen,
  Calendar,
  Layout,
  CheckCircle,
  Sparkles,
  Target,
  Trash2,
  Copy,
  CalendarPlus,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { TOOLS, SEMESTER_TYPES, getSemesterYears, getNextSemester, buildSemesterString } from "@/lib/constants";
import type { Course, GeneratedContent } from "@shared/schema";

const toolIconMap: Record<string, any> = {
  syllabus: BookOpen,
  schedule: Calendar,
  assignment: FileText,
  module: Layout,
  rubric: CheckCircle,
  aipolicy: Sparkles,
  alignment: Target,
};

export function CourseCard({
  course,
  onNavigate,
  onDuplicate,
  onDelete,
  onRollover,
  isDuplicating,
  isRollingOver,
}: {
  course: Course;
  onNavigate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRollover: (semester: string, contentIds: number[]) => void;
  isDuplicating: boolean;
  isRollingOver?: boolean;
}) {
  const { data: contents = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", course.id, "content"],
  });

  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [rolloverStep, setRolloverStep] = useState<1 | 2>(1);
  const [semesterType, setSemesterType] = useState<string>(() => {
    const next = getNextSemester(course.semester);
    return next.type || SEMESTER_TYPES[0];
  });
  const [semesterYear, setSemesterYear] = useState<number>(() => {
    return getNextSemester(course.semester).year;
  });
  const [selectedContentIds, setSelectedContentIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (rolloverOpen) {
      const next = getNextSemester(course.semester);
      setSemesterType(next.type || SEMESTER_TYPES[0]);
      setSemesterYear(next.year);
      setRolloverStep(1);
      setSelectedContentIds(new Set());
    }
  }, [rolloverOpen, course.semester]);

  const years = getSemesterYears();

  const toolsGenerated = new Set(contents.map(c => c.toolType));
  const isSample = course.courseName.includes("[SAMPLE]");

  const sortedContents = [...contents].sort((a, b) => {
    if (a.isApproved && !b.isApproved) return -1;
    if (!a.isApproved && b.isApproved) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function toggleContentId(id: number) {
    setSelectedContentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleRolloverConfirm() {
    const semester = buildSemesterString(semesterType, semesterYear);
    onRollover(semester, Array.from(selectedContentIds));
    setRolloverOpen(false);
  }

  return (
    <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <button
          className="flex-1 text-left"
          onClick={onNavigate}
          data-testid={`button-course-${course.id}`}
        >
          <p className="font-semibold text-foreground">
            {course.courseName}
            {isSample && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">(Example)</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {course.courseNumber}{course.sectionNumber ? ` §${course.sectionNumber}` : ""} • {course.semester}
          </p>
          {toolsGenerated.size > 0 && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-muted-foreground mr-1">Created:</span>
              {TOOLS.filter(t => toolsGenerated.has(t.id)).slice(0, 4).map(tool => {
                const Icon = toolIconMap[tool.id] || FileText;
                return (
                  <Tooltip key={tool.id}>
                    <TooltipTrigger asChild>
                      <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center">
                        <Icon className="w-3 h-3 text-primary" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{tool.name}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {toolsGenerated.size > 4 && (
                <span className="text-xs text-muted-foreground">+{toolsGenerated.size - 4} more</span>
              )}
            </div>
          )}
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); setRolloverOpen(true); }}
                disabled={isRollingOver}
                aria-label={`Start new semester from ${course.courseName}`}
                data-testid={`button-rollover-course-${course.id}`}
              >
                <CalendarPlus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Start new semester</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                disabled={isDuplicating}
                aria-label={`Duplicate ${course.courseName}`}
                data-testid={`button-duplicate-course-${course.id}`}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Duplicate course</p>
            </TooltipContent>
          </Tooltip>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${course.courseName}`}
                data-testid={`button-delete-course-${course.id}`}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Course?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{course.courseName}"? This will permanently remove all saved work and cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Dialog open={rolloverOpen} onOpenChange={setRolloverOpen}>
        <DialogContent className="sm:max-w-md">
          {rolloverStep === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>Start New Semester</DialogTitle>
                <DialogDescription>
                  Creates a copy of <strong>{course.courseName}</strong> for a new semester. Choose the semester you're teaching next.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`rollover-semester-${course.id}`}>Semester</Label>
                  <Select
                    value={semesterType}
                    onValueChange={setSemesterType}
                  >
                    <SelectTrigger
                      id={`rollover-semester-${course.id}`}
                      data-testid={`select-rollover-semester-${course.id}`}
                    >
                      <SelectValue placeholder="Select semester" />
                    </SelectTrigger>
                    <SelectContent>
                      {SEMESTER_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`rollover-year-${course.id}`}>Year</Label>
                  <Select
                    value={String(semesterYear)}
                    onValueChange={(v) => setSemesterYear(parseInt(v))}
                  >
                    <SelectTrigger
                      id={`rollover-year-${course.id}`}
                      data-testid={`select-rollover-year-${course.id}`}
                    >
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRolloverOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => setRolloverStep(2)}
                  data-testid={`button-rollover-next-${course.id}`}
                >
                  Next →
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Carry Forward Materials?</DialogTitle>
                <DialogDescription>
                  Optionally bring content from this course into{" "}
                  <strong>{buildSemesterString(semesterType, semesterYear)}</strong>.
                  Leave everything unchecked to start fresh.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                {sortedContents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No generated content to carry forward.
                  </p>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {sortedContents.map((item) => {
                      const Icon = toolIconMap[item.toolType] || FileText;
                      const checked = selectedContentIds.has(item.id);
                      return (
                        <label
                          key={item.id}
                          className="flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer hover:bg-muted transition-colors"
                          data-testid={`rollover-content-item-${item.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleContentId(item.id)}
                            data-testid={`checkbox-rollover-content-${item.id}`}
                            aria-label={`Carry forward ${item.toolName}`}
                          />
                          <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <span className="flex-1 text-sm font-medium">{item.toolName}</span>
                          {item.isApproved && (
                            <Badge variant="secondary" className="text-xs shrink-0">Approved</Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedContentIds.size > 0 && (
                  <p className="text-xs text-muted-foreground mt-2 px-1">
                    {selectedContentIds.size} item{selectedContentIds.size !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setRolloverStep(1)} className="sm:mr-auto">
                  ← Back
                </Button>
                <Button
                  onClick={handleRolloverConfirm}
                  disabled={isRollingOver}
                  data-testid={`button-rollover-confirm-${course.id}`}
                >
                  {selectedContentIds.size > 0
                    ? `Start New Semester (${selectedContentIds.size} item${selectedContentIds.size !== 1 ? "s" : ""})`
                    : "Start Fresh"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
