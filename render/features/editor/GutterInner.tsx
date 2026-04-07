// features/editor/GutterInner.tsx
import { useEffect, useRef } from "react";
import { C, MONO } from "../../design";

interface Props {
  lineCount: number;
  lineHeight: number;
  padTop: number;
  padBottom: number;
  gutterWidth: number;
  fontSize: number;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export function GutterInner({
  lineCount,
  lineHeight,
  padTop,
  padBottom,
  fontSize,
  scrollRef,
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const sync = () => {
      if (innerRef.current) innerRef.current.style.transform = `translateY(-${sc.scrollTop}px)`;
    };
    sc.addEventListener("scroll", sync, { passive: true });
    return () => sc.removeEventListener("scroll", sync);
  }, [scrollRef]);

  return (
    <div
      ref={innerRef}
      style={{ paddingTop: padTop, paddingBottom: padBottom, willChange: "transform" }}
    >
      {Array.from({ length: lineCount }, (_, i) => (
        <div
          key={i}
          style={{
            height: lineHeight,
            lineHeight: `${lineHeight}px`,
            paddingRight: 10,
            textAlign: "right",
            fontSize: fontSize - 1,
            fontFamily: MONO,
            color: C.t3,
          }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
