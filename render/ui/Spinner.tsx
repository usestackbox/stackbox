// ui/Spinner.tsx
import { C } from "../design";

interface Props {
  size?: number;
}

export function Spinner({ size = 16 }: Props) {
  return (
    <>
      <div
        style={{
          width: size,
          height: size,
          border: `2px solid ${C.border}`,
          borderTopColor: C.t1,
          borderRadius: "50%",
          animation: "sb-spin .7s linear infinite",
          flexShrink: 0,
        }}
      />
      <style>{"@keyframes sb-spin { to { transform: rotate(360deg); } }"}</style>
    </>
  );
}
