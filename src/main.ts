import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const configService = appContext.get(ConfigService);

  // Retrieve configuration values
  const rabbitMqUrl = configService.get<string>('RABBITMQ_BASEURL');
  const queueEnv = configService.get<string>('QUEUE_ENV') || 'video_queue';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [`amqp://${rabbitMqUrl}:5672`],
        prefetchCount: queueEnv ? 1 : 1,
        noAck: false,
        queue: `${queueEnv || 'video_queue'}`,
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
