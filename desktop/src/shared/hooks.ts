import { useState, useRef, useCallback } from "react";

export function useDragResize(
  init: number,
  dir: "left" | "right" = "left",
  min = 180,
  max = 680,
) {
  const [w, setW] = useState(init);
  const ref = useRef<{ sx: number; sw: number } | null>(null);

  const onDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      ref.current = { sx: e.clientX, sw: w };
      const onMove = (ev: MouseEvent) => {
        if (!ref.current) return;
        const d = ev.clientX - ref.current.sx;
        setW(Math.max(min, Math.min(max, ref.current.sw + (dir === "right" ? d : -d))));
      };
      const onUp = () => {
        ref.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [w, dir, min, max],
  );

  return [w, onDown] as const;
}