// render/features/onboarding/useOnboarding.ts
import { useCallback, useState } from "react";

export type OnboardingStep = "welcome" | "create-workspace";

const STEPS: OnboardingStep[] = ["welcome", "create-workspace"];

const LS_COMPLETE = "calus:onboarding:complete";
const LS_STEP     = "calus:onboarding:step";

export function useOnboarding() {
  const [complete, setComplete] = useState(() => localStorage.getItem(LS_COMPLETE) === "true");
  const [step, setStepState]    = useState<OnboardingStep>(() => {
    const saved = localStorage.getItem(LS_STEP) as OnboardingStep | null;
    // Guard against stale values from old multi-step flow
    return saved && STEPS.includes(saved) ? saved : "welcome";
  });

  const setStep = useCallback((s: OnboardingStep) => {
    setStepState(s);
    localStorage.setItem(LS_STEP, s);
  }, []);

  const next = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }, [step, setStep]);

  const finish = useCallback(() => {
    localStorage.setItem(LS_COMPLETE, "true");
    localStorage.removeItem(LS_STEP);
    setComplete(true);
  }, []);

  const restart = useCallback(() => {
    localStorage.removeItem(LS_COMPLETE);
    localStorage.removeItem(LS_STEP);
    setComplete(false);
    setStepState("welcome");
  }, []);

  const stepIndex  = STEPS.indexOf(step);
  const totalSteps = STEPS.length;

  return { complete, step, next, finish, restart, setStep, stepIndex, totalSteps };
}