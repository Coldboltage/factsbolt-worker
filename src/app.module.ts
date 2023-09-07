import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JobsModule } from './jobs/jobs.module';
import { RabbitmqModule } from './jobs/rabbitmq/rabbitmq.module';
import { UtilsModule } from './utils/utils.module';

@Module({
  imports: [JobsModule, RabbitmqModule, UtilsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
