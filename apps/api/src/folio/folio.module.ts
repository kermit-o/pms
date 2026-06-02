import { Module } from '@nestjs/common';
import { CityTaxRuleController } from './city-tax-rule.controller';
import { CityTaxRuleService } from './city-tax-rule.service';
import { FolioController } from './folio.controller';
import { FolioService } from './folio.service';
import { PropertyTaxConfigController } from './property-tax-config.controller';
import { PropertyTaxConfigService } from './property-tax-config.service';

@Module({
  controllers: [FolioController, PropertyTaxConfigController, CityTaxRuleController],
  providers: [FolioService, PropertyTaxConfigService, CityTaxRuleService],
  exports: [FolioService, PropertyTaxConfigService, CityTaxRuleService],
})
export class FolioModule {}
