import { Injectable } from '@nestjs/common';
import { CreateRabbitmqDto } from './dto/create-rabbitmq.dto';
import { UpdateRabbitmqDto } from './dto/update-rabbitmq.dto';
import { CreateJobDto } from '../dto/create-job.dto';
import { JobsService } from '../jobs.service';

@Injectable()
export class RabbitmqService {
  constructor(private readonly jobsService: JobsService) {}
  create(createRabbitmqDto: CreateRabbitmqDto) {
    return 'This action adds a new rabbitmq';
  }

  findAll() {
    return `This action returns all rabbitmq`;
  }

  findOne(id: number) {
    return `This action returns a #${id} rabbitmq`;
  }

  update(id: number, updateRabbitmqDto: UpdateRabbitmqDto) {
    return `This action updates a #${id} rabbitmq`;
  }

  remove(id: number) {
    return `This action removes a #${id} rabbitmq`;
  }

  async fullJob(data: string) {
    const createJobDto = new CreateJobDto();
    createJobDto.link = data;
    return this.jobsService.fullJob(createJobDto);
  }
}
