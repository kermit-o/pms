import { Logger } from '@nestjs/common';
import { NightAuditStep } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

/**
 * Sprint 3 W1 ships POST_ROOM_CHARGES + CLOSE_DAY end-to-end. The remaining
 * steps land in W2-W4. They register here as no-op runners with explicit
 * `skipped: true` so the orchestrator already wires them and the run row
 * shows the full step list — only the bodies are pending.
 */

const log = new Logger('NightAuditStubStep');

class StubStep implements StepRunner {
  constructor(public readonly step: NightAuditStep) {}
  async run(ctx: StepContext): Promise<StepResult> {
    log.warn(
      `step ${this.step} not implemented yet (Sprint 3 W2-W4); skipping for ${ctx.propertyId} ${ctx.businessDate}`,
    );
    return { result: { skipped: true, reason: 'not implemented' } };
  }
}

export const PostTaxesStep = new StubStep(NightAuditStep.POST_TAXES);
export const PostPackagesStep = new StubStep(NightAuditStep.POST_PACKAGES);
export const MarkNoShowsStep = new StubStep(NightAuditStep.MARK_NO_SHOWS);
export const SnapshotReportsStep = new StubStep(NightAuditStep.SNAPSHOT_REPORTS);
