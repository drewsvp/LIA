/**
 * Guards in-app navigation and browser Back while a form has unsaved changes.
 *
 * Strategy overview
 * -----------------
 * pushState / replaceState (wouter <Link> clicks, silent redirects):
 *   Patched to store the intended call and return early. The caller renders a
 *   custom dialog; confirmLeave replays the stored call and dispatches a popstate
 *   so wouter re-renders to the target route.
 *
 * Browser Back (popstate):
 *   Two mechanisms combine to make this reliable:
 *
 *   (a) Sentinel entry — when isDirty first becomes true, we overwrite the
 *       current history entry's state (via replaceState, not pushState) to
 *       mark it as the guard sentinel. No new entry is added, so any Back
 *       press goes directly to the actual prior page. go(+1) in the handler
 *       reliably restores the cursor to this sentinel entry.
 *
 *   (b) Capture-phase listener — registered with `{ capture: true }`, so it
 *       runs before wouter's bubble-phase popstate listener. Calling
 *       stopPropagation() here prevents wouter from seeing the Back event,
 *       which would otherwise unmount the edit form before the user responds.
 *
 *   On confirm Leave: go(-1) moves from the sentinel back to the entry that
 *   the Back press was targeting. Our capture listener is already removed by
 *   tearDown, so wouter picks up the resulting popstate normally.
 *
 * beforeunload (hard refresh, tab/window close):
 *   A beforeunload listener triggers the browser's native "Leave site?" prompt.
 *
 * When isDirty becomes false all patches, listeners, and the block state are
 * cleared. The sentinel state written via replaceState remains on the current
 * history entry but is harmless — the URL is unchanged and wouter ignores it.
 */
import { useEffect, useRef, useState } from "react";

type StoredNav =
  | {
      method: "pushState" | "replaceState";
      state: unknown;
      unused: string;
      url: string | URL | null | undefined;
    }
  | { method: "popstate"; state: unknown };

export function useNavigationGuard(isDirty: boolean): {
  blocked: boolean;
  confirmLeave: () => void;
  cancelLeave: () => void;
} {
  const [blocked, setBlocked] = useState(false);
  const pendingNav = useRef<StoredNav | null>(null);
  const origPushState = useRef<typeof history.pushState | null>(null);
  const origReplaceState = useRef<typeof history.replaceState | null>(null);
  const popstateHandler = useRef<((e: PopStateEvent) => void) | null>(null);
  const beforeUnloadHandler = useRef<((e: BeforeUnloadEvent) => void) | null>(null);
  // Flip to true immediately before calling go(+1) for sentinel restoration so
  // the resulting popstate event is silently discarded by our capture handler.
  const suppressNextPopstate = useRef(false);

  function restoreHistoryMethods() {
    if (origPushState.current) {
      window.history.pushState = origPushState.current;
      origPushState.current = null;
    }
    if (origReplaceState.current) {
      window.history.replaceState = origReplaceState.current;
      origReplaceState.current = null;
    }
  }

  function removeListeners() {
    if (popstateHandler.current) {
      // Must pass the same `capture: true` flag used on addEventListener.
      window.removeEventListener("popstate", popstateHandler.current, true);
      popstateHandler.current = null;
    }
    if (beforeUnloadHandler.current) {
      window.removeEventListener("beforeunload", beforeUnloadHandler.current);
      beforeUnloadHandler.current = null;
    }
  }

  function tearDown() {
    restoreHistoryMethods();
    removeListeners();
    suppressNextPopstate.current = false;
  }

  useEffect(() => {
    if (!isDirty) {
      tearDown();
      setBlocked(false);
      pendingNav.current = null;
      return;
    }

    // Capture originals before patching so we can restore them and use them
    // directly in confirmLeave / the popstate handler.
    const originalPush = window.history.pushState.bind(window.history);
    origPushState.current = originalPush;
    const originalReplace = window.history.replaceState.bind(window.history);
    origReplaceState.current = originalReplace;

    // Mark the current entry as the sentinel by overwriting its state via
    // replaceState. Unlike pushState, this does NOT add a new history entry —
    // the cursor stays at the same position. The consequence is that any Back
    // press while dirty goes directly to the true prior page, so go(-1) on
    // confirm Leave reaches exactly the intended destination.
    originalReplace({ __navGuard: true }, "", window.location.href);

    // Intercept pushState — covers every wouter <Link> click.
    window.history.pushState = function (
      state: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      pendingNav.current = { method: "pushState", state, unused, url };
      setBlocked(true);
    };

    // Intercept replaceState — covers silent router redirects.
    window.history.replaceState = function (
      state: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      pendingNav.current = { method: "replaceState", state, unused, url };
      setBlocked(true);
    };

    // Capture-phase listener — fires before wouter's bubble-phase listener.
    // stopPropagation() prevents wouter from seeing the Back event and
    // unmounting the edit form before the user has responded to the dialog.
    const handlePopState = (e: PopStateEvent) => {
      if (suppressNextPopstate.current) {
        suppressNextPopstate.current = false;
        // Do NOT stop propagation here: this is the restoration go(+1) event.
        // Wouter seeing it re-renders to the same URL (sentinel), which is a
        // no-op for the visible page and keeps wouter's location state correct.
        return;
      }
      // Prevent ALL other listeners on window — including wouter's popstate
      // subscription — from receiving this Back event. stopPropagation() only
      // stops traversal through the DOM tree; stopImmediatePropagation() is
      // needed to silence other listeners registered on the same target.
      e.stopImmediatePropagation();
      // Undo the Back: go forward one step to return to the sentinel.
      suppressNextPopstate.current = true;
      window.history.go(1);
      pendingNav.current = { method: "popstate", state: e.state };
      setBlocked(true);
    };
    popstateHandler.current = handlePopState;
    window.addEventListener("popstate", handlePopState, true); // capture phase

    // Native "Leave site?" prompt for hard refresh and tab/window close.
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    beforeUnloadHandler.current = handleBeforeUnload;
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      tearDown();
    };
  }, [isDirty]);

  function confirmLeave() {
    // Remove all patches and listeners first so the replayed navigation is not
    // intercepted again by our own handlers.
    tearDown();
    const nav = pendingNav.current;
    pendingNav.current = null;
    setBlocked(false);

    if (!nav) return;

    if (nav.method === "popstate") {
      // History layout at this point:
      //   [..., destination(N-1), sentinel(N=current)]
      // The sentinel entry IS the /admin/requests entry (replaceState, no new
      // entry). go(-1) moves from N to N-1, landing on the true Back destination.
      // Our capture listener is already removed by tearDown so wouter sees
      // this popstate normally and re-renders to the target route.
      window.history.go(-1);
    } else if (nav.method === "pushState") {
      window.history.pushState(nav.state, nav.unused, nav.url);
      // Dispatch popstate so wouter's location subscription re-renders to the
      // target route (pushState alone does not fire popstate).
      window.dispatchEvent(new PopStateEvent("popstate", { state: nav.state }));
    } else {
      window.history.replaceState(nav.state, nav.unused, nav.url);
      window.dispatchEvent(new PopStateEvent("popstate", { state: nav.state }));
    }
  }

  function cancelLeave() {
    // go(+1) has already restored the cursor to the sentinel entry; the URL
    // and wouter's location are correct. Just clear the stored intent.
    pendingNav.current = null;
    setBlocked(false);
  }

  return { blocked, confirmLeave, cancelLeave };
}
