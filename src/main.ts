import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
require('dotenv').config();
require('@tensorflow/tfjs-node');


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
          heartbeat: 0, // Setting to 0 disables the heartbeat
          connectionTimeout: 14400000, // 4 hours in milliseconds (adjust as needed)
        },
        socketOptions: {
          heartbeat: 0, // Setting to 0 disables the heartbeat
          connectionTimeout: 14400000, // 4 hours in milliseconds (adjust as needed)
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
