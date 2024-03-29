import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as dotenv from 'dotenv';
// import '@tensorflow/tfjs-node';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [`amqp://${process.env.RABBITMQ_BASEURL}:5672`],
        prefetchCount: process.env.QUEUE_ENV ? 1 : 1,
        noAck: false,
        queue: `${process.env.QUEUE_ENV || 'video_queue'}`,
        queueOptions: {
          durable: false,
          heartbeatIntervalInSeconds: 60, // Heartbeat interval in seconds
          connectionTimeout: 600000, // 10 minutes timeout is more reasonable than 4 hours
        },
        socketOptions: {
          heartbeatIntervalInSeconds: 60, // Heartbeat interval in seconds
          connectionTimeout: 600000, // 10 minutes timeout for the socket too
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
