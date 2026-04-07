// render/features/onboarding/useOnboarding.ts
import { useCallback, useState } from "react";

export type OnboardingStep = "welcome" | "git-setup" | "docker-check" | "mcp-setup" | "done";

const STEPS: OnboardingStep[] = ["welcome", "git-setup", "docker-check", "mcp-setup", "done"];

const LS_COMPLETE = "stackbox:onboarding:complete";
const LS_STEP = "stackbox:onboarding:step";

export function useOnboarding() {
  const [complete, setComplete] = useState(() => localStorage.getItem(LS_COMPLETE) === "true");
  const [step, setStepState] = useState<OnboardingStep>(
    () => (localStorage.getItem(LS_STEP) as OnboardingStep) ?? "welcome"
  );

  const setStep = useCallback((s: OnboardingStep) => {
    setStepState(s);
    localStorage.setItem(LS_STEP, s);
  }, []);

  const next = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]);
    }
  }, [step, setStep]);

  const finish = useCallback(() => {
    localStorage.setItem(LS_COMPLETE, "true");
    setComplete(true);
  }, []);

  const restart = useCallback(() => {
    localStorage.removeItem(LS_COMPLETE);
    localStorage.removeItem(LS_STEP);
    setComplete(false);
    setStepState("welcome");
  }, []);

  const stepIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length - 1; // don't count "done" in progress

  return { complete, step, next, finish, restart, setStep, stepIndex, totalSteps };
}
