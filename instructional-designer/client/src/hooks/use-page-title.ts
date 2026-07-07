import { useEffect } from "react";

const BASE_TITLE = "Instructional Designer";

function setMetaContent(selector: string, attr: "content" | "href", value: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.setAttribute(attr, value);
}

export function usePageTitle(title: string, description?: string) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${BASE_TITLE}` : BASE_TITLE;
    document.title = fullTitle;

    const canonicalHref = window.location.origin + window.location.pathname;

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalHref;

    if (description) {
      setMetaContent('meta[name="description"]', "content", description);
    }

    setMetaContent('meta[property="og:title"]', "content", fullTitle);
    setMetaContent('meta[property="og:url"]', "content", canonicalHref);
    if (description) {
      setMetaContent('meta[property="og:description"]', "content", description);
      setMetaContent('meta[name="twitter:description"]', "content", description);
    }
    setMetaContent('meta[name="twitter:title"]', "content", fullTitle);

    return () => {
      document.title = BASE_TITLE;
    };
  }, [title, description]);
}
