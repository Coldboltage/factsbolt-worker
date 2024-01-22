import { Controller } from '@nestjs/common';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { ScrapperService } from './scrapper.service';
import { CreateScrapperDto } from './dto/create-scrapper.dto';
import { UpdateScrapperDto } from './dto/update-scrapper.dto';

@Controller()
export class ScrapperController {
  constructor(private readonly scrapperService: ScrapperService) {}

  @MessagePattern('scrapperJob')
  async monitorScrapper(@Payload() id: string, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    console.log(id);
    try {
      await this.scrapperService.monitorScrapper(id);
      console.log('MESSAGE IS COMPLETE');
      channel.ack(originalMsg);
    } catch (error) {
      channel.nack(originalMsg);
    }
  }

  @MessagePattern('createScrapper')
  async create(
    @Payload() createScrapperDto: CreateScrapperDto,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      await this.scrapperService.create(createScrapperDto);
      console.log('MESSAGE IS COMPLETE');
      channel.ack(originalMsg);
    } catch (error) {
      channel.nack(originalMsg);
    }
  }

  @MessagePattern('findAllScrapper')
  findAll() {
    return this.scrapperService.findAll();
  }

  @MessagePattern('findOneScrapper')
  findOne(@Payload() id: string) {
    return this.scrapperService.findOne(id);
  }

  @MessagePattern('updateScrapper')
  update(@Payload() updateScrapperDto: UpdateScrapperDto) {
    return this.scrapperService.update(updateScrapperDto.id, updateScrapperDto);
  }

  @MessagePattern('removeScrapper')
  remove(@Payload() id: number) {
    return this.scrapperService.remove(id);
  }
}
