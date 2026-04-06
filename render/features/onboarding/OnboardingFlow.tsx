// render/features/onboarding/OnboardingFlow.tsx
import { C, SANS } from "../../design";
import { useOnboarding } from "./useOnboarding";
import { StepWelcome }    from "./StepWelcome";
import { StepGitSetup }   from "./StepGitSetup";
import { StepDockerCheck }from "./StepDockerCheck";
import { StepMCPSetup }   from "./StepMCPSetup";
import { StepDone }       from "./StepDone";

export function OnboardingFlow() {
  const ob = useOnboarding();

  if (ob.complete) return null;

  return (
    <div style={{
      position:       "fixed",
      inset:          0,
      background:     "rgba(0,0,0,.88)",
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      zIndex:         20000,
      fontFamily:     SANS,
    }}>
      {/* Card */}
      <div style={{
        width:        520,
        background:   C.bg3,
        border:       `1px solid ${C.border}`,
        borderRadius: 14,
        boxShadow:    C.shadowXl,
        overflow:     "hidden",
      }}>
        {/* Progress bar — only show before "done" step */}
        {ob.step !== "done" && (
          <div style={{ height: 3, background: C.bg2 }}>
            <div style={{
              height:     "100%",
              width:      `${(ob.stepIndex / ob.totalSteps) * 100}%`,
              background: C.blue,
              transition: "width .35s cubic-bezier(.4,0,.2,1)",
            }} />
          </div>
        )}

        {/* Step content */}
        <div style={{ padding: "32px 36px 28px" }}>
          {ob.step === "welcome"      && <StepWelcome    onNext={ob.next} />}
          {ob.step === "git-setup"    && <StepGitSetup   onNext={ob.next} />}
          {ob.step === "docker-check" && <StepDockerCheck onNext={ob.next} />}
          {ob.step === "mcp-setup"    && <StepMCPSetup   onNext={ob.next} />}
          {ob.step === "done"         && <StepDone        onFinish={ob.finish} />}
        </div>

        {/* Step indicator dots */}
        {ob.step !== "done" && (
          <div style={{
            display:        "flex",
            justifyContent: "center",
            gap:            6,
            paddingBottom:  20,
          }}>
            {Array.from({ length: ob.totalSteps }).map((_, i) => (
              <div
                key={i}
                style={{
                  width:        i === ob.stepIndex ? 16 : 6,
                  height:       6,
                  borderRadius: 3,
                  background:   i === ob.stepIndex ? C.blue : C.bg5,
                  transition:   "width .2s, background .2s",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
