import { Injectable, OnModuleInit } from '@nestjs/common';
import { CreateRabbitmqDto } from './dto/create-rabbitmq.dto';
import { UpdateRabbitmqDto } from './dto/update-rabbitmq.dto';
import { CreateJobDto } from '../dto/create-job.dto';
import { JobsService } from '../jobs.service';
import { UtilsService } from '../../utils/utils.service';
import weaviate from 'weaviate-ts-client';
import { WeaviateStore } from 'langchain/vectorstores/weaviate';
// import "@tensorflow/tfjs-backend-cpu";
import { TensorFlowEmbeddings } from 'langchain/embeddings/tensorflow';
import { TextOnlyDto } from '../dto/text-only.dto';
import { FullJob } from '../../utils/utils.types';

@Injectable()
export class RabbitmqService implements OnModuleInit {
  client: any;
  constructor(
    private readonly jobsService: JobsService,
    private readonly utilsService: UtilsService,
  ) {}

  onModuleInit() {
    console.log(`The module has been initialized.`);
    this.client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'localhost:8080',
    });
  }

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

  async fullJob(data: string): Promise<FullJob> {
    const createJobDto = new CreateJobDto();
    createJobDto.link = data;
    return this.jobsService.fullJob(createJobDto);
  }

  async addWebPages(webPages: string[]): Promise<void> {
    const vectorStore = new WeaviateStore(new TensorFlowEmbeddings(), {
      client: this.client,
      indexName: 'Factsbolt',
      metadataKeys: ['source'],
    });
    await this.utilsService.webBrowserDocumentProcess(webPages, vectorStore);
  }

  async textOnlyJob(data: TextOnlyDto) {
    // const createJobDto = new CreateJobDto();
    // createJobDto.link = data;
    return this.jobsService.factCheckLang({ ...data });
  }
}
