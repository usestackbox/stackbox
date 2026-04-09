// ui/Scrollable.tsx
interface Props { children: React.ReactNode; style?: React.CSSProperties; className?: string }

export function Scrollable({ children, style, className }: Props) {
  return (
    <>
      <div className={`sb-scroll ${className ?? ""}`} style={{ overflow: "auto", ...style }}>
        {children}
      </div>
      <style>{`
        .sb-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
        .sb-scroll::-webkit-scrollbar-track { background: transparent; }
        .sb-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 3px; }
        .sb-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); }
      `}</style>
    </>
  );
}
