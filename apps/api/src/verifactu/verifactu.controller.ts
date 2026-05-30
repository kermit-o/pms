import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CertificateVaultService } from './certificate-vault.service';
import { IssueInvoiceDto, RevokeCertificateDto, UploadCertificateDto } from './dto';
import { InvoiceService } from './invoice.service';

@Controller('verifactu')
export class VerifactuController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly certs: CertificateVaultService,
  ) {}

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

  @Post('certificate')
  @HttpCode(201)
  @Roles('tenant_admin')
  async uploadCertificate(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = UploadCertificateDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    let p12: Buffer;
    try {
      p12 = Buffer.from(parsed.data.p12Base64, 'base64');
    } catch {
      throw new BadRequestException('p12Base64 is not valid base64');
    }
    if (p12.length < 50) {
      throw new BadRequestException('Decoded p12 payload is too short');
    }
    return this.certs.upload(user, correlationIdOf(req), p12, parsed.data.passphrase);
  }

  @Get('certificate')
  @Roles('tenant_admin')
  async getCertificate(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    const meta = await this.certs.getMetadata(user, correlationIdOf(req));
    if (!meta) throw new NotFoundException('No certificate uploaded for this tenant');
    return meta;
  }

  @Delete('certificate')
  @Roles('tenant_admin')
  async revokeCertificate(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = RevokeCertificateDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return this.certs.revoke(user, correlationIdOf(req), parsed.data.reason);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
