// hooks/useWindowManager.ts
// All floating-window state: tiling, drag, resize, minimize, maximize.
// Extracted from WorkspaceView.tsx (was deeply embedded in the render function).

import { useCallback, useRef, useState } from "react";

export interface WinState {
  id: string;
  label: string;
  kind: "terminal" | "browser";
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  preMaxX?: number;
  preMaxY?: number;
  preMaxW?: number;
  preMaxH?: number;
  cwd: string;
  zIndex: number;
}

const GAP = 8;
const MIN_W = 280;
const MIN_H = 180;

let _topZ = 10;
const nextZ = () => ++_topZ;

function tileWindows(count: number, aw: number, ah: number) {
  if (count === 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = Math.floor((aw - GAP * (cols + 1)) / cols);
  const h = Math.floor((ah - GAP * (rows + 1)) / rows);
  return Array.from({ length: count }, (_, i) => ({
    x: GAP + (i % cols) * (w + GAP),
    y: GAP + Math.floor(i / cols) * (h + GAP),
    w,
    h,
  }));
}

export function useWindowManager(initialCwd: string, areaRef: React.RefObject<HTMLDivElement>) {
  const [wins, setWins] = useState<WinState[]>([]);
  const [activeWinId, setActiveWinId] = useState<string | null>(null);
  const labelCount = useRef(0);
  const winsRef = useRef<WinState[]>([]);

  // Keep ref in sync for use inside event handlers
  winsRef.current = wins;

  const focusWin = useCallback((id: string) => {
    setActiveWinId(id);
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, zIndex: nextZ() } : w)));
  }, []);

  const initFirstWindow = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const aw = area.offsetWidth || 800;
    const ah = area.offsetHeight || 600;
    labelCount.current = 1;
    const id = crypto.randomUUID();
    setWins([
      {
        id,
        label: "w1",
        kind: "terminal",
        x: GAP,
        y: GAP,
        w: aw - GAP * 2,
        h: ah - GAP * 2,
        minimized: false,
        maximized: false,
        cwd: initialCwd,
        zIndex: nextZ(),
      },
    ]);
    setActiveWinId(id);
  }, [initialCwd, areaRef]);

  const addTerminal = useCallback(
    (cwd: string) => {
      const area = areaRef.current;
      if (!area) return;
      const { offsetWidth: aw, offsetHeight: ah } = area;
      labelCount.current += 1;
      const id = crypto.randomUUID();
      setWins((prev) => {
        const all: WinState[] = [
          ...prev,
          {
            id,
            label: `w${labelCount.current}`,
            kind: "terminal",
            x: 0,
            y: 0,
            w: 400,
            h: 300,
            minimized: false,
            maximized: false,
            cwd,
            zIndex: nextZ(),
          },
        ];
        const visible = all.filter((w) => !w.minimized && !w.maximized);
        const tiles = tileWindows(visible.length, aw, ah);
        let ti = 0;
        return all.map((w) => (w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] }));
      });
      setActiveWinId(id);
    },
    [areaRef]
  );

  const closeWin = useCallback(
    (id: string) => {
      const area = areaRef.current;
      setWins((prev) => {
        const next = prev.filter((w) => w.id !== id);
        if (next.length === 0) {
          labelCount.current = 0;
          return next;
        }
        if (area) {
          const { offsetWidth: aw, offsetHeight: ah } = area;
          const visible = next.filter((w) => !w.minimized && !w.maximized);
          const tiles = tileWindows(visible.length, aw, ah);
          let ti = 0;
          return next.map((w) => (w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] }));
        }
        return next;
      });
      setActiveWinId((prev) => {
        if (prev !== id) return prev;
        const remaining = winsRef.current.filter((w) => !w.minimized && w.id !== id);
        if (remaining.length > 0) {
          setTimeout(() => setActiveWinId(remaining[remaining.length - 1].id), 0);
        }
        return null;
      });
    },
    [areaRef]
  );

  const minimizeWin = useCallback((id: string) => {
    setWins((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized)
          return {
            ...w,
            maximized: false,
            x: w.preMaxX ?? GAP,
            y: w.preMaxY ?? GAP,
            w: w.preMaxW ?? 400,
            h: w.preMaxH ?? 300,
          };
        return { ...w, minimized: true };
      })
    );
    setActiveWinId((prev) => (prev === id ? null : prev));
  }, []);

  const restoreWin = useCallback((id: string) => {
    setWins((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: false, zIndex: nextZ() } : w))
    );
    setActiveWinId(id);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }, []);

  const maximizeWin = useCallback(
    (id: string) => {
      const area = areaRef.current;
      if (!area) return;
      setWins((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w;
          if (w.maximized)
            return {
              ...w,
              maximized: false,
              x: w.preMaxX ?? GAP,
              y: w.preMaxY ?? GAP,
              w: w.preMaxW ?? 400,
              h: w.preMaxH ?? 300,
            };
          return {
            ...w,
            maximized: true,
            preMaxX: w.x,
            preMaxY: w.y,
            preMaxW: w.w,
            preMaxH: w.h,
            x: 0,
            y: 0,
            w: area.offsetWidth,
            h: area.offsetHeight,
            zIndex: nextZ(),
          };
        })
      );
      setActiveWinId(id);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
    },
    [areaRef]
  );

  const moveTab = useCallback((id: string, dir: "left" | "right") => {
    setWins((prev) => {
      const arr = [...prev];
      const idx = arr.findIndex((w) => w.id === id);
      if (idx < 0) return prev;
      const newIdx = dir === "left" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      focusWin(id);
      const win = winsRef.current.find((w) => w.id === id);
      if (!win || win.maximized) return;
      const areaRect = areaRef.current?.getBoundingClientRect();
      if (!areaRect) return;
      const offX = e.clientX - areaRect.left - win.x;
      const offY = e.clientY - areaRect.top - win.y;

      const onMove = (ev: MouseEvent) => {
        const rect = areaRef.current?.getBoundingClientRect();
        if (!rect) return;
        setWins((prev) => {
          const cur = prev.find((w) => w.id === id);
          if (!cur) return prev;
          const nx = Math.max(0, Math.min(rect.width - cur.w, ev.clientX - rect.left - offX));
          const ny = Math.max(0, Math.min(rect.height - cur.h, ev.clientY - rect.top - offY));
          return prev.map((w) => (w.id === id ? { ...w, x: nx, y: ny } : w));
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [focusWin, areaRef]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, id: string, dir: string) => {
      e.preventDefault();
      focusWin(id);
      const win = winsRef.current.find((w) => w.id === id);
      if (!win || win.maximized) return;
      const {
        x: startX,
        y: startY,
        x: origX,
        y: origY,
        w: origW,
        h: origH,
      } = { ...win, x: e.clientX, y: e.clientY };

      const onMove = (ev: MouseEvent) => {
        const area = areaRef.current;
        const aw = area?.getBoundingClientRect().width ?? 9999;
        const ah = area?.getBoundingClientRect().height ?? 9999;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let nx = origX;
        let ny = origY;
        let nw = origW;
        let nh = origH;
        if (dir.includes("r")) nw = Math.min(aw - origX, Math.max(MIN_W, origW + dx));
        if (dir.includes("l")) {
          nw = Math.max(MIN_W, origW - dx);
          nx = origX + (origW - nw);
          if (nx < 0) {
            nw += nx;
            nx = 0;
          }
        }
        if (dir.includes("b")) nh = Math.min(ah - origY, Math.max(MIN_H, origH + dy));
        if (dir.includes("t")) {
          nh = Math.max(MIN_H, origH - dy);
          ny = origY + (origH - nh);
          if (ny < 0) {
            nh += ny;
            ny = 0;
          }
        }
        setWins((prev) =>
          prev.map((w) => (w.id === id ? { ...w, x: nx, y: ny, w: nw, h: nh } : w))
        );
      };
      const onUp = () => {
        window.dispatchEvent(new Event("resize"));
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [focusWin, areaRef]
  );

  const retile = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const { offsetWidth: aw, offsetHeight: ah } = area;
    if (!aw || !ah) return;
    setWins((prev) => {
      const visible = prev.filter((w) => !w.minimized && !w.maximized);
      if (visible.length === 0) return prev;
      const tiles = tileWindows(visible.length, aw, ah);
      let ti = 0;
      return prev.map((w) => (w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] }));
    });
    window.dispatchEvent(new Event("resize"));
  }, [areaRef]);

  return {
    wins,
    setWins,
    activeWinId,
    setActiveWinId,
    focusWin,
    initFirstWindow,
    addTerminal,
    closeWin,
    minimizeWin,
    restoreWin,
    maximizeWin,
    moveTab,
    handleDragStart,
    handleResizeStart,
    retile,
  };
}
