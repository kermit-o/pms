/**
 * Sprint 13 W3 — Stepper visual del wizard de onboarding.
 *
 * Server component puro: pintado del progreso 1/2/3 con el paso activo
 * resaltado. Sin estado cliente, sin libs.
 */
export type OnboardingStep = 'email' | 'setup' | 'done';

const STEPS: Array<{ key: OnboardingStep; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'setup', label: 'Hotel' },
  { key: 'done', label: 'Listo' },
];

export function OnboardingStepper({ current }: { current: OnboardingStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Onboarding progress" className="flex items-center gap-2 text-[11px]">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentIdx;
        const isDone = idx < currentIdx;
        const circle = isDone
          ? 'bg-aubergine-700 text-white'
          : isActive
            ? 'bg-aubergine-700 text-white ring-2 ring-aubergine-200'
            : 'bg-aubergine-50 text-aubergine-500';
        const labelCls = isActive
          ? 'font-semibold text-aubergine-700'
          : isDone
            ? 'text-aubergine-700/70'
            : 'text-aubergine-500/60';
        return (
          <div key={step.key} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${circle}`}
              aria-current={isActive ? 'step' : undefined}
            >
              {isDone ? '✓' : idx + 1}
            </span>
            <span className={`uppercase tracking-wide ${labelCls}`}>{step.label}</span>
            {idx < STEPS.length - 1 && (
              <span
                className={`h-px w-6 ${idx < currentIdx ? 'bg-aubergine-700' : 'bg-aubergine-100'}`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
