import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { RabbitmqService } from './rabbitmq.service';
import { CreateRabbitmqDto } from './dto/create-rabbitmq.dto';
import { UpdateRabbitmqDto } from './dto/update-rabbitmq.dto';
import { TextOnlyDto } from '../dto/text-only.dto';
import { StockCheckupJobDto } from '../dto/stock-job-dto';
const fs = require('fs').promises; // Notice the '.promises'

@Controller()
export class RabbitmqController {
  constructor(private readonly rabbitmqService: RabbitmqService) {}

  @MessagePattern('createRabbitmq')
  create(@Payload() createRabbitmqDto: CreateRabbitmqDto) {
    return this.rabbitmqService.create(createRabbitmqDto);
  }

  @MessagePattern('findAllRabbitmq')
  findAll() {
    return this.rabbitmqService.findAll();
  }

  @MessagePattern('findOneRabbitmq')
  findOne(@Payload() id: number) {
    return this.rabbitmqService.findOne(id);
  }

  @MessagePattern('updateRabbitmq')
  update(@Payload() updateRabbitmqDto: UpdateRabbitmqDto) {
    return this.rabbitmqService.update(updateRabbitmqDto.id, updateRabbitmqDto);
  }

  @MessagePattern('removeRabbitmq')
  remove(@Payload() id: number) {
    return this.rabbitmqService.remove(id);
  }

  // @MessagePattern('newJob')
  @EventPattern('newJob')
  async newFullJob(@Payload() data: string, @Ctx() context: RmqContext) {
    console.log('Was I fired');
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    // handle the message here
    console.log('Received newJob event with data:', data);
    try {
      const result = await this.rabbitmqService.fullJob(data);
      // acknowledge the message after processing
      channel.ack(originalMsg);
    } catch (error) {
      console.log(error);
      // negatively acknowledge the message in case of error
      channel.nack(originalMsg);
    }
  }

  // @EventPattern('add_sites')
  // async addWebPages(@Payload() urls: string[], @Ctx() context: RmqContext) {
  //   const channel = context.getChannelRef();
  //   const originalMsg = context.getMessage();
  //   console.log('fired');
  //   try {
  //     await this.rabbitmqService.addWebPages(urls);
  //     // acknowledge the message after processing
  //     channel.ack(originalMsg);
  //   } catch (error) {
  //     console.log(error);
  //     // negatively acknowledge the message in case of error
  //     channel.nack(originalMsg);
  //   }
  // }

  @EventPattern('text-only')
  async textOnlyJob(@Payload() data: TextOnlyDto, @Ctx() context: RmqContext) {
    console.log('Was I fired');
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    // handle the message here
    console.log('Received newJob event with data:', data);
    try {
      const result = await this.rabbitmqService.textOnlyJob(data);
      // acknowledge the message after processing
      channel.ack(originalMsg);
    } catch (error) {
      console.log(error);
      // negatively acknowledge the message in case of error
      channel.nack(originalMsg);
    }
  }

  @EventPattern('stock-checkup')
  async stockCheckupJob(
    @Payload() data: StockCheckupJobDto,
    @Ctx() context: RmqContext,
  ) {
    console.log('Stock job recieved');
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.rabbitmqService.stockCheckupJob(data);
      channel.ack(originalMsg);
    } catch (error) {
      console.log(error)
      channel.nack(originalMsg);
    }
  }
}

async function saveJsonToFile(filePath, jsonData) {
  try {
    const jsonString = JSON.stringify(jsonData, null, 2);
    await fs.writeFile(filePath, jsonString);
    console.log('File has been saved');
  } catch (err) {
    console.error('Error writing the file:', err);
  }
}
