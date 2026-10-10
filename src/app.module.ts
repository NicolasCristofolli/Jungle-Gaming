import { Module } from "@nestjs/common";
import { HealthController } from "./infrastructure/observability/health.controller";
import { DatabaseModule } from './infrastructure/persistence/database.module';
import { WalletController } from "./infrastructure/http/wallet.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, WalletController],
})
export class AppModule {}