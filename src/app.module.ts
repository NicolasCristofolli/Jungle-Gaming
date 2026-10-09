import { Module } from "@nestjs/common";
import { HealthController } from "./infrastructure/observability/health.controller";

@Module({
  controllers: [HealthController],
})
export class AppModule {}
