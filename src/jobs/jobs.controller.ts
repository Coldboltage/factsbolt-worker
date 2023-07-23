import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CompletedVideoJob } from './entities/job.entity';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';
import { TranscriptionDto } from './dto/transciption.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  create(@Body() createJobDto: CreateJobDto) {
    return this.jobsService.create(createJobDto);
  }

  @Get()
  findAll() {
    return this.jobsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto) {
    return this.jobsService.update(+id, updateJobDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobsService.remove(+id);
  }

  // Job services
  @Post('download-video')
  downloadVideo(
    @Body() createJobDto: CreateJobDto,
  ): Promise<CompletedVideoJob> {
    return this.jobsService.downloadVideo(createJobDto);
  }

  @Post('transcribe-audio')
  async transcribeAudio(@Body() transcribeAudioDto: TranscribeAudioDto) {
    return this.jobsService.transcribeAudio(transcribeAudioDto);
  }

  @Post('fact-check-audio')
  async factCheckTranscription(@Body() transcription: TranscriptionDto) {
    const { title, text } = transcription;
    return this.jobsService.factCheckTranscription(title, text);
  }

  @Post('full-job')
  async fullJob(@Body() createJobDto: CreateJobDto) {
    return this.jobsService.fullJob(createJobDto);
  }
}
