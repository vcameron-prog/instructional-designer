import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  onRollover: (semester: string) => void;
  isDuplicating: boolean;
  isRollingOver?: boolean;
}) {
  const { data: contents = [] } = useQuery<GeneratedContent[]>({
    queryKey: ["/api/courses", course.id, "content"],
  });

  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [semesterType, setSemesterType] = useState<string>(() => {
    const next = getNextSemester(course.semester);
    return next.type || SEMESTER_TYPES[0];
  });
  const [semesterYear, setSemesterYear] = useState<number>(() => {
    return getNextSemester(course.semester).year;
  });

  useEffect(() => {
    if (rolloverOpen) {
      const next = getNextSemester(course.semester);
      setSemesterType(next.type || SEMESTER_TYPES[0]);
      setSemesterYear(next.year);
    }
  }, [rolloverOpen, course.semester]);

  const years = getSemesterYears();

  const toolsGenerated = new Set(contents.map(c => c.toolType));
  const isSample = course.courseName.includes("[SAMPLE]");

  function handleRolloverConfirm() {
    const semester = buildSemesterString(semesterType, semesterYear);
    onRollover(semester);
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
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start New Semester</DialogTitle>
            <DialogDescription>
              Creates a fresh copy of <strong>{course.courseName}</strong> with no generated content. Choose the semester you're teaching next.
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
              onClick={handleRolloverConfirm}
              disabled={isRollingOver}
              data-testid={`button-rollover-confirm-${course.id}`}
            >
              Start New Semester
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
