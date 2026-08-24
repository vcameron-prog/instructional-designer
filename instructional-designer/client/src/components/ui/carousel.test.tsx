// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Carousel, CarouselContent, CarouselItem } from "./carousel"

const emblaMock = vi.hoisted(() => {
  let selected = 0
  let snapCount = 3
  const listeners = new Map<string, (api: unknown) => void>()
  const api = {
    canScrollPrev: vi.fn(() => selected > 0),
    canScrollNext: vi.fn(() => selected < snapCount - 1),
    selectedScrollSnap: vi.fn(() => selected),
    scrollSnapList: vi.fn(() => Array.from({ length: snapCount }, (_, index) => index)),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    scrollTo: vi.fn(),
    on: vi.fn((event: string, callback: (api: unknown) => void) => {
      listeners.set(event, callback)
    }),
    off: vi.fn(),
  }

  return {
    api,
    listeners,
    reset() {
      selected = 0
      snapCount = 3
      listeners.clear()
      Object.values(api).forEach((value) => {
        if (typeof value === "function" && "mockClear" in value) {
          value.mockClear()
        }
      })
    },
    select(index: number) {
      selected = index
      listeners.get("select")?.(api)
    },
    reInit(index: number, total: number) {
      selected = index
      snapCount = total
      listeners.get("reInit")?.(api)
    },
  }
})

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), emblaMock.api],
}))

describe("Carousel accessibility", () => {
  beforeEach(() => {
    emblaMock.reset()
  })

  it("exposes a consumer-supplied accessible name", () => {
    render(
      <Carousel aria-label="Featured courses">
        <CarouselContent>
          <CarouselItem>First course</CarouselItem>
        </CarouselContent>
      </Carousel>,
    )

    expect(screen.getByRole("region", { name: "Featured courses" })).toHaveAttribute(
      "aria-roledescription",
      "carousel",
    )
  })

  it("supports naming the region with aria-labelledby", () => {
    render(
      <>
        <h2 id="carousel-heading">Recommended courses</h2>
        <Carousel aria-labelledby="carousel-heading">
          <CarouselContent>
            <CarouselItem>First course</CarouselItem>
          </CarouselContent>
        </Carousel>
      </>,
    )

    expect(screen.getByRole("region", { name: "Recommended courses" })).toBeInTheDocument()
  })

  it("computes each slide's one-based position and total", () => {
    render(
      <Carousel aria-label="Featured courses">
        <CarouselContent>
          <CarouselItem>First course</CarouselItem>
          <CarouselItem>Second course</CarouselItem>
          <CarouselItem>Third course</CarouselItem>
        </CarouselContent>
      </Carousel>,
    )

    expect(screen.getByRole("group", { name: "Slide 1 of 3" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Slide 2 of 3" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Slide 3 of 3" })).toBeInTheDocument()
  })

  it("moves directly to the first and last slide with Home and End", () => {
    render(
      <Carousel aria-label="Featured courses">
        <CarouselContent>
          <CarouselItem>First course</CarouselItem>
          <CarouselItem>Second course</CarouselItem>
          <CarouselItem>Third course</CarouselItem>
        </CarouselContent>
      </Carousel>,
    )

    const carousel = screen.getByRole("region", { name: "Featured courses" })
    fireEvent.keyDown(carousel, { key: "End" })
    expect(emblaMock.api.scrollTo).toHaveBeenCalledWith(2)

    fireEvent.keyDown(carousel, { key: "Home" })
    expect(emblaMock.api.scrollTo).toHaveBeenCalledWith(0)
  })

  it("announces the current one-based slide position after selection and reinitialization", () => {
    render(
      <Carousel aria-label="Featured courses">
        <CarouselContent>
          <CarouselItem>First course</CarouselItem>
          <CarouselItem>Second course</CarouselItem>
          <CarouselItem>Third course</CarouselItem>
        </CarouselContent>
      </Carousel>,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Slide 1 of 3")

    act(() => emblaMock.select(1))
    expect(status).toHaveTextContent("Slide 2 of 3")

    act(() => emblaMock.reInit(3, 5))
    expect(status).toHaveTextContent("Slide 4 of 5")
    expect(screen.getAllByRole("status")).toHaveLength(1)
  })
})