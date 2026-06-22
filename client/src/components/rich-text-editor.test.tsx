// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { RichTextEditor, extractBodyInner, mergeBodyInner } from "./rich-text-editor";

// ---------------------------------------------------------------------------
// jsdom layout-API polyfills required by ProseMirror / TipTap v3
// ---------------------------------------------------------------------------

const ZERO_RECT: DOMRect = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this; },
};

const ZERO_RECT_LIST = Object.assign([ZERO_RECT], {
  length: 1,
  item: () => ZERO_RECT,
  [Symbol.iterator]: function* () { yield ZERO_RECT; },
}) as unknown as DOMRectList;

// Keep original references so we can restore them after the suite
const origElementGetClientRects = Element.prototype.getClientRects;
const origElementGetBBox = Element.prototype.getBoundingClientRect;
const origRangeGetClientRects = Range.prototype.getClientRects;
const origRangeGetBBox = Range.prototype.getBoundingClientRect;

type AnyNode = { getClientRects?: () => DOMRectList };

beforeAll(() => {
  if (!window.getSelection) {
    Object.defineProperty(window, "getSelection", {
      value: () => ({
        rangeCount: 0,
        getRangeAt: () => null,
        removeAllRanges: () => {},
        addRange: () => {},
      }),
      writable: true,
    });
  }

  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }

  if (!document.caretRangeFromPoint) {
    document.caretRangeFromPoint = () => null;
  }

  const docExt = document as unknown as { caretPositionFromPoint?: () => null };
  if (!docExt.caretPositionFromPoint) {
    docExt.caretPositionFromPoint = () => null;
  }

  // Ensure Element.prototype.getClientRects always returns a non-empty list
  // (jsdom returns an empty list since it has no layout engine)
  Element.prototype.getClientRects = function () {
    try {
      const r = origElementGetClientRects.call(this);
      if (r && r.length > 0) return r;
    } catch { /* fall through */ }
    return ZERO_RECT_LIST;
  };

  Element.prototype.getBoundingClientRect = function () {
    try { return origElementGetBBox.call(this); } catch { return ZERO_RECT; }
  };

  // Text nodes don't have getClientRects in older jsdom versions; add a shim
  const textNode = Text.prototype as unknown as AnyNode;
  if (!textNode.getClientRects) {
    textNode.getClientRects = () => ZERO_RECT_LIST;
  }

  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ZERO_RECT_LIST;
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  }
});

afterAll(() => {
  Element.prototype.getClientRects = origElementGetClientRects;
  Element.prototype.getBoundingClientRect = origElementGetBBox;
  Range.prototype.getClientRects = origRangeGetClientRects;
  Range.prototype.getBoundingClientRect = origRangeGetBBox;
  const textNode = Text.prototype as unknown as AnyNode;
  delete textNode.getClientRects;
});

// ---------------------------------------------------------------------------
// Pure utility function tests — no DOM or TipTap involved
// ---------------------------------------------------------------------------

describe("extractBodyInner", () => {
  it("extracts inner content from a full HTML document", () => {
    const html = "<html><head></head><body><p>Hello</p></body></html>";
    expect(extractBodyInner(html)).toBe("<p>Hello</p>");
  });

  it("returns the original string when there is no <body> tag", () => {
    const fragment = "<p>No body tag</p>";
    expect(extractBodyInner(fragment)).toBe(fragment);
  });

  it("handles a body tag with attributes", () => {
    const html = '<body class="main" lang="en"><h1>Title</h1></body>';
    expect(extractBodyInner(html)).toBe("<h1>Title</h1>");
  });

  it("trims surrounding whitespace from the body inner content", () => {
    const html = "<body>   <p>Spaced</p>   </body>";
    expect(extractBodyInner(html)).toBe("<p>Spaced</p>");
  });

  it("returns empty string when the body is empty", () => {
    expect(extractBodyInner("<body></body>")).toBe("");
  });

  it("is case-insensitive to the BODY tag", () => {
    const html = "<BODY><p>Upper</p></BODY>";
    expect(extractBodyInner(html)).toBe("<p>Upper</p>");
  });
});

describe("mergeBodyInner", () => {
  it("replaces body inner content in a full HTML document", () => {
    const original = "<html><body><p>Old</p></body></html>";
    const result = mergeBodyInner(original, "<p>New</p>");
    expect(result).toBe("<html><body><p>New</p></body></html>");
  });

  it("returns newBodyInner as-is when there is no <body> tag in original", () => {
    expect(mergeBodyInner("<p>No body</p>", "<p>Replacement</p>")).toBe(
      "<p>Replacement</p>",
    );
  });

  it("preserves body attributes while replacing inner content", () => {
    const original = '<html><body class="styled"><p>Old</p></body></html>';
    const result = mergeBodyInner(original, "<p>New</p>");
    expect(result).toContain('class="styled"');
    expect(result).toContain("<p>New</p>");
    expect(result).not.toContain("<p>Old</p>");
  });

  it("round-trips with extractBodyInner for full HTML documents", () => {
    const original = "<html><body><p>Original</p></body></html>";
    const inner = extractBodyInner(original);
    const merged = mergeBodyInner(original, inner);
    expect(merged).toBe(original);
  });

  it("is case-insensitive to the BODY tag", () => {
    const original = "<HTML><BODY><p>Old</p></BODY></HTML>";
    const result = mergeBodyInner(original, "<p>New</p>");
    expect(result).toContain("<p>New</p>");
    expect(result).not.toContain("<p>Old</p>");
  });
});

// ---------------------------------------------------------------------------
// Component rendering tests
// ---------------------------------------------------------------------------

describe("RichTextEditor — rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the editor container and toolbar", async () => {
    render(<RichTextEditor initialHtml="<p>Hello</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    });

    expect(screen.getByRole("toolbar", { name: /text formatting/i })).toBeInTheDocument();
  });

  it("renders all expected toolbar buttons", async () => {
    render(<RichTextEditor initialHtml="<p>Test</p>" onChange={() => {}} />);

    const buttonLabels = [
      "bold", "italic",
      "heading-1", "heading-2", "heading-3", "heading-4",
      "bullet-list", "numbered-list",
      "add-link", "remove-link",
      "undo", "redo",
    ];

    await waitFor(() => {
      for (const label of buttonLabels) {
        expect(
          screen.getByTestId(`rte-toolbar-${label}`),
          `Expected toolbar button "${label}" to be in the document`,
        ).toBeInTheDocument();
      }
    });
  });

  it("each toolbar button has an accessible aria-label", async () => {
    render(<RichTextEditor initialHtml="<p>Test</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    });

    const buttons = screen
      .getByRole("toolbar", { name: /text formatting/i })
      .querySelectorAll("button");

    for (const btn of buttons) {
      expect(
        btn.getAttribute("aria-label"),
        `Button missing aria-label: ${btn.outerHTML}`,
      ).toBeTruthy();
    }
  });

  it("renders the contenteditable area with correct role and aria attributes", async () => {
    render(<RichTextEditor initialHtml="<p>Content</p>" onChange={() => {}} />);

    await waitFor(() => {
      const contentArea = screen.getByTestId("rich-text-editor-content");
      expect(contentArea).toBeInTheDocument();
      expect(contentArea).toHaveAttribute("role", "textbox");
      expect(contentArea).toHaveAttribute("aria-multiline", "true");
      expect(contentArea).toHaveAttribute("aria-label", "Edit accessible HTML");
      expect(contentArea).toHaveAttribute("contenteditable");
    });
  });

  it("bold button aria-pressed is false for plain paragraph content", async () => {
    render(<RichTextEditor initialHtml="<p>Hello</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-bold")).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("remove-link button is initially disabled when no link is active", async () => {
    render(<RichTextEditor initialHtml="<p>No link</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-remove-link")).toBeDisabled();
    });
  });

  it("undo button is initially disabled with no edit history", async () => {
    render(<RichTextEditor initialHtml="<p>Fresh</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-undo")).toBeDisabled();
    });
  });

  it("redo button is initially disabled with no edit history", async () => {
    render(<RichTextEditor initialHtml="<p>Fresh</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-redo")).toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// onChange callback tests
// ---------------------------------------------------------------------------

describe("RichTextEditor — onChange callback", () => {
  it("fires onChange with updated HTML containing the typed character", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p>Hello world</p>" onChange={onChange} />);

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor-content")).toBeInTheDocument();
    });

    const contentArea = screen.getByTestId("rich-text-editor-content");
    await user.click(contentArea);
    await user.keyboard("!");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastCall).toContain("!");
    });
  });

  it("onChange receives an HTML string (not plain text or JSON)", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p>Start</p>" onChange={onChange} />);

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor-content")).toBeInTheDocument();
    });

    const contentArea = screen.getByTestId("rich-text-editor-content");
    await user.click(contentArea);
    await user.keyboard("X");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const html = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(html).toMatch(/<[a-zA-Z]/);
    });
  });
});

// ---------------------------------------------------------------------------
// initialHtml prop reset (simulates Discard)
// ---------------------------------------------------------------------------

describe("RichTextEditor — initialHtml prop reset", () => {
  it("resets editor content when initialHtml prop changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor initialHtml="<p>First version</p>" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor-content").textContent).toContain("First version");
    });

    act(() => {
      rerender(<RichTextEditor initialHtml="<p>Reset version</p>" onChange={onChange} />);
    });

    await waitFor(() => {
      const contentArea = screen.getByTestId("rich-text-editor-content");
      expect(contentArea.textContent).toContain("Reset version");
      expect(contentArea.textContent).not.toContain("First version");
    });
  });

  it("does not reset content when the same initialHtml is passed again", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <RichTextEditor initialHtml="<p>Original</p>" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor-content")).toBeInTheDocument();
    });

    const contentArea = screen.getByTestId("rich-text-editor-content");
    await user.click(contentArea);
    await user.keyboard(" edited");

    act(() => {
      rerender(<RichTextEditor initialHtml="<p>Original</p>" onChange={onChange} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor-content").textContent).toContain("edited");
    });
  });
});

// ---------------------------------------------------------------------------
// Toolbar mark toggle tests — verify aria-pressed reflects real editor state
// ---------------------------------------------------------------------------

describe("RichTextEditor — toolbar mark toggles", () => {
  it("bold button shows aria-pressed=true when the selection is entirely bold", async () => {
    render(
      <RichTextEditor initialHtml="<p><strong>Bold text</strong></p>" onChange={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));
    await user.keyboard("{Control>}a{/Control}");

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-bold")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("italic button shows aria-pressed=true when the selection is entirely italic", async () => {
    render(
      <RichTextEditor initialHtml="<p><em>Italic text</em></p>" onChange={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));
    await user.keyboard("{Control>}a{/Control}");

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-italic")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("heading-1 button shows aria-pressed=false for plain paragraph content", async () => {
    render(<RichTextEditor initialHtml="<p>Plain text</p>" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("heading-1 button shows aria-pressed=true when cursor is inside an h1", async () => {
    render(<RichTextEditor initialHtml="<h1>Top heading</h1>" onChange={() => {}} />);
    // TipTap places the initial cursor at position 1, which is inside the heading
    // block, so isActive('heading', {level:1}) is true from the very first render.
    // We assert this initial state without any pointer interaction — userEvent.click
    // in jsdom moves the cursor to position 0 (posAtCoords returns null without a
    // layout engine), which falls outside the heading node and would flip
    // isActive to false.
    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("heading-2 button shows aria-pressed=true when cursor is inside an h2", async () => {
    render(<RichTextEditor initialHtml="<h2>Sub heading</h2>" onChange={() => {}} />);
    // Same reasoning as the h1 test above.
    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-2")).toHaveAttribute("aria-pressed", "true");
    });
  });

  // ---- true ON/OFF toggle tests -------------------------------------------
  // jsdom has no layout engine, so Ctrl+A does not produce a real ProseMirror
  // text-selection range. Inline-mark toggles (bold, italic) therefore operate
  // on the cursor position only (stored-marks mode). Block-level commands
  // (toggleHeading) act on whichever block contains the cursor.

  // ---- true ON/OFF toggle tests -------------------------------------------
  // jsdom constraint: TipTap's `focus()` command schedules the actual DOM
  // focus via `requestAnimationFrame`, which never fires in jsdom. If we use
  // `userEvent.click(button)` the editor first blurs (focus goes to the
  // button) → `view.hasFocus()` becomes false → `focus()` defers re-focus to
  // rAF → the toggle command runs without the editor regaining focus →
  // ProseMirror's dispatch may silently bail.
  //
  // Fix: use `fireEvent.click(button)` for toolbar buttons. `fireEvent`
  // dispatches only the click event without any pointer/focus side-effects, so
  // the editor remains `document.activeElement`, `view.hasFocus()` stays true,
  // and TipTap's `focus()` hits its early-exit path (`return true`) and lets
  // the following command run synchronously.
  //
  // Inline marks (bold, italic):
  //   With the editor focused and cursor in plain (non-bold) text, clicking
  //   the Bold button calls `toggleBold()`. Because the selection is
  //   cursor-only (empty), `toggleMark` sets a stored mark: the next typed
  //   character carries that mark. `isActive('bold')` reads `storedMarks` for
  //   an empty selection → returns true → aria-pressed flips to true. Typing
  //   one character then confirms the stored mark appears in onChange HTML.
  //
  // Block-level (heading):
  //   `toggleHeading({level})` changes the node type of the block at the
  //   cursor regardless of selection range. Toggle-ON and Toggle-OFF are both
  //   fully observable: aria-pressed and onChange HTML both update.

  it("clicking the Bold button sets the stored bold mark when cursor is in plain text: aria-pressed becomes true", async () => {
    render(<RichTextEditor initialHtml="<p>Plain text</p>" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    // Focus the editor so view.hasFocus() is true when we fire the button click
    await user.click(screen.getByTestId("rich-text-editor-content"));

    expect(screen.getByTestId("rte-toolbar-bold")).toHaveAttribute("aria-pressed", "false");

    // fireEvent preserves editor focus; act() flushes the useSyncExternalStore
    // re-render that TipTap schedules on the 'transaction' event.
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-bold"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-bold")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("clicking the Bold button in plain text and then typing produces <strong> HTML in onChange", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p></p>" onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));

    // Set stored bold mark without blurring the editor
    fireEvent.click(screen.getByTestId("rte-toolbar-bold"));

    // Type while bold stored-mark is active; editor is still focused
    await user.keyboard("X");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastHtml).toMatch(/<strong>/i);
    });
  });

  it("clicking the Italic button sets the stored italic mark when cursor is in plain text: aria-pressed becomes true", async () => {
    render(<RichTextEditor initialHtml="<p>Plain text</p>" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));

    expect(screen.getByTestId("rte-toolbar-italic")).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-italic"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-italic")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("clicking the Italic button in plain text and then typing produces <em> HTML in onChange", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p></p>" onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));

    fireEvent.click(screen.getByTestId("rte-toolbar-italic"));

    await user.keyboard("X");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastHtml).toMatch(/<em>/i);
    });
  });

  it("clicking the H1 button on a paragraph block toggles it to H1: aria-pressed becomes true and onChange HTML includes <h1>", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p>Turn me into a heading</p>" onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));

    expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "false");

    // Block-level toggle: changes node type at cursor, no selection needed
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-heading-1"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "true");
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastHtml).toMatch(/<h1>/i);
    });
  });

  it("clicking the H1 button on an H1 block toggles it back to a paragraph: aria-pressed becomes false and onChange HTML no longer has <h1>", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<h1>Already a heading</h1>" onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("rich-text-editor-content"));

    // Confirm initial state: cursor is inside h1
    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "true");
    });

    // Toggle OFF: heading → paragraph
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-heading-1"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("rte-toolbar-heading-1")).toHaveAttribute("aria-pressed", "false");
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastHtml).not.toMatch(/<h1>/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Link popover — "Remove link" button visibility and behavior
// ---------------------------------------------------------------------------
//
// jsdom constraint recap (same as toolbar mark toggle tests above):
//   - userEvent.click on the content area moves the TipTap cursor to pos 0
//     (outside any block), so isActive() always returns false after a click.
//   - We instead rely on TipTap's initial cursor placement (pos 1, inside the
//     first node) which reflects the actual mark state of the content.
//   - fireEvent.click is used for toolbar buttons so the editor remains focused
//     and TipTap's focus() chain command hits its early-exit path.
//   - The link popover is a controlled <Popover open={linkPopoverOpen}>.
//     Opening it via the toolbar button sets linkPopoverOpen=true and evaluates
//     editor.isActive("link") to derive linkIsActive.

describe("RichTextEditor — link popover Remove link button", () => {
  it("Remove link button (rte-link-remove) is present in popover when cursor is on an active link", async () => {
    render(
      <RichTextEditor
        initialHtml='<p><a href="https://example.com">link text</a></p>'
        onChange={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    // TipTap's initial cursor sits at pos 1 — inside the link mark.
    // Open the popover via fireEvent to keep editor focus intact.
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-add-link"));
    });

    // Popover is now open; rte-link-remove should be visible because
    // openLinkPopover() found editor.isActive("link") === true.
    await waitFor(() => {
      expect(screen.getByTestId("rte-link-remove")).toBeInTheDocument();
    });
  });

  it("clicking Remove link closes the popover and unsets the link", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        initialHtml='<p><a href="https://example.com">link text</a></p>'
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    // Open popover with cursor on the link
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-add-link"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("rte-link-remove")).toBeInTheDocument();
    });

    // Click Remove link; this calls removeLink() which runs unsetLink() then
    // closes the popover by setting linkPopoverOpen=false.
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-link-remove"));
    });

    // Popover should be closed: the Confirm button is only rendered when open.
    await waitFor(() => {
      expect(screen.queryByTestId("rte-link-confirm")).not.toBeInTheDocument();
    });

    // The onChange callback should have been called with HTML that no longer
    // contains an <a> element.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastHtml).not.toMatch(/<a[\s>]/i);
    });
  });

  it("Remove link button is NOT present in popover when cursor is outside a link", async () => {
    render(
      <RichTextEditor initialHtml="<p>Plain text with no link</p>" onChange={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument());

    // Open popover; editor.isActive("link") is false → linkIsActive=false
    await act(async () => {
      fireEvent.click(screen.getByTestId("rte-toolbar-add-link"));
    });

    // Popover is open (Cancel button is always rendered inside it)
    await waitFor(() => {
      expect(screen.getByTestId("rte-link-cancel")).toBeInTheDocument();
    });

    // Remove link button must NOT be present
    expect(screen.queryByTestId("rte-link-remove")).not.toBeInTheDocument();
  });
});
