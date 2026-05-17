import { ForbiddenException, Injectable } from '@nestjs/common';
import { type FoToolName, type HskToolName, foToolCatalog, hskToolCatalog } from '@pms/mcp-tools';
import type { AuthUser } from '../auth';
import { HskToolRouter } from '../housekeeping';
import { FoToolRouter } from './tool-router';

/**
 * Resolver unico para tools del copilot. Sprint 5 W5.
 *
 * Dado un name (`hsk_*` o no), enruta al `HskToolRouter` o `FoToolRouter`
 * correspondiente. Esto permite al `CopilotService` operar sobre cualquier
 * dominio sin saber a quien delegar.
 *
 * Convencion: los tools HSK arrancan con prefijo `hsk_` (estable en el
 * catalogo); el resto cae en FO. Si en V2 anadimos otros dominios (NA,
 * compliance) se anaden mas branches.
 *
 * Las metas (mutating/financial/description/inputSchema) vienen del
 * catalogo correspondiente.
 */
export type AnyToolName = FoToolName | HskToolName;

export interface ToolMeta {
  name: string;
  description: string;
  mutating: boolean;
  financial: boolean;
}

@Injectable()
export class ToolResolver {
  constructor(
    private readonly fo: FoToolRouter,
    private readonly hsk: HskToolRouter,
  ) {}

  /** True si el nombre existe en alguno de los catalogos. */
  has(name: string): name is AnyToolName {
    return name in foToolCatalog || name in hskToolCatalog;
  }

  domain(name: AnyToolName): 'fo' | 'hsk' {
    return name in hskToolCatalog ? 'hsk' : 'fo';
  }

  getMeta(name: AnyToolName): ToolMeta {
    if (name in hskToolCatalog) {
      const m = hskToolCatalog[name as HskToolName];
      return {
        name: m.name,
        description: m.description,
        mutating: m.mutating,
        financial: m.financial,
      };
    }
    const m = foToolCatalog[name as FoToolName];
    return {
      name: m.name,
      description: m.description,
      mutating: m.mutating,
      financial: m.financial,
    };
  }

  isMutating(name: AnyToolName): boolean {
    return this.getMeta(name).mutating;
  }

  isFinancial(name: AnyToolName): boolean {
    return this.getMeta(name).financial;
  }

  /**
   * Valida un input contra el schema Zod del tool sin ejecutarlo. Usado por
   * el agentic loop del copilot para rechazar propuestas incompletas antes
   * de mostrarlas al humano.
   */
  tryValidate(
    name: AnyToolName,
    rawInput: unknown,
  ): { ok: true } | { ok: false; error: string } {
    const schema =
      name in hskToolCatalog
        ? (hskToolCatalog[name as HskToolName] as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } } }).inputSchema
        : (foToolCatalog[name as FoToolName] as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } } }).inputSchema;
    const r = schema.safeParse(rawInput);
    if (r.success) return { ok: true };
    const issues = r.error?.issues ?? [];
    const summary = issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    return { ok: false, error: summary };
  }

  async execute(
    name: AnyToolName,
    rawInput: unknown,
    user: AuthUser,
    correlationId: string,
  ): Promise<unknown> {
    if (name in hskToolCatalog) {
      return this.hsk.execute(name as HskToolName, rawInput, user, correlationId);
    }
    if (name in foToolCatalog) {
      return this.fo.execute(name as FoToolName, rawInput, user, correlationId);
    }
    throw new ForbiddenException(`Unknown tool: ${name}`);
  }
}
