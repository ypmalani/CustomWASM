import { useCallback, useEffect, useRef, useState } from "react";
import type { InspectorTabId } from "../components/Inspector.js";
import {
  hasIntroSeen,
  INTRO_SOURCE,
  markIntroSeen,
} from "../lib/introSource.js";

const CHAR_MS = 28;
const TAB_MS = 900;
const DEBOUNCE_SETTLE_MS = 350;

const TOUR_TABS: InspectorTabId[] = [
  "ast",
  "ir",
  "optimized-ir",
  "wat",
  "output",
];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isSkipControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-autoplay-skip]") !== null
  );
}

export interface UseAutoplayIntroOptions {
  setSource: (source: string) => void;
  run: () => Promise<void>;
  setActiveTab: (tab: InspectorTabId) => void;
  wabtReady: boolean;
}

export interface UseAutoplayIntroResult {
  /** True while the intro sequence (including skip→run) is in progress. */
  playing: boolean;
  /** Jump to resting fully-compiled state and run. */
  skip: () => void;
  /** Cancel immediately; leave source as-is; do not run. */
  interrupt: () => void;
}

/**
 * First-visit driver that calls the same setSource / setActiveTab / run APIs
 * a user would. Does not alter compile() or debounce wiring.
 */
export function useAutoplayIntro({
  setSource,
  run,
  setActiveTab,
  wabtReady,
}: UseAutoplayIntroOptions): UseAutoplayIntroResult {
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const pendingRunRef = useRef(false);
  const wabtReadyRef = useRef(wabtReady);
  wabtReadyRef.current = wabtReady;

  const setSourceRef = useRef(setSource);
  setSourceRef.current = setSource;
  const runRef = useRef(run);
  runRef.current = run;
  const setActiveTabRef = useRef(setActiveTab);
  setActiveTabRef.current = setActiveTab;

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const finishIdle = useCallback(() => {
    pendingRunRef.current = false;
    playingRef.current = false;
    setPlaying(false);
    clearTimers();
  }, [clearTimers]);

  const requestRun = useCallback(() => {
    pendingRunRef.current = true;
    if (!wabtReadyRef.current) return;
    pendingRunRef.current = false;
    void runRef.current().finally(() => {
      finishIdle();
    });
  }, [finishIdle]);

  const interrupt = useCallback(() => {
    if (!playingRef.current) return;
    cancelledRef.current = true;
    pendingRunRef.current = false;
    clearTimers();
    playingRef.current = false;
    setPlaying(false);
  }, [clearTimers]);

  const skip = useCallback(() => {
    if (!playingRef.current) return;
    cancelledRef.current = true;
    clearTimers();
    setSourceRef.current(INTRO_SOURCE);
    setActiveTabRef.current("output");
    // Keep playing until run settles into resting state.
    schedule(() => {
      if (!playingRef.current) return;
      requestRun();
    }, DEBOUNCE_SETTLE_MS);
  }, [clearTimers, requestRun, schedule]);

  // Complete a pending run once wabt is ready.
  useEffect(() => {
    if (!playing || !pendingRunRef.current || !wabtReady) return;
    pendingRunRef.current = false;
    void runRef.current().finally(() => {
      finishIdle();
    });
  }, [playing, wabtReady, finishIdle]);

  // Mount-once autoplay sequence.
  useEffect(() => {
    if (hasIntroSeen()) return;

    markIntroSeen();
    cancelledRef.current = false;
    playingRef.current = true;
    setPlaying(true);

    const onPointerOrKey = (event: Event) => {
      if (!playingRef.current) return;
      if (isSkipControl(event.target)) return;
      interrupt();
    };

    window.addEventListener("keydown", onPointerOrKey, true);
    window.addEventListener("pointerdown", onPointerOrKey, true);

    if (prefersReducedMotion()) {
      setSourceRef.current(INTRO_SOURCE);
      setActiveTabRef.current("output");
      schedule(() => {
        if (cancelledRef.current || !playingRef.current) return;
        requestRun();
      }, 0);
    } else {
      setSourceRef.current("");
      setActiveTabRef.current("ast");

      let i = 0;
      const typeNext = () => {
        if (cancelledRef.current || !playingRef.current) return;
        i += 1;
        if (i <= INTRO_SOURCE.length) {
          setSourceRef.current(INTRO_SOURCE.slice(0, i));
          schedule(typeNext, CHAR_MS);
          return;
        }
        schedule(() => {
          if (cancelledRef.current || !playingRef.current) return;
          let tabIdx = 0;
          const nextTab = () => {
            if (cancelledRef.current || !playingRef.current) return;
            const tab = TOUR_TABS[tabIdx];
            if (tab === undefined) {
              requestRun();
              return;
            }
            setActiveTabRef.current(tab);
            tabIdx += 1;
            if (tabIdx < TOUR_TABS.length) {
              schedule(nextTab, TAB_MS);
            } else {
              schedule(() => {
                if (cancelledRef.current || !playingRef.current) return;
                requestRun();
              }, DEBOUNCE_SETTLE_MS);
            }
          };
          nextTab();
        }, DEBOUNCE_SETTLE_MS);
      };
      schedule(typeNext, CHAR_MS);
    }

    return () => {
      window.removeEventListener("keydown", onPointerOrKey, true);
      window.removeEventListener("pointerdown", onPointerOrKey, true);
      clearTimers();
      playingRef.current = false;
    };
    // Intentionally mount-once; APIs are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { playing, skip, interrupt };
}
