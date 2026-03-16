import { C } from "./constants";

export const IcoGlobe = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.tealText : "white"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

export const IcoBrain = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.tealText : "white"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

export const IcoSidebar = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18"/>
    <path d="M3 3h6v18H3z" fill={on ? "white" : "none"} stroke="none"/>
  </svg>
);

export const IcoOpenEditor = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

export const IcoAgents = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.tealText : "white"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="5.5"/>
    <circle cx="12" cy="2" r="1.2" fill={on ? C.tealText : "white"} stroke="none"/>
    <rect x="4.5" y="5.5" width="15" height="11" rx="2.5"/>
    <circle cx="9"  cy="11" r="1.6" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="15" cy="11" r="1.6" fill={on ? C.tealText : "white"} stroke="none"/>
    <line x1="1.5" y1="9.5"  x2="4.5" y2="9.5"/>
    <line x1="19.5" y1="9.5" x2="22.5" y2="9.5"/>
    <line x1="9"  y1="16.5" x2="9"  y2="20"/>
    <line x1="15" y1="16.5" x2="15" y2="20"/>
    <line x1="9"  y1="20"   x2="15" y2="20"/>
  </svg>
);

export const IcoBus = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.tealText : "white"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9.5"/>
    <circle cx="12" cy="12" r="3"/>
    <line x1="12" y1="9"    x2="12" y2="2.5"/>
    <line x1="12" y1="15"   x2="12" y2="21.5"/>
    <line x1="9.4"  y1="10.5" x2="3.5"  y2="6.8"/>
    <line x1="14.6" y1="13.5" x2="20.5" y2="17.2"/>
    <line x1="9.4"  y1="13.5" x2="3.5"  y2="17.2"/>
    <line x1="14.6" y1="10.5" x2="20.5" y2="6.8"/>
    <circle cx="12"   cy="2.5"  r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="12"   cy="21.5" r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="3.5"  cy="6.8"  r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="20.5" cy="17.2" r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="3.5"  cy="17.2" r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
    <circle cx="20.5" cy="6.8"  r="1.3" fill={on ? C.tealText : "white"} stroke="none"/>
  </svg>
);