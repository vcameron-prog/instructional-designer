// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OutcomeLibraryModal } from "./outcome-library-modal"

let authenticated = true

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: authenticated }),
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}))

describe("OutcomeLibraryModal tabs", () => {
  beforeEach(() => {
    authenticated = true
  })

  it("connects each available tab to its matching panel", () => {
    render(<OutcomeLibraryModal open onClose={vi.fn()} onAddOutcomes={vi.fn()} />)

    const libraryTab = screen.getByRole("tab", { name: "Library" })
    const libraryPanel = screen.getByRole("tabpanel")

    expect(libraryTab).toHaveAttribute("aria-controls", libraryPanel.id)
    expect(libraryPanel).toHaveAttribute("aria-labelledby", libraryTab.id)

    fireEvent.click(screen.getByRole("tab", { name: /My Outcomes/ }))

    const myOutcomesTab = screen.getByRole("tab", { name: /My Outcomes/ })
    const myOutcomesPanel = screen.getByRole("tabpanel")
    expect(myOutcomesTab).toHaveAttribute("aria-controls", myOutcomesPanel.id)
    expect(myOutcomesPanel).toHaveAttribute("aria-labelledby", myOutcomesTab.id)
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
  })

  it("uses roving tab focus and selects with Left and Right Arrow", () => {
    render(<OutcomeLibraryModal open onClose={vi.fn()} onAddOutcomes={vi.fn()} />)

    const libraryTab = screen.getByRole("tab", { name: "Library" })
    const myOutcomesTab = screen.getByRole("tab", { name: /My Outcomes/ })

    expect(libraryTab).toHaveAttribute("tabindex", "0")
    expect(myOutcomesTab).toHaveAttribute("tabindex", "-1")

    libraryTab.focus()
    fireEvent.keyDown(libraryTab, { key: "ArrowRight" })

    expect(myOutcomesTab).toHaveFocus()
    expect(myOutcomesTab).toHaveAttribute("aria-selected", "true")
    expect(myOutcomesTab).toHaveAttribute("tabindex", "0")
    expect(libraryTab).toHaveAttribute("tabindex", "-1")

    fireEvent.keyDown(myOutcomesTab, { key: "ArrowLeft" })

    expect(libraryTab).toHaveFocus()
    expect(libraryTab).toHaveAttribute("aria-selected", "true")
  })

  it("limits keyboard navigation to the available tab for signed-out users", () => {
    authenticated = false
    render(<OutcomeLibraryModal open onClose={vi.fn()} onAddOutcomes={vi.fn()} />)

    const libraryTab = screen.getByRole("tab", { name: "Library" })
    libraryTab.focus()
    fireEvent.keyDown(libraryTab, { key: "ArrowRight" })

    expect(libraryTab).toHaveFocus()
    expect(libraryTab).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("tab", { name: /My Outcomes/ })).not.toBeInTheDocument()
  })
})