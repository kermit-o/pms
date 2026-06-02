import { Module } from '@nestjs/common';
import { CityTaxRuleController } from './city-tax-rule.controller';
import { CityTaxRuleService } from './city-tax-rule.service';
import { FolioController } from './folio.controller';
import { FolioService } from './folio.service';
import { PropertyTaxConfigController } from './property-tax-config.controller';
import { PropertyTaxConfigService } from './property-tax-config.service';
import { TaxReportController } from './tax-report.controller';
import { TaxReportService } from './tax-report.service';

@Module({
  controllers: [
    FolioController,
    PropertyTaxConfigController,
    CityTaxRuleController,
    TaxReportController,
  ],
  providers: [
    FolioService,
    PropertyTaxConfigService,
    CityTaxRuleService,
    TaxReportService,
  ],
  exports: [FolioService, PropertyTaxConfigService, CityTaxRuleService, TaxReportService],
})
export class FolioModule {}
