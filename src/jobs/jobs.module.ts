import { Module, forwardRef } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [forwardRef(() => RabbitmqModule), UtilsModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
