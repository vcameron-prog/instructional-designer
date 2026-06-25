/**
 * Route visibility registry — the single source of truth for every route's
 * authentication requirement and its expected sign-in button behaviour for
 * unauthenticated visitors.
 *
 * This file must remain free of React, browser, and server imports so it can
 * be imported directly by Playwright test specs running in Node.js.
 *
 * Adding a new public route:
 *   1. Add an entry here with requiresAuth: false.
 *   2. Set showSignIn: true  if the page renders HeaderControls without
 *      suppressing the Sign-In button (the common case for informational pages).
 *      Set showSignIn: false if the page uses ConverterHeader or passes
 *      showLogin={false} to HeaderControls.
 *      Omit showSignIn (leave undefined) only for dynamic-segment routes that
 *      cannot be reached without a real database record — those are skipped by
 *      the automated visibility matrix.
 *   3. Add the component mapping in App.tsx.
 *
 * The Playwright spec e2e/sign-in-button-visibility.spec.ts reads this array
 * at runtime to build its test matrix, so new routes are automatically covered
 * without any manual spec edits.
 */

export interface RouteVisibility {
  /** Wouter path pattern, e.g. "/pdf-accessibility/:id". */
  path: string;

  /**
   * When true the route is wrapped in <ProtectedRoute> and unauthenticated
   * visitors are redirected before the page renders.
   */
  requiresAuth: boolean;

  /**
   * Expected sign-in button (data-testid="button-header-login") visibility
   * for unauthenticated visitors:
   *
   *   true      button MUST be visible   (e.g. /help — HeaderControls default)
   *   false     button MUST NOT appear   (e.g. / — showLogin={false}, or
   *                                       ConverterHeader pages)
   *   undefined route is excluded from the automated visibility matrix; use
   *             this for dynamic-segment paths that require a real DB record
   *             (e.g. /pdf-accessibility/:id) or routes that always redirect.
   */
  showSignIn?: boolean;
}

export const ROUTE_VISIBILITY: RouteVisibility[] = [
  { path: "/",                          requiresAuth: false, showSignIn: false },
  { path: "/accessibility",             requiresAuth: false, showSignIn: false },
  { path: "/pdf-accessibility",         requiresAuth: false, showSignIn: false },
  { path: "/pdf-accessibility/history", requiresAuth: true                    },
  { path: "/pdf-accessibility/faq",     requiresAuth: false, showSignIn: false },
  { path: "/pdf-accessibility/:id",     requiresAuth: false                   },
  { path: "/settings",                  requiresAuth: true                    },
  { path: "/help",                      requiresAuth: false, showSignIn: true  },
  { path: "/admin",                     requiresAuth: true                    },
];
