// render/hooks/useClickOutside.ts
// Close dropdowns/modals when clicking outside a ref'd element.

import { type RefObject, useEffect } from "react";

/**
 * Calls `handler` when a pointer event fires outside of `ref`.
 * Attach the ref to the container you want to guard.
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  handler: (e: MouseEvent | TouchEvent) => void,
  { enabled = true }: { enabled?: boolean } = {}
) {
  useEffect(() => {
    if (!enabled) return;

    const listener = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      handler(e);
    };

    // Use mousedown / touchstart so the handler fires before click.
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler, enabled]);
}
