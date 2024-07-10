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
        useFactory: async (configService: ConfigService) => {
          const rabbitmqBaseUrl = configService.get<string>('RABBITMQ_BASEURL', 'localhost');
          // if (!rabbitmqBaseUrl) {
          //   throw new Error('RABBITMQ_BASEURL is not defined');
          // }

          return {
            transport: Transport.RMQ,
            options: {
              urls: [`amqp://${rabbitmqBaseUrl}:5672`],
              queue: 'api_queue',
              queueOptions: {
                durable: false,
              },
            },
          };
        },

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
