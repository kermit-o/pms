import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  type HskAssignTaskInput,
  type HskCompleteTaskInput,
  type HskListTodayInput,
  type HskStartTaskInput,
  type HskToolName,
  hskToolCatalog,
} from '@pms/mcp-tools';
import type { AuthUser } from '../auth';
import { HousekeepingTasksService } from './tasks.service';

/**
 * HSK MCP tool router. Sprint 4 W4.
 *
 * Cada tool re-valida su input via Zod (defence in depth contra outputs raros
 * del LLM) y delega en HousekeepingTasksService. tenantId siempre viene del
 * JWT del operador humano — nunca del LLM. Las mutating requieren que
 * CopilotService gestione confirmacion (mismo patron que FO, ADR-020).
 */
@Injectable()
export class HskToolRouter {
  private readonly log = new Logger(HskToolRouter.name);

  constructor(private readonly tasks: HousekeepingTasksService) {}

  isMutating(name: HskToolName): boolean {
    return hskToolCatalog[name].mutating;
  }

  async execute(
    name: HskToolName,
    rawInput: unknown,
    user: AuthUser,
    correlationId: string,
  ): Promise<unknown> {
    const meta = hskToolCatalog[name];
    if (!meta) {
      throw new ForbiddenException(`Unknown tool: ${name}`);
    }
    const input = meta.inputSchema.parse(rawInput);

    switch (name) {
      case 'hsk_assign_task': {
        const i = input as HskAssignTaskInput;
        return this.tasks.create(user, correlationId, {
          propertyId: i.propertyId,
          roomId: i.roomId,
          businessDate: i.businessDate,
          taskType: i.taskType,
          assignedToUserId: i.assignedToUserId,
          notes: i.notes,
        });
      }
      case 'hsk_start_task': {
        const i = input as HskStartTaskInput;
        return this.tasks.start(user, correlationId, i.taskId);
      }
      case 'hsk_complete_task': {
        const i = input as HskCompleteTaskInput;
        return this.tasks.complete(user, correlationId, i.taskId, {
          resultingRoomStatus: i.resultingRoomStatus,
          notes: i.notes,
        });
      }
      case 'hsk_list_today': {
        const i = input as HskListTodayInput;
        const date = i.businessDate ?? new Date().toISOString().slice(0, 10);
        return this.tasks.list(user, correlationId, {
          propertyId: i.propertyId,
          assignedToUserId: i.assignedToUserId,
          from: date,
          to: date,
          limit: 100,
        });
      }
    }
  }
}
