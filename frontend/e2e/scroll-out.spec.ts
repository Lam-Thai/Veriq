import { test, expect, type Page } from "@playwright/test";

// The ScrollOut wrapper (components/ui/scroll-out.tsx) renders a <div> that directly wraps each
// landing <section>. It writes its shrink/blur/fade imperatively as inline styles, so we assert on
// those inline styles rather than a class. The hero section is #why-veriq, so its wrapper is that
// section's parent element.
//
// Note: we set prefers-reduced-motion with page.emulateMedia() rather than test.use({ reducedMotion })
// — in this Playwright version the fixture form did not reach window.matchMedia, while the explicit
// call does.
type WrapperStyle = { transform: string; opacity: string; filter: string };

async function readHeroWrapperStyle(page: Page): Promise<WrapperStyle> {
  return page.evaluate(() => {
    const wrapper = document.querySelector("#why-veriq")?.parentElement as HTMLElement | null;
    return {
      transform: wrapper?.style.transform ?? "",
      opacity: wrapper?.style.opacity ?? "",
      filter: wrapper?.style.filter ?? "",
    };
  });
}

// Scroll to an absolute Y and let the passive scroll listener's requestAnimationFrame run + paint.
// The page opts into smooth scrolling (data-scroll-behavior="smooth"), so we force an instant jump
// and wait until the scroll position has actually landed before reading styles.
async function scrollAndSettle(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: "instant" }), y);
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) <= 1, y);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

function scale(transform: string): number | null {
  const match = transform.match(/scale\(([\d.]+)\)/);
  return match ? Number.parseFloat(match[1]!) : null;
}

test.describe("ScrollOut — effect active", () => {
  test("shrinks/blurs/fades the outgoing section proportionally to scroll position", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");

    // Derive scroll targets from the hero's real height so the test is robust to section size: the
    // effect reaches full strength once the section is scrolled roughly its own height past the top.
    const full = await page.evaluate(() => {
      const wrapper = document.querySelector("#why-veriq")!.parentElement as HTMLElement;
      const vh = window.innerHeight;
      const span = vh * 0.6;
      return Math.max(wrapper.getBoundingClientRect().height - vh, span) + 24;
    });

    // Three increasing scroll depths → the effect must strengthen continuously (monotonically),
    // proving it is proportional to scroll position, not a binary on/off toggle.
    await scrollAndSettle(page, full * 0.7);
    const a = await readHeroWrapperStyle(page);
    await scrollAndSettle(page, full * 0.85);
    const b = await readHeroWrapperStyle(page);
    await scrollAndSettle(page, full);
    const c = await readHeroWrapperStyle(page);

    const [sa, sb, sc] = [scale(a.transform), scale(b.transform), scale(c.transform)];

    // Engaged but not fully clamped at the first sample.
    expect(sa).not.toBeNull();
    expect(sa!).toBeGreaterThan(0.94);
    expect(sa!).toBeLessThan(1);

    // Continuous, monotonic response: deeper scroll → progressively smaller scale + lower opacity.
    expect(sb).not.toBeNull();
    expect(sc).not.toBeNull();
    expect(sb!).toBeLessThan(sa!);
    expect(sc!).toBeLessThanOrEqual(sb!);
    expect(Number.parseFloat(c.opacity)).toBeLessThan(Number.parseFloat(a.opacity));

    // Fade + blur are both present at depth.
    expect(Number.parseFloat(c.opacity)).toBeLessThan(1);
    expect(c.filter).toContain("blur(");
  });
});

test.describe("ScrollOut — tall section", () => {
  // A section taller than the exit span must NOT be fully shrunk/blurred/faded while most of it is
  // still on screen: the effect may only engage once the section is near actually leaving. Uses a
  // short viewport so the stacked landing sections are reliably taller than the viewport.
  test("stays near-untouched while most of the section is still on screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto("/");

    const result = await page.evaluate(() => {
      const vh = window.innerHeight;
      const span = vh * 0.6;
      // Tallest section wrapper that is neither first nor last (so the document-bottom guard isn't
      // the thing zeroing the effect — we want to prove the tall-section gate specifically).
      const wrappers = Array.from(document.querySelectorAll("main > div")) as HTMLElement[];
      const middle = wrappers.slice(1, -1);
      let tallest: HTMLElement | null = null;
      let tallestHeight = 0;
      for (const w of middle) {
        const h = w.getBoundingClientRect().height;
        if (h > tallestHeight) {
          tallestHeight = h;
          tallest = w;
        }
      }
      if (!tallest || tallestHeight < vh * 1.6) return { skip: true, index: -1 };

      // Scroll so the section's top edge is a full `span` above the viewport top (topRamp === 1).
      const docTop = window.scrollY + tallest.getBoundingClientRect().top;
      window.scrollTo({ top: docTop + span, left: 0, behavior: "instant" });
      return { skip: false, index: wrappers.indexOf(tallest) };
    });

    // No section tall enough at this viewport — report as skipped rather than a silent pass.
    test.skip(result.skip, "no landing section is tall enough at this viewport to exercise the gate");

    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const check = await page.evaluate((index: number) => {
      const wrapper = (Array.from(document.querySelectorAll("main > div")) as HTMLElement[])[index]!;
      const rect = wrapper.getBoundingClientRect();
      return {
        transform: wrapper.style.transform,
        opacity: wrapper.style.opacity,
        bottomBelowViewport: rect.bottom > window.innerHeight,
      };
    }, result.index);

    // Sanity: most of the section is still on screen (its bottom is still below the fold)...
    expect(check.bottomBelowViewport).toBe(true);
    // ...so the effect must be effectively off — no shrink and no fade — despite the top edge being
    // well above the viewport. (On the pre-fix code this would read scale(0.94) / opacity 0.)
    const s = scale(check.transform);
    expect(s === null || s > 0.99).toBeTruthy();
    expect(check.opacity === "" || Number.parseFloat(check.opacity) > 0.99).toBeTruthy();
  });
});

test.describe("ScrollOut — mobile viewport (375px)", () => {
  test("engages the effect without introducing horizontal overflow", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    // Scroll deep enough that the effect is fully engaged (derived from the hero's real height).
    const full = await page.evaluate(() => {
      const wrapper = document.querySelector("#why-veriq")!.parentElement as HTMLElement;
      const vh = window.innerHeight;
      return Math.max(wrapper.getBoundingClientRect().height - vh, vh * 0.6) + 24;
    });
    await scrollAndSettle(page, full);
    const style = await readHeroWrapperStyle(page);
    expect(scale(style.transform)).not.toBeNull();
    expect(scale(style.transform)!).toBeLessThan(1);

    // Scaling a full-bleed section must not widen the document: no horizontal scroll / layout shift.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("ScrollOut — prefers-reduced-motion", () => {
  test("is a no-op: no transform/blur/fade is ever written", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const viewport = page.viewportSize()!.height;

    // Same scroll that produces a strong effect above must leave the wrapper completely untouched.
    await scrollAndSettle(page, viewport * 0.7);
    const style = await readHeroWrapperStyle(page);

    expect(style.transform).toBe("");
    expect(style.opacity).toBe("");
    expect(style.filter).toBe("");
  });
});
