import { Module } from '@nestjs/common';
import { FolioController } from './folio.controller';
import { FolioService } from './folio.service';
import { PropertyTaxConfigController } from './property-tax-config.controller';
import { PropertyTaxConfigService } from './property-tax-config.service';

@Module({
  controllers: [FolioController, PropertyTaxConfigController],
  providers: [FolioService, PropertyTaxConfigService],
  exports: [FolioService, PropertyTaxConfigService],
})
export class FolioModule {}
