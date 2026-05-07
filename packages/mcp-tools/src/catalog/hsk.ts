import { z } from 'zod';

/**
 * Housekeeping MCP tool catalog. Sprint 4 W4.
 *
 * Mismo contrato que fo.ts: tool id snake_case, descripcion accionable,
 * Zod schema validado antes de invocar el handler. Las tools mutating
 * requieren confirmacion humana antes de ejecutar (ADR-020); ninguna es
 * financial.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const taskType = z.enum(['CHECKOUT_CLEAN', 'STAYOVER_CLEAN', 'INSPECTION', 'MAINTENANCE']);

export const hskAssignTaskInput = z.object({
  propertyId: z.string().uuid(),
  roomId: z.string().uuid(),
  businessDate: isoDate,
  taskType: taskType.default('CHECKOUT_CLEAN'),
  assignedToUserId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export type HskAssignTaskInput = z.infer<typeof hskAssignTaskInput>;

export const hskStartTaskInput = z.object({
  taskId: z.string().uuid(),
});
export type HskStartTaskInput = z.infer<typeof hskStartTaskInput>;

export const hskCompleteTaskInput = z.object({
  taskId: z.string().uuid(),
  resultingRoomStatus: z
    .enum(['CLEAN', 'INSPECTED', 'DIRTY', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])
    .optional(),
  notes: z.string().max(2000).optional(),
});
export type HskCompleteTaskInput = z.infer<typeof hskCompleteTaskInput>;

export const hskListTodayInput = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate.optional(),
  assignedToUserId: z.string().uuid().optional(),
});
export type HskListTodayInput = z.infer<typeof hskListTodayInput>;

export const hskSuggestAssignmentsInput = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate.optional(),
  // Lista opcional de camareras candidatas; si se omite el servicio infiere
  // las del dia (cualquiera con tareas asignadas en businessDate).
  candidateUserIds: z.array(z.string().uuid()).optional(),
  // Capacidad estimada por camarera en minutos. Default: 8h * 0.6 = 290 min
  // (productividad real en turno con descansos + tareas auxiliares).
  shiftCapacityMin: z.coerce.number().int().min(60).max(720).default(290),
  // Ventana de historico para calcular la mediana de durationMin por
  // (taskType, roomTypeId). 30 dias es razonable para hoteles boutique.
  lookbackDays: z.coerce.number().int().min(7).max(180).default(30),
});
export type HskSuggestAssignmentsInput = z.infer<typeof hskSuggestAssignmentsInput>;

export interface HskToolMeta {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  mutating: boolean;
  financial: boolean;
}

export const hskToolCatalog = {
  hsk_assign_task: {
    name: 'hsk_assign_task',
    description:
      'Crea (o reusa) una tarea de housekeeping para (property, businessDate, room, taskType). Idempotente: re-invocar con los mismos parametros devuelve la misma tarea.',
    inputSchema: hskAssignTaskInput,
    mutating: true,
    financial: false,
  },
  hsk_start_task: {
    name: 'hsk_start_task',
    description:
      'Inicia una tarea (PENDING -> IN_PROGRESS), fija startedAt y emite housekeeping.task_started. Idempotente sobre IN_PROGRESS.',
    inputSchema: hskStartTaskInput,
    mutating: true,
    financial: false,
  },
  hsk_complete_task: {
    name: 'hsk_complete_task',
    description:
      'Cierra una tarea IN_PROGRESS, calcula durationMin y opcionalmente transiciona el room status. Emite housekeeping.task_completed.',
    inputSchema: hskCompleteTaskInput,
    mutating: true,
    financial: false,
  },
  hsk_list_today: {
    name: 'hsk_list_today',
    description:
      'Lista las tareas del dia operacional (businessDate; default hoy) para una propiedad, opcionalmente filtradas por camarera. Read-only.',
    inputSchema: hskListTodayInput,
    mutating: false,
    financial: false,
  },
  hsk_suggest_assignments: {
    name: 'hsk_suggest_assignments',
    description:
      'Sugiere una asignacion de tareas HSK del dia a las camareras disponibles, balanceando carga y duracion predicha. Read-only — el supervisor confirma para aplicar (ADR-020).',
    inputSchema: hskSuggestAssignmentsInput,
    mutating: false,
    financial: false,
  },
} as const satisfies Record<string, HskToolMeta>;

export type HskToolName = keyof typeof hskToolCatalog;
