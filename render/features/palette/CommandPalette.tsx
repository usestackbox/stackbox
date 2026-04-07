// render/features/palette/CommandPalette.tsx
// ⌘K fuzzy-search over workspaces, files, git actions, settings.
// Rendered as a portal so it floats above everything.

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FS, SANS, SP } from "../../design/tokens";
import { PaletteItem } from "./PaletteItem";
import { usePalette } from "./usePalette";

const MAX_RESULTS = 12;

export function CommandPalette() {
  const { open, query, setQuery, results, closePalette, run } = usePalette();
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset active index when results change.
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  // Focus input when palette opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const visible = results.slice(0, MAX_RESULTS);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = visible[activeIdx];
        if (action) run(action);
      }
    },
    [visible, activeIdx, run]
  );

  // Scroll active item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onMouseDown={closePalette}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.55)",
          backdropFilter: "blur(2px)",
          zIndex: 900,
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-label="Command Palette"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "18%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          background: C.bg3,
          border: `1px solid ${C.borderMd}`,
          borderRadius: C.r4,
          boxShadow: C.shadowXl,
          zIndex: 901,
          overflow: "hidden",
          fontFamily: SANS,
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: SP[3],
            padding: `${SP[3]}px ${SP[4]}px`,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={C.t2}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            spellCheck={false}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.t0,
              fontSize: FS.base,
              caretColor: C.blue,
            }}
          />
          {query && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery("");
                inputRef.current?.focus();
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.t2,
                padding: `0 ${SP[1]}px`,
                fontSize: FS.md,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
          <kbd
            style={{
              fontSize: FS.xs,
              color: C.t2,
              background: C.bg4,
              border: `1px solid ${C.border}`,
              borderRadius: C.r1,
              padding: `2px ${SP[2]}px`,
              fontFamily: "monospace",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            maxHeight: "min(420px, 60vh)",
            overflowY: "auto",
            padding: `${SP[2]}px`,
          }}
        >
          {visible.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: C.t2,
                fontSize: FS.sm,
                padding: `${SP[8]}px 0`,
              }}
            >
              No results for <em>"{query}"</em>
            </div>
          ) : (
            visible.map((action, i) => (
              <div key={action.id} data-active={i === activeIdx ? "true" : undefined}>
                <PaletteItem
                  action={action}
                  active={i === activeIdx}
                  onSelect={() => run(action)}
                  onHover={() => setActiveIdx(i)}
                />
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            gap: SP[4],
            padding: `${SP[2]}px ${SP[4]}px`,
            borderTop: `1px solid ${C.border}`,
            color: C.t3,
            fontSize: FS.xs,
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          {results.length > MAX_RESULTS && (
            <span style={{ marginLeft: "auto" }}>
              {results.length - MAX_RESULTS} more — keep typing
            </span>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
