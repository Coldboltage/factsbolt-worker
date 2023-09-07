import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
require('dotenv').config();

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://localhost:5672'],
        prefetchCount: 1,
        noAck: false,
        queue: 'video_queue',
        queueOptions: {
          durable: false,
        },
      },
    },
  );
  app.listen();
  //   const app = await NestFactory.create(AppModule);
  //   const rabbitApp = app.connectMicroservice<MicroserviceOptions>({
  //     transport: Transport.RMQ,
  //     options: {
  //       urls: ['amqp://localhost:5672'],
  //       queue: 'video_queue',
  //       queueOptions: {
  //         durable: false,
  //       },
  //     },
  //   });
  //   await app.startAllMicroservices();
  //   await app.listen(3002);
}
bootstrap();
