// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { describe, expect, it, vi } from "vitest"
import { Carousel, CarouselContent, CarouselItem } from "./carousel"

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}))

describe("Carousel accessibility", () => {
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
})