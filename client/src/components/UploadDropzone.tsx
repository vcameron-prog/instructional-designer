import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, Loader2, File, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/msword": [".doc"],
  "application/rtf": [".rtf"],
  "text/rtf": [".rtf"],
  "text/html": [".html", ".htm"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],
  "application/epub+zip": [".epub"],
  "text/csv": [".csv"],
  "application/csv": [".csv"],
};

const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;

interface UploadDropzoneProps {
  onUpload: (files: File[]) => void;
  isUploading: boolean;
  multiple?: boolean;
}

export function UploadDropzone({
  onUpload,
  isUploading,
  multiple = true,
}: UploadDropzoneProps) {
  const [localError, setLocalError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: unknown[]) => {
      setLocalError(null);
      if (rejectedFiles.length > 0) {
        setLocalError(
          "Please upload a supported document under 20MB: PDF, Word (.doc/.docx), Excel (.xlsx), PowerPoint (.pptx), RTF, HTML, ODF (.odt/.ods/.odp), EPUB, or CSV.",
        );
        return;
      }
      if (acceptedFiles.length === 0) return;
      onUpload(multiple ? acceptedFiles : [acceptedFiles[0]]);
    },
    [onUpload, multiple],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple,
    maxFiles: multiple ? MAX_FILES : 1,
    maxSize: MAX_SIZE,
    disabled: isUploading,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "relative overflow-hidden group border-3 border-dashed rounded-2xl p-6 text-center transition-all duration-300 ease-out outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
          isDragActive
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/50 hover:bg-secondary/50 bg-background",
          isUploading && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
        data-testid="dropzone-upload"
      >
        <input
          {...getInputProps()}
          aria-label="Document File Upload"
          data-testid="input-file-upload"
        />
        <div className="flex flex-col items-center justify-center space-y-3">
          <div
            className={cn(
              "p-3 rounded-xl transition-colors duration-300",
              isUploading
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                : isDragActive
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground",
            )}
          >
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
            ) : (
              <UploadCloud className="w-6 h-6" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-foreground">
              {isUploading
                ? "Uploading & processing..."
                : isDragActive
                  ? "Drop document here"
                  : "Select a document to remediate"}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {isUploading
                ? "Preparing your document for accessibility remediation."
                : "Drag & drop or click to browse. WCAG 2.1 AA output."}
            </p>
          </div>
          {!isUploading && (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-background px-3 py-1 rounded-full border shadow-sm">
              <File className="w-3 h-3" aria-hidden="true" />
              PDF · DOCX · XLSX · PPTX · HTML · ODT · EPUB · CSV — up to 20 MB{multiple ? `, ${MAX_FILES} files max` : ""}
            </span>
          )}
        </div>
      </div>

      {localError && (
        <div
          className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center gap-2 text-sm"
          role="alert"
          data-testid="text-dropzone-error"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <p className="font-medium">{localError}</p>
        </div>
      )}
    </div>
  );
}
