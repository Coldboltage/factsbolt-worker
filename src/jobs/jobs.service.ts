import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import {
  AudioInformation,
  ChatGPT,
  CompletedVideoJob,
  FullJob,
  TranscriptionJob,
  VideoJob,
} from './entities/job.entity';
import axios from 'axios';
import * as fs from 'fs-extra';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';
import { ClientProxy } from '@nestjs/microservices';
const { dlAudio } = require('youtube-exec');
const youtubedl = require('youtube-dl-exec');
const { Configuration, OpenAIApi } = require('openai');
const stripchar = require('stripchar').StripChar;

@Injectable()
export class JobsService {
  constructor(
    @Inject('FACTSBOLT_WORKER_SERVICE') private client: ClientProxy,
  ) {}
  async onApplicationBootstrap() {
    await this.client.connect();
  }

  create(createJobDto: CreateJobDto) {
    return 'This action adds a new job';
  }

  findAll() {
    return `This action returns all jobs`;
  }

  findOne(id: number) {
    return `This action returns a #${id} job`;
  }

  update(id: number, updateJobDto: UpdateJobDto) {
    return `This action updates a #${id} job`;
  }

  remove(id: number) {
    return `This action removes a #${id} job`;
  }

  // Jobs
  async downloadVideo(createJobDto: CreateJobDto): Promise<CompletedVideoJob> {
    let videoInformation: any;
    try {
      videoInformation = await youtubedl(createJobDto.link, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
      });
    } catch (error) {
      console.error(error);
    }

    const filteredVideoInformation: VideoJob = {
      id: videoInformation.id,
      name: videoInformation.title,
      link: createJobDto.link,
    };

    console.log(filteredVideoInformation);

    const audioInformation: AudioInformation = {
      url: createJobDto.link,
      filename: stripchar.RSExceptUnsAlpNum(filteredVideoInformation.name),
      folder: 'src/jobs/downloads', // optional, default: "youtube-exec"
      quality: 'lowest', // or "lowest"; default: "best"
    };

    try {
      await dlAudio(audioInformation);
      console.log('Audio downloaded successfully! 🔊🎉');
      return {
        video: filteredVideoInformation,
        audio: audioInformation,
      };
    } catch (error) {
      console.error('An error occurred:', error.message);
    }
  }

  async transcribeAudio(
    transcribeAudioDto: TranscribeAudioDto,
  ): Promise<TranscriptionJob> {
    const baseUrl = 'https://api.assemblyai.com/v2';
    const headers = {
      authorization: process.env.ASSEMBLEY_API_TOKEN,
    };
    const path = 'src/jobs/downloads';
    let audioData;
    try {
      audioData = await fs.readFile(
        `${path}/${transcribeAudioDto.filename}.mp3`,
      );
    } catch (error) {
      console.log(error);
      throw new NotFoundException('file_could_not_be_found');
    }

    const uploadResponse = await axios.post(`${baseUrl}/upload`, audioData, {
      headers,
    });
    const uploadUrl = uploadResponse.data.upload_url;
    const data = {
      audio_url: uploadUrl, // You can also use a URL to an audio or video file on the web
      speaker_labels: true,
    };
    const url = `${baseUrl}/transcript`;
    const response = await axios.post(url, data, { headers: headers });

    const transcriptId = response.data.id;
    const pollingEndpoint = `${baseUrl}/transcript/${transcriptId}`;

    let audioText: string;
    let completedTranscriptionResult;

    while (true) {
      const pollingResponse = await axios.get(pollingEndpoint, {
        headers: headers,
      });
      const transcriptionResult = pollingResponse.data;

      if (transcriptionResult.status === 'completed') {
        console.log(transcriptionResult);
        audioText = transcriptionResult.text;
        completedTranscriptionResult = transcriptionResult;
        break;
      } else if (transcriptionResult.status === 'error') {
        throw new Error(`Transcription failed: ${transcriptionResult.error}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    console.log(audioText);

    console.log(completedTranscriptionResult.id);
    return {
      id: completedTranscriptionResult.id,
      assembleyId: completedTranscriptionResult.id,
      link: completedTranscriptionResult.audio_url,
      text: completedTranscriptionResult.text,
    };
  }

  async factCheckTranscription(
    title: string,
    transcription: string,
  ): Promise<ChatGPT> {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const openai = new OpenAIApi(configuration);

    let completion;

    try {
      completion = await openai.createChatCompletion({
        // model: 'gpt-4-0613',
        model: 'gpt-4-0613',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            // content: `Please evaluate the following video transcript and break down each major statement into either a factual claim, speculation, or opinion. For each point categorized as an opinion, evaluate its validity based on current best practices or widely accepted standards in the relevant field. Provide context and additional details where necessary, and conclude with an overall assessment of the accuracy of the content and the validity of the opinions expressed.

            // Video title: ${title}
            // Transcript: ${transcription}

            // For each point made in the transcript, categorize it as a factual claim, speculation, or opinion. For opinions, please provide an evaluation of its validity based on relevant best practices or widely accepted standards. Elaborate on each point with any relevant information or context. If research has been cited, attempt to confirm it. These video are one minute long at most.`,
            // content: `Please evaluate the following video transcript and break down each major statement into either a factual claim, speculation, or opinion. For each point categorized as an opinion, evaluate its validity based on current best practices or widely accepted standards in the relevant field. Provide context and additional details where necessary. If research has been cited, attempt to confirm it. These videos are one minute long at most.

            // Upon completion of the evaluation, provide a detailed conclusion. This should include an overall assessment of the accuracy of the content and the validity of the opinions expressed. Discuss the reliability of the sources mentioned, the implications of the video's content, and the potential impact it might have on its audience. Also, highlight any notable strengths or weaknesses you have identified in the video's arguments, and suggest any areas where the video might improve its representation of the facts or clarification of opinions.

            // For each point made in the transcript:

            // 1. Categorize it as a factual claim, speculation, or opinion.
            // 2. For opinions, provide an evaluation of its validity based on relevant best practices or widely accepted standards.
            // 3. Elaborate on each point with any relevant information or context.

            // Video title: ${title}
            // Transcript: ${transcription}
            // `,
            // content: `Please evaluate the following video transcript and break down each major statement into either a factual claim, speculation, or opinion. For each point categorized as speculation, specify whether it is a grounded prediction (based on solid data or market trends) or a baseless speculation. For each point categorized as an opinion, evaluate its validity based on current best practices or widely accepted standards in the relevant field. If an opinion aligns with these standards or practices, indicate this in your evaluation. Provide context and additional details where necessary.

            // If research is necessary to substantiate a claim, to assess the validity of an opinion, or to establish the grounding of a speculation, please cite your sources. Also, where the conversation includes multiple perspectives, aim to balance your evaluation, taking into account the different viewpoints represented.

            // For each point made in the transcript:

            // Categorize it as a factual claim, speculation, or opinion.
            // For speculations, indicate whether they are grounded predictions (based on solid data or market trends) or baseless speculations.
            // For opinions, provide an evaluation of its validity based on relevant best practices or widely accepted standards. If the opinion aligns with these standards or practices, indicate this.
            // Elaborate on each point with any relevant information or context, including citing research where necessary.
            // Upon completion of the evaluation, provide a detailed conclusion. This should include an overall assessment of the accuracy of the content, the validity of the opinions expressed, and the strength of the factual claims made. Discuss the reliability of the sources mentioned, the implications of the video's content, and the potential impact it might have on its audience. Highlight any notable strengths or weaknesses you have identified in the video's arguments and suggest any areas where the video might improve its representation of the facts or clarification of opinions.

            // Video title: ${title}
            // Transcript: ${transcription}`,
            content: `Please evaluate the following transcript and break down each major statement into either a factual claim, grounded speculation, baseless speculation, grounded opinion, or baseless opinion. For each point, provide a brief explanation of why it has been categorized as such, and assess the potential utility of the information separately where applicable.

            Factual claims: Identify any statement that presents a clear fact or claim about reality. Elaborate on why you believe it to be factual. If the fact is widely known, easily verifiable within the field, or involves publicly accessible data, provide the necessary evidence or citation to back it up. If a claim is based on personal experience or is otherwise unverifiable, note this.
            
            Utility of the factual claim: Discuss the potential utility of this factual information. Consider how applying the fact might influence the audience's understanding, decision-making, or behavior, and explore the potential outcomes, implications, and effects on various aspects of personal or societal life.
            
            Grounded Speculation: Label a statement as grounded speculation if it makes a prediction or guess about the future that seems to be based on current trends or data.
            
            Utility of the grounded speculation: Evaluate the potential utility or impact if this grounded speculation was acted upon. Discuss how the speculation could influence decisions and what possible outcomes it could have.
            
            Baseless Speculation: Identify as baseless speculation any statement that makes a prediction or guess about the future that seems to lack foundation in current trends or data. Explain why it is considered baseless.
            
            Grounded Opinion: Recognize statements of personal preference or judgement as grounded opinions if they seem to be based in well-reasoned thinking or empirical evidence.
            
            Utility of the grounded opinion: Discuss the potential utility or impact of these grounded opinions if adopted. Consider the potential benefits, drawbacks, and effects on various aspects of personal or societal life.
            
            Baseless Opinion: Classify as baseless opinion any personal judgement or preference that does not appear to be rooted in sound reasoning or evidence. Explain why it is considered baseless.
            
            After categorizing, explaining, and assessing the utility of each point where applicable, provide an overall assessment of the content. This should include the accuracy of the factual claims, the grounding of the speculations and opinions, and the overall utility of the information. Discuss the reliability of any sources mentioned and highlight any notable strengths or weaknesses in the arguments made.
            
            Video title: ${title}
            Transcript: ${transcription}`,
          },
        ],
      });
    } catch (error) {
      console.log(error);
    }

    // console.log(completion.data.choices[0].message);
    return {
      id: completion.id,
      created: completion.created,
      content: completion.data.choices[0].message,
    };
  }

  async fullJob(createJobDto: CreateJobDto): Promise<FullJob> {
    const completedVideoJob = await this.downloadVideo(createJobDto);

    if (!completedVideoJob) throw new Error('video_job_failed');

    const transcribeAudioDto = new TranscribeAudioDto();
    transcribeAudioDto.filename = `${completedVideoJob.audio.filename}`;
    transcribeAudioDto.folder = completedVideoJob.audio.folder;

    const completeTranscriptionJob = await this.transcribeAudio(
      transcribeAudioDto,
    );

    const transcriptionJob: TranscriptionJob = {
      ...completeTranscriptionJob,
    };

    console.log(transcriptionJob);

    const completeFactsJob = await this.factCheckTranscription(
      completedVideoJob.video.name,
      transcriptionJob.text,
    );

    const fullJob: FullJob = {
      video: {
        ...completedVideoJob.video,
      },
      transcription: {
        ...transcriptionJob,
      },
      chatgpt: {
        ...completeFactsJob,
      },
    };

    console.log(fullJob);

    this.client.emit('completedJob', fullJob);

    return fullJob;
  }
}
