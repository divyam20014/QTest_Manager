import "@fontsource-variable/inter/index.css";
import "./marketing.css";

import { ArrowRight } from "lucide-react";
import {
  type ComponentType,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";

import { isThemeChoice } from "@/lib/themes";
import { refreshTheme, STORAGE_KEY } from "@/lib/useThemePreference";

import { MarketingFooter } from "./MarketingFooter";
import { MarketingNav } from "./MarketingNav";
import { BackToTop, ScrollProgress, SectionRail } from "./PageChrome";
import HomePage from "./pages/HomePage";
import { prefersReducedMotion, useRevealOnScroll } from "./utils";

// Only the home page ships in the first chunk; the other pages load on demand.
const AboutPage = lazy(() => import("./pages/AboutPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const FeaturesPage = lazy(() => import("./pages/FeaturesPage"));
const PlatformPage = lazy(() => import("./pages/PlatformPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const QualityIntelligencePage = lazy(
  () => import("./pages/QualityIntelligencePage"),
);
const RequestDemoPage = lazy(() => import("./pages/RequestDemoPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const PrivacyPage = () => <LegalPage kind="privacy" />;
const TermsPage = () => <LegalPage kind="terms" />;
const SolutionsPage = lazy(() => import("./pages/SolutionsPage"));

const PAGES: Record<string, ComponentType> = {
  "/": HomePage,
  "/platform": PlatformPage,
  "/features": FeaturesPage,
  "/solutions": SolutionsPage,
  "/quality-intelligence": QualityIntelligencePage,
  "/pricing": PricingPage,
  "/about": AboutPage,
  "/contact": ContactPage,
  "/request-demo": RequestDemoPage,
  "/security": SecurityPage,
  "/privacy": PrivacyPage,
  "/terms": TermsPage,
};

const NO_STICKY_CTA = new Set(["/request-demo", "/contact"]);

/** Phones have no room for the demo button in the nav bar, so it follows the
 * reader at the bottom of the screen instead. It stays out of the way at the
 * top of the page, on the form pages, and wherever the closing call to action
 * or the footer is on screen. */
function StickyDemoBar({ pathname }: { pathname: string }) {
  const [visible, setVisible] = useState(false);
  const enabled = !NO_STICKY_CTA.has(pathname);

  useEffect(() => {
    if (!enabled) return;
    const covered = new Set<Element>();
    const update = () => setVisible(window.scrollY > 520 && covered.size === 0);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) covered.add(entry.target);
              else covered.delete(entry.target);
            }
            update();
          });
    document
      .querySelectorAll(".qth-landing footer, .qth-landing .lp-cta-panel")
      .forEach((el) => observer?.observe(el));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [enabled, pathname]);

  if (!enabled) return null;
  return (
    <div
      className="lp-sticky-cta sm:hidden"
      data-visible={visible}
      inert={!visible}
    >
      <Link to="/request-demo" className="lp-btn lp-btn-light">
        Request a Demo
        <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function PageMounted({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The public marketing website: one lazily loaded chunk, so signed-in app
 * users never download it. */
export default function MarketingSite() {
  const { pathname, hash } = useLocation();
  const Page = PAGES[pathname] ?? HomePage;
  // `pageReady` bumps when a (lazily loaded) page commits, so the reveal observer
  // re-scans for its `.lp-reveal` elements instead of missing them.
  const [pageReady, setPageReady] = useState(0);
  const rootRef = useRevealOnScroll<HTMLDivElement>(`${pathname}:${pageReady}`);
  const previousPath = useRef<string | null>(null);

  // ADR-101: the site's own default look is Cobalt & Sunshine unless the visitor
  // saved an explicit theme; leaving the site hands <html> back to the app theme.
  useLayoutEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Blocked storage: no saved choice.
    }
    if (isThemeChoice(stored) && stored !== "system") return;
    // A signed-in visitor on "/" (session hint, see HomeGate) keeps the app default.
    try {
      if (
        pathname === "/" &&
        localStorage.getItem("qtesthub:session-hint") === "1"
      )
        return;
    } catch {
      // Blocked storage: treat as signed out.
    }
    document.documentElement.dataset.theme = "cobalt";
    return () => refreshTheme();
  }, [pathname]);

  useLayoutEffect(() => {
    const samePage = previousPath.current === pathname;
    previousPath.current = pathname;
    const target = hash
      ? document.getElementById(decodeURIComponent(hash.slice(1)))
      : null;
    if (target) {
      target.scrollIntoView({
        behavior: samePage && !prefersReducedMotion() ? "smooth" : "auto",
        block: "start",
      });
      // Keyboard and screen-reader users continue from the section they chose.
      if (!target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      // Web fonts and images settle after first paint and move the content
      // above the target, so keep it lined up for a moment. This stops as soon
      // as the reader scrolls, taps or types.
      if (typeof ResizeObserver !== "undefined") {
        let interacted = false;
        let initial = true;
        const stop = () => {
          interacted = true;
        };
        const events = [
          "wheel",
          "touchstart",
          "keydown",
          "pointerdown",
        ] as const;
        events.forEach((name) =>
          window.addEventListener(name, stop, { passive: true, once: true }),
        );
        const observer = new ResizeObserver(() => {
          // The first callback only reports the starting size.
          if (initial) {
            initial = false;
            return;
          }
          if (!interacted)
            target.scrollIntoView({ behavior: "auto", block: "start" });
        });
        observer.observe(document.body);
        const timer = window.setTimeout(() => observer.disconnect(), 2000);
        return () => {
          observer.disconnect();
          window.clearTimeout(timer);
          events.forEach((name) => window.removeEventListener(name, stop));
        };
      }
    } else if (!samePage) {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return (
    <div ref={rootRef} className="qth-landing">
      <a
        href="#lp-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[var(--lp-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--lp-ink)]"
      >
        Skip to content
      </a>
      {/* Remounting on navigation closes any open menu. */}
      <div className="lp-nav-spacer" aria-hidden="true" />
      <MarketingNav key={pathname + hash} />
      <ScrollProgress />
      <main id="lp-main" tabIndex={-1} className="outline-none">
        <Suspense fallback={null}>
          <Page />
          <PageMounted
            key={pathname}
            onMount={() => setPageReady((n) => n + 1)}
          />
        </Suspense>
      </main>
      <MarketingFooter />
      <StickyDemoBar pathname={pathname} />
      <BackToTop />
      {pathname === "/" && <SectionRail ready={pageReady} />}
    </div>
  );
}
