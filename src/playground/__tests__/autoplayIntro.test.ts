/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoplayIntro } from "../hooks/useAutoplayIntro.js";
import {
  hasIntroSeen,
  INTRO_SEEN_KEY,
  INTRO_SOURCE,
  markIntroSeen,
} from "../lib/introSource.js";
import type { InspectorTabId } from "../components/Inspector.js";
import { memoryStorage } from "./setup.js";

describe("introSource helpers", () => {
  beforeEach(() => {
    memoryStorage.clear();
  });

  it("marks and reads the seen flag", () => {
    expect(hasIntroSeen()).toBe(false);
    markIntroSeen();
    expect(hasIntroSeen()).toBe(true);
    expect(memoryStorage.getItem(INTRO_SEEN_KEY)).toBe("1");
  });
});

describe("useAutoplayIntro", () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    memoryStorage.clear();
  });

  function mount(wabtReady = true) {
    const setSource = vi.fn();
    const run = vi.fn(async () => undefined);
    const setActiveTab = vi.fn<(tab: InspectorTabId) => void>();
    const hook = renderHook(
      (props: { wabtReady: boolean }) =>
        useAutoplayIntro({
          setSource,
          run,
          setActiveTab,
          wabtReady: props.wabtReady,
        }),
      { initialProps: { wabtReady } },
    );
    return { ...hook, setSource, run, setActiveTab };
  }

  it("does nothing when intro was already seen", () => {
    markIntroSeen();
    const { result, setSource, run } = mount();
    expect(result.current.playing).toBe(false);
    expect(setSource).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("types source progressively then runs on first visit", async () => {
    const { result, setSource, run, setActiveTab } = mount();

    expect(result.current.playing).toBe(true);
    expect(hasIntroSeen()).toBe(true);

    await act(async () => {
      // Typewriter: CHAR_MS * length + settle + tab tour + settle
      const typeMs = 28 * INTRO_SOURCE.length + 500;
      const tourMs = 900 * 5 + 500;
      vi.advanceTimersByTime(typeMs + tourMs);
    });

    expect(setSource).toHaveBeenCalled();
    const lastSource = setSource.mock.calls.at(-1)?.[0];
    expect(lastSource).toBe(INTRO_SOURCE);
    expect(setActiveTab).toHaveBeenCalledWith("output");

    await act(async () => {
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.playing).toBe(false);
  });

  it("stops further setSource calls after interrupt", async () => {
    const { result, setSource } = mount();

    await act(async () => {
      vi.advanceTimersByTime(28 * 20);
    });
    const callsBefore = setSource.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    await act(async () => {
      result.current.interrupt();
    });

    await act(async () => {
      vi.advanceTimersByTime(28 * 200);
    });

    expect(setSource.mock.calls.length).toBe(callsBefore);
    expect(result.current.playing).toBe(false);
  });

  it("skip jumps to full source and runs", async () => {
    const { result, setSource, run, setActiveTab } = mount();

    await act(async () => {
      vi.advanceTimersByTime(28 * 10);
    });

    await act(async () => {
      result.current.skip();
    });

    expect(setSource).toHaveBeenCalledWith(INTRO_SOURCE);
    expect(setActiveTab).toHaveBeenCalledWith("output");

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalled();
  });

  it("reduced-motion jumps straight to resting run", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const { setSource, run, setActiveTab } = mount();

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(setSource).toHaveBeenCalledWith(INTRO_SOURCE);
    expect(setActiveTab).toHaveBeenCalledWith("output");
    expect(run).toHaveBeenCalled();
    // Should not type character-by-character
    expect(setSource.mock.calls.length).toBe(1);
  });

  it("waits for wabt before running", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const { rerender, setSource, run } = mount(false);

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(setSource).toHaveBeenCalledWith(INTRO_SOURCE);
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ wabtReady: true });
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalled();
  });
});
