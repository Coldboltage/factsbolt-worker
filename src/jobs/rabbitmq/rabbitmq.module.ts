import { Module, forwardRef } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqController } from './rabbitmq.controller';
import { JobsModule } from '../jobs.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UtilsModule } from '../../utils/utils.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'FACTSBOLT_WORKER_SERVICE',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              `amqp://${configService.get<string>('RABBITMQ_BASEURL')}:5672`,
            ],
            queue: 'api_queue',
            queueOptions: {
              durable: false,
            },
          },
        }),
        inject: [ConfigService],
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
