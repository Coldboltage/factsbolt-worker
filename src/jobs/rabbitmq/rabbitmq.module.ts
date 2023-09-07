import { Module, forwardRef } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqController } from './rabbitmq.controller';
import { JobsModule } from '../jobs.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UtilsModule } from '../../utils/utils.module';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'FACTSBOLT_WORKER_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: ['amqp://localhost:5672'],
          queue: 'api_queue',
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
    forwardRef(() => JobsModule),
    UtilsModule,
  ],
  controllers: [RabbitmqController],
  providers: [RabbitmqService],
  exports: [ClientsModule],
})
export class RabbitmqModule {}
