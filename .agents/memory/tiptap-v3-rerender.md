---
name: TipTap v3 re-render and jsdom testing
description: How TipTap v3 triggers React re-renders, and jsdom quirks that affect toolbar tests
---

## Rule
Always add `shouldRerenderOnTransaction: true` to `useEditor()` in TipTap v3. Without it, the component never re-renders on transactions — toolbar `aria-pressed` / `disabled` states are stuck at their initial render values.

**Why:** TipTap v3 (tested on 3.27.0) changed the default from v2: `useEditor`'s internal `useEditorState` selector returns `null` when `shouldRerenderOnTransaction` is `undefined` or `false`, so `useSyncExternalStore` never triggers a re-render. This is a silent production bug — buttons appear correct only if the initial cursor position happens to produce the right `isActive` result.

**How to apply:** Add the flag to every `useEditor` call that renders reactive toolbar / status UI:
```ts
const editor = useEditor({
  // ...
  shouldRerenderOnTransaction: true,
});
```

## jsdom + TipTap testing quirks

- **`userEvent.click(contenteditable)`** moves the ProseMirror cursor to position 0 via `posAtCoords`, which returns `null` without a layout engine. Position 0 is outside any block node, so `isActive('heading', {level:1})` returns false. Use `fireEvent.click` for toolbar buttons (avoids blur → rAF focus issue) and skip click interactions for cursor-detection tests that rely on initial cursor position.
- **Initial cursor position**: TipTap places the cursor at position 1 (inside the first block) on mount. For `<h1>text</h1>`, position 1 is inside the heading — `isActive('heading', {level:1})` = true immediately. Cursor-detection tests can assert on the initial render state without any pointer interaction.
- **Toolbar button clicks in tests**: use `fireEvent.click` (not `userEvent.click`) wrapped in `await act(async () => {...})`. `userEvent.click` causes blur → TipTap's `focus()` command defers re-focus to `requestAnimationFrame` (never fires in jsdom) → toggle command runs without focus → dispatch may bail.
