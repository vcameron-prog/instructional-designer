import {
  useEditor,
  EditorContent,
  Extension,
  Node,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { useEffect, useCallback } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Link as LinkIcon,
  Unlink,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function extractBodyInner(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1].trim() : html;
}

export function mergeBodyInner(original: string, newBodyInner: string): string {
  if (!/<body[^>]*>/i.test(original)) return newBodyInner;
  return original.replace(
    /(<body[^>]*>)([\s\S]*?)(<\/body>)/i,
    (_m, open, _old, close) => `${open}${newBodyInner}${close}`,
  );
}

const PRESERVED_ATTRS = [
  "id",
  "class",
  "role",
  "lang",
  "scope",
  "headers",
  "colspan",
  "rowspan",
  "tabindex",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "aria-live",
  "aria-atomic",
  "aria-relevant",
  "aria-required",
  "aria-expanded",
  "aria-controls",
  "aria-current",
  "aria-selected",
  "aria-checked",
  "aria-pressed",
  "aria-haspopup",
  "aria-invalid",
  "aria-multiline",
  "aria-orientation",
  "aria-posinset",
  "aria-setsize",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
  "aria-sort",
  "aria-colcount",
  "aria-colindex",
  "aria-rowcount",
  "aria-rowindex",
  "aria-colspan",
  "aria-rowspan",
  "data-testid",
] as const;

type PreservedAttr = (typeof PRESERVED_ATTRS)[number];

function buildAttrConfig() {
  return Object.fromEntries(
    PRESERVED_ATTRS.map((attr) => [
      attr,
      {
        default: null,
        parseHTML: (element: Element) => element.getAttribute(attr) ?? null,
        renderHTML: (attributes: Record<PreservedAttr, string | null>) =>
          attributes[attr] != null ? { [attr]: attributes[attr] } : {},
      },
    ]),
  );
}

const AccessibilityAttributes = Extension.create({
  name: "accessibilityAttributes",
  addGlobalAttributes() {
    return [
      {
        types: [
          "heading",
          "paragraph",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
          "codeBlock",
          "horizontalRule",
          "image",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "link",
          "section",
          "article",
          "figure",
          "figcaption",
          "aside",
        ],
        attributes: buildAttrConfig(),
      },
    ];
  },
});

function makeContainerNode(
  name: string,
  tag: string,
  extraTags: string[] = [],
) {
  return Node.create({
    name,
    group: "block",
    content: "block+",
    parseHTML() {
      return [tag, ...extraTags].map((t) => ({ tag: t }));
    },
    renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
      return [tag, HTMLAttributes, 0];
    },
    addAttributes() {
      return buildAttrConfig();
    },
  });
}

const SectionNode = makeContainerNode("section", "section");
const ArticleNode = makeContainerNode("article", "article");
const AsideNode = makeContainerNode("aside", "aside");

const FigureNode = Node.create({
  name: "figure",
  group: "block",
  content: "block+",
  parseHTML() {
    return [{ tag: "figure" }];
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["figure", HTMLAttributes, 0];
  },
  addAttributes() {
    return buildAttrConfig();
  },
});

const FigcaptionNode = Node.create({
  name: "figcaption",
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "figcaption" }];
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["figcaption", HTMLAttributes, 0];
  },
  addAttributes() {
    return buildAttrConfig();
  },
});

interface RichTextEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
  className?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center justify-center w-8 h-8 rounded text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-secondary",
        disabled && "opacity-40 cursor-not-allowed",
      )}
      data-testid={`rte-toolbar-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  initialHtml,
  onChange,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          class: "text-blue-600 underline cursor-pointer",
        },
      }),
      Placeholder.configure({ placeholder: "Start editing…" }),
      Image.configure({
        inline: true,
        HTMLAttributes: { class: "max-w-full rounded" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      SectionNode,
      ArticleNode,
      AsideNode,
      FigureNode,
      FigcaptionNode,
      AccessibilityAttributes,
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Edit accessible HTML",
        "data-testid": "rich-text-editor-content",
        class:
          "prose prose-slate max-w-none dark:prose-invert focus:outline-none min-h-[400px] p-4",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml);
    }
  }, [initialHtml]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden bg-background",
        className,
      )}
      data-testid="rich-text-editor"
    >
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-secondary/40"
      >
        <ToolbarButton
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>

        <span className="w-px h-5 bg-border mx-1" aria-hidden="true" />

        <ToolbarButton
          label="Heading 1"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          active={editor.isActive("heading", { level: 1 })}
        >
          <Heading1 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Heading 2"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Heading 3"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive("heading", { level: 3 })}
        >
          <Heading3 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Heading 4"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 4 }).run()
          }
          active={editor.isActive("heading", { level: 4 })}
        >
          <Heading4 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <span className="w-px h-5 bg-border mx-1" aria-hidden="true" />

        <ToolbarButton
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
        >
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>

        <span className="w-px h-5 bg-border mx-1" aria-hidden="true" />

        <ToolbarButton
          label="Add link"
          onClick={setLink}
          active={editor.isActive("link")}
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Remove link"
          onClick={() =>
            editor.chain().focus().extendMarkRange("link").unsetLink().run()
          }
          disabled={!editor.isActive("link")}
        >
          <Unlink className="w-3.5 h-3.5" />
        </ToolbarButton>

        <span className="w-px h-5 bg-border mx-1" aria-hidden="true" />

        <ToolbarButton
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo className="w-3.5 h-3.5" />
        </ToolbarButton>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
