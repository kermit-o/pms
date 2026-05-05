import { z } from 'zod';
import { withTenant, type PrismaClient } from '@pms/db';
import type { ToolDefinition } from '../types';

/**
 * Tool MCP de ejemplo. Demuestra el patron canonico:
 *   - inputSchema vacio (esta tool no toma argumentos).
 *   - handler envuelve la consulta en withTenant() para que RLS aplique
 *     y el audit trigger registre actor_id/correlation_id.
 *   - retorna datos serializables.
 */
export function makeGetTenantInfoTool(prisma: PrismaClient): ToolDefinition {
  return {
    name: 'get_tenant_info',
    description:
      "Returns the current tenant's basic info: id, slug, name, status, createdAt, and the count of active properties. Uses the tenant context from the MCP session.",
    inputSchema: z.object({}),
    handler: async (_input, ctx) => {
      return withTenant(prisma, ctx, async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            createdAt: true,
          },
        });
        if (!tenant) {
          throw new Error(`Tenant not found: ${ctx.tenantId}`);
        }
        const propertiesCount = await tx.property.count({ where: { deletedAt: null } });
        return { ...tenant, propertiesCount };
      });
    },
  };
}
