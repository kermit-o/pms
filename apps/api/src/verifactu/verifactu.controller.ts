import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { IssueInvoiceDto } from './dto';
import { InvoiceService } from './invoice.service';

@Controller('verifactu')
export class VerifactuController {
  constructor(private readonly invoices: InvoiceService) {}

  @Post('invoices/issue')
  @Roles('tenant_admin', 'front_desk')
  async issue(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = IssueInvoiceDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return this.invoices.issue(user, correlationIdOf(req), parsed.data);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
