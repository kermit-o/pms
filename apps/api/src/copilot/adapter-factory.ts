import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { AnthropicAdapter } from './anthropic-adapter';
import { StubAdapter } from './stub-adapter';
import type { CopilotAdapter } from './copilot.types';

export const COPILOT_ADAPTER = Symbol('COPILOT_ADAPTER');

/**
 * Resuelve el adapter activo segun COPILOT_DRIVER + presencia de
 * ANTHROPIC_API_KEY. Logica:
 *
 *   COPILOT_DRIVER=stub        -> StubAdapter (tests, dev sin API key)
 *   COPILOT_DRIVER=anthropic   -> AnthropicAdapter (falla si no hay API key)
 *   COPILOT_DRIVER ausente     -> anthropic si API key presente, stub si no
 */
@Injectable()
export class AdapterFactory {
  private readonly log = new Logger(AdapterFactory.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly stub: StubAdapter,
    private readonly anthropic: AnthropicAdapter,
  ) {}

  build(): CopilotAdapter {
    const driver = this.config.get('COPILOT_DRIVER', { infer: true });

    if (driver === 'stub') {
      this.log.log('Copilot adapter: stub (forced by COPILOT_DRIVER)');
      return this.stub;
    }
    if (driver === 'anthropic') {
      if (!this.anthropic.isAvailable()) {
        throw new Error('COPILOT_DRIVER=anthropic but ANTHROPIC_API_KEY is missing');
      }
      this.log.log('Copilot adapter: anthropic (forced by COPILOT_DRIVER)');
      return this.anthropic;
    }
    // Default: anthropic si hay key, stub si no.
    if (this.anthropic.isAvailable()) {
      this.log.log('Copilot adapter: anthropic (auto, ANTHROPIC_API_KEY present)');
      return this.anthropic;
    }
    this.log.warn('Copilot adapter: stub (ANTHROPIC_API_KEY absent)');
    return this.stub;
  }
}
