// render/features/onboarding/OnboardingFlow.tsx
import { C, SANS } from "../../design";
import { StepCreateWorkspace } from "./StepCreateWorkspace";
import { StepWelcome } from "./StepWelcome";
import { useOnboarding } from "./useOnboarding";
import type { Runbox } from "../../types/runbox";

interface Props {
  runboxes: Runbox[];
  onCreate: (name: string, cwd: string) => void;
}

export function OnboardingFlow({ runboxes, onCreate }: Props) {
  const ob = useOnboarding();

  // Already have workspaces — never show onboarding
  if (runboxes.length > 0) return null;
  if (ob.complete) return null;

  const handleCreate = (name: string, cwd: string) => {
    onCreate(name, cwd);
    ob.finish();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 20000, fontFamily: SANS,
      }}
    >
      <div
        style={{
          width: 440,
          background: C.bg2,
          border: `1px solid ${C.borderMd}`,
          borderRadius: C.r5,
          boxShadow: C.shadowXl,
          overflow: "hidden",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 2, background: C.bg4 }}>
          <div
            style={{
              height: "100%",
              width: `${((ob.stepIndex + 1) / ob.totalSteps) * 100}%`,
              background: C.violet,
              transition: "width .35s ease",
            }}
          />
        </div>

        {/* Step */}
        <div style={{ padding: "32px 36px 28px" }}>
          {ob.step === "welcome"          && <StepWelcome onNext={ob.next} />}
          {ob.step === "create-workspace" && <StepCreateWorkspace onFinish={handleCreate} />}
        </div>

        {/* Dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, paddingBottom: 20 }}>
          {Array.from({ length: ob.totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === ob.stepIndex ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === ob.stepIndex ? C.violet : C.bg5,
                transition: "width .2s, background .2s",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}