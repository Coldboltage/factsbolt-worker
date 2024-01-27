import { TensorFlowEmbeddings } from 'langchain/embeddings/tensorflow';
import {
  BadGatewayException,
  ImATeapotException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import {
  ChatGPT,
  CompletedVideoJob,
  FullJob,
  Job,
  Speech,
  TranscriptionJob,
} from './entities/job.entity';
import axios from 'axios';
import * as fs from 'fs-extra';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';
import { ClientProxy } from '@nestjs/microservices';
const { dlAudio } = require('youtube-exec');
const youtubedl = require('youtube-dl-exec');
const { Configuration, OpenAIApi } = require('openai');
import { OpenAIEmbeddings } from '@langchain/openai';
const stripchar = require('stripchar').StripChar;
import { OpenAI } from 'langchain/llms/openai';
import { PromptTemplate } from 'langchain/prompts';

import { loadQAStuffChain } from 'langchain/chains';
import {
  CommaSeparatedListOutputParser,
  StructuredOutputParser,
} from 'langchain/output_parsers';
import { UtilsService } from '../utils/utils.service';
import { HydeRetriever } from 'langchain/retrievers/hyde';
import { faker } from '@faker-js/faker';
import weaviate from 'weaviate-ts-client';
import { WeaviateStore } from 'langchain/vectorstores/weaviate';
import { RunnableSequence } from 'langchain/schema/runnable';
import { AmendedSpeech, JobStatus } from '../utils/utils.types';
import { ContextualCompressionRetriever } from 'langchain/retrievers/contextual_compression';
import { LLMChainExtractor } from 'langchain/retrievers/document_compressors/chain_extract';
import { DocumentInterface } from '@langchain/core/documents';
import { z } from 'zod';
import { HuggingFaceInferenceEmbeddings } from 'langchain/embeddings/hf';
import { Scrapper, ScrapperStatus } from '../scrapper/entities/scrapper.entity';
import { uuid } from 'uuidv4';
import { CohereEmbeddings } from '@langchain/cohere';

@Injectable()
export class JobsService {
  private logger = new Logger(JobsService.name);

  constructor(
    @Inject('FACTSBOLT_WORKER_SERVICE') private client: ClientProxy,
    private utilsService: UtilsService,
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
    const videoWebsite = this.checkURL(createJobDto.link);
    switch (videoWebsite) {
      case 'Youtube':
        return await this.utilsService.downloadYoutubeJob(createJobDto);
      case 'TikTok':
        console.log('Build TikTok bot');
        return await this.utilsService.downloadTikTokJob(createJobDto);
      case 'Instagram':
        console.log('Build Instagram bot');
        await this.utilsService.downloadInstagram(createJobDto);
        throw new Error('test');
        break;
      default:
        throw new Error(`no_site_found: ${videoWebsite}`);
    }
    // let videoInformation: any;
    // try {
    //   videoInformation = await youtubedl(createJobDto.link, {
    //     dumpSingleJson: true,
    //     noCheckCertificates: true,
    //     noWarnings: true,
    //     preferFreeFormats: true,
    //     addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
    //   });
    // } catch (error) {
    //   console.error(error);
    // }

    // const filteredVideoInformation: VideoJob = {
    //   id: videoInformation.id,
    //   name: videoInformation.title,
    //   link: createJobDto.link,
    // };

    // console.log(filteredVideoInformation);

    // const audioInformation: AudioInformation = {
    //   url: createJobDto.link,
    //   filename: stripchar.RSExceptUnsAlpNum(filteredVideoInformation.name),
    //   folder: 'src/jobs/downloads', // optional, default: "youtube-exec"
    //   quality: 'best', // or "lowest"; default: "best"
    // };

    // try {
    //   await dlAudio(audioInformation);
    //   console.log('Audio downloaded successfully! 🔊🎉');
    //   return {
    //     video: filteredVideoInformation,
    //     audio: audioInformation,
    //   };
    // } catch (error) {
    //   console.error('An error occurred:', error.message);
    // }
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

    const amountOfSpeakers = [
      ...new Set(
        completedTranscriptionResult.utterances.map((speech: Speech) => {
          return speech.speaker;
        }),
      ),
    ];

    const amendedSpeech = this.manyAmendedUttererance(
      completedTranscriptionResult.utterances,
    );

    // if (amountOfSpeakers.length > 1) {
    //   amendedSpeech = this.manyAmendedUttererance(
    //     completedTranscriptionResult.utterances,
    //   );
    // } else {
    //   amendedSpeech = this.singleAmendedUtterance(
    //     completedTranscriptionResult.utterances,
    //   );
    // }

    console.log(completedTranscriptionResult.id);
    return {
      id: completedTranscriptionResult.id,
      assembleyId: completedTranscriptionResult.id,
      link: completedTranscriptionResult.audio_url,
      text: completedTranscriptionResult.text,
      utterance: amendedSpeech,
    };
  }

  async factCheckTranscription(
    title: string,
    transcription: AmendedSpeech[],
  ): Promise<ChatGPT> {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const openai = new OpenAIApi(configuration);

    let completion;
    console.log(transcription);

    try {
      completion = await openai.createChatCompletion({
        temperature: 0.01,
        // model: 'gpt-4-0613',
      });
    } catch (error) {
      console.log(error);
    }

    console.log(completion.data.choices[0].message);
    console.log(completion.data.choices[0].message);
    return {
      id: completion.id,
      created: completion.created,
      content: completion.data.choices[0].message,
      plainText: completion.data.choices[0].message.content
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"'),
    };
  }

  async factCheckLang({
    title = 'No Title Given',
    transcriptionJob,
    text,
  }: Job) {
    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
      // modelName: 'gpt-4-0314',
      // modelName: 'gpt-3.5-turbo-1106',
    });

    // Something wrong with the weaviate-ts-client types, so we need to disable
    const client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'localhost:8080',
      apiKey: new (weaviate as any).ApiKey(
        process.env.WEAVIATE_API_KEY || 'default',
      ),
    });

    const vectorStore = new WeaviateStore(
      new CohereEmbeddings({
        // model: 'embed-english-v3.0',
      }),
      {
        client,
        indexName: 'Factsbolt',
        metadataKeys: ['source'],
      },
    );

    // const vectorStore = new WeaviateStore(new OpenAIEmbeddings(), {
    //   client,
    //   indexName: 'Factsbolt',
    //   metadataKeys: ['source'],
    // });

    // const vectorStore = new WeaviateStore(
    //   new HuggingFaceInferenceEmbeddings({
    //     model: 'WhereIsAI/UAE-Large-V1',
    //   }),
    //   {
    //     client,
    //     indexName: 'Factsbolt',
    //     metadataKeys: ['source'],
    //   },
    // );

    // const response = await client.graphql
    //   .aggregate()
    //   .withClassName('Factsbolt')
    //   .withFields('meta { count }')
    //   .do();
    // console.log(response.data.Aggregate.Factsbolt);

    // throw new Error();

    const llm = new OpenAI({ temperature: 0, modelName: 'gpt-4-1106-preview' });

    // const baseCompressor = LLMChainExtractor.fromLLM(model);

    // First Phase
    // const searchTerm = !text
    //   ? await this.transcriptSearchGen(transcriptionJob, title)
    //   : await this.generalTextSearchGen(text, title);

    let searchResultFilter = [];

    // const claimCheck = await this.utilsService.getAllClaimsFromTranscript(
    //   transcriptionJob,
    //   title,
    // );

    const searchTerm = await this.combinedClaimSetup(transcriptionJob, title);

    // searchTerm = await this.transcriptSearchGen(transcriptionJob, title);
    // searchTerm.push(...claimCheck);

    if (process.env.SEARCH_GOOGLE === 'true') {
      // const searchTermToUrl = async (term: string) => {
      //   let searchResults = await this.utilsService.searchTerm(term);
      //   const currentSearchResultFilter =
      //     this.utilsService.extractURLs(searchResults);
      //   searchResultFilter = [
      //     ...searchResultFilter,
      //     ...currentSearchResultFilter,
      //   ];
      // };

      // for (const term of searchTerm) {
      //   let searchResults = await this.utilsService.searchTerm(term);
      //   const currentSearchResultFilter =
      //     this.utilsService.extractURLs(searchResults);
      //   searchResultFilter = [
      //     ...searchResultFilter,
      //     ...currentSearchResultFilter,
      //   ];
      // }

      const workerUUID = uuid();

      await axios(`${process.env.API_BASE_URL}/scrapper/${workerUUID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Include or omit based on your requirements
        },
      });

      let status = false; // Assuming 'status' is declared somewhere in your scope

      await new Promise((resolve) => {
        const pollStatus = async (id: string) => {
          console.log('polling loop');
          try {
            const response = await axios.get(
              `${process.env.API_BASE_URL}/scrapper/${id}`,
            );
            const data: Scrapper = response.data;
            if (data.status === ScrapperStatus.READY) {
              status = true;
              resolve('lol'); // Resolve the promise when condition is met
            } else {
              console.log(`Status is ${data.status}`);
              setTimeout(() => pollStatus(id), 5000);
            }
          } catch (error) {
            console.error('Error in polling:', error);
            // Depending on your error handling strategy, you may choose to reject the promise here
            // reject(error);
          }
        };

        pollStatus(workerUUID); // Initial call to start polling
      });

      searchResultFilter = await this.utilsService.processSearchTermsRxJS(
        searchTerm,
        5,
      );

      await axios(`${process.env.API_BASE_URL}/scrapper/${workerUUID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json', // Include or omit based on your requirements
        },
        data: {
          status: ScrapperStatus.DONE,
        },
      });
    }

    // let searchResultFilter = this.utilsService.extractURLs(searchResults);

    // Reuters Phase
    // const searchTermReuters = await this.reutersSearchGen(
    //   transcriptionJob,
    //   title,
    // );
    // const searchResultsReuters = await this.utilsService.searchTerm(
    //   searchTermReuters.query,
    // );
    // const searchResultFilterReuters =
    //   this.utilsService.extractURLs(searchResultsReuters);

    // const vectorStore = new WeaviateStore(new OpenAIEmbeddings(), {
    //   client,
    //   indexName: 'Factsbolt',
    //   metadataKeys: ['source'],
    // });

    if (process.env.SEARCH_GOOGLE === 'true') {
      await this.utilsService.webBrowserDocumentProcess(
        [
          ...searchResultFilter,
          // ...searchResultFilterReuters
        ],
        vectorStore,
      );
    }

    const vectorStoreSearchQuery = new WeaviateStore(
      new CohereEmbeddings({
        // model: 'embed-english-v3.0',
        inputType: 'search_query',
      }),
      {
        client,
        indexName: 'Factsbolt',
        metadataKeys: ['source'],
      },
    );

    const baseCompressorModel = new OpenAI({
      temperature: 0,
      modelName: 'gpt-3.5-turbo-1106',
      // modelName: 'gpt-4-0314',
      // modelName: 'gpt-3.5-turbo-1106',
    });

    const baseCompressor = LLMChainExtractor.fromLLM(baseCompressorModel);

    // NORMAL VECTORSTORE
    // const vectorStoreRetriever = new ContextualCompressionRetriever({
    //   baseCompressor,
    //   baseRetriever: vectorStore.asRetriever(), // Your existing vector store
    // });

    // COHERE SPECIFIC
    const vectorStoreRetriever = new ContextualCompressionRetriever({
      baseCompressor,
      baseRetriever: vectorStoreSearchQuery.asRetriever(), // Your existing vector store
    });

    let results: DocumentInterface<Record<string, any>>[] = [];

    this.logger.verbose(searchTerm);

    // for (const claim of searchTerm) {
    //   this.logger.debug(claim);
    //   const test = await vectorStoreRetriever.getRelevantDocuments(claim);
    //   this.logger.verbose(test);
    //   results.push(...test);
    // }

    const getDocByClaim = async (
      claim: string,
    ): Promise<DocumentInterface<Record<string, any>>[]> => {
      this.logger.debug(claim);
      const test = await vectorStoreRetriever.getRelevantDocuments(claim);
      this.logger.verbose(test);
      return test;
    };

    const claimPromises = searchTerm.map((claim) => getDocByClaim(claim));

    const accumulatedClaimsDoc = await Promise.allSettled(claimPromises);

    this.logger.verbose('add accumulatedClaimsDoc to results');

    for (const docArray of accumulatedClaimsDoc) {
      if (docArray.status === 'fulfilled') results.push(...docArray.value);
    }

    // const testModel = new OpenAI({
    //   temperature: 0,
    //   modelName: 'gpt-3.5-turbo-1106',
    //   // modelName: 'gpt-4-0314',
    //   // modelName: 'gpt-3.5-turbo-1106',
    // });

    // const mainClaimQuick = await testModel.invoke(
    //   `Direct Summary: ${transcriptionJob.text}`,
    // );

    // const fullTranscriptClaim = await vectorStoreRetriever.getRelevantDocuments(
    //   mainClaimQuick,
    // );

    // results.push(...fullTranscriptClaim);

    // const vectorStoreRetrieverHyde = new HydeRetriever({
    //   vectorStore,
    //   llm: baseCompressorModel,
    //   k: 6,
    //   verbose: false,
    // });

    // const hydeResponse = await vectorStoreRetrieverHyde.getRelevantDocuments(
    //   `Begin by analyzing the title for initial context. Then, delve deeply into the transcription, identifying key subjects, specific claims, statistics, or notable statements related to the main event or issue. Assess and prioritize these elements based on their contextual importance and relevance to the main discussion.

    // Construct search queries that target these identified subjects and claims, with a focus on those deemed more significant. Ensure queries are precise and succinct, ideally limited to 32 words, and avoid the use of special characters like question marks, periods, or non-alphanumeric symbols. The goal is to create queries that delve into the specifics of the situation, giving priority to the most important aspects, such as key individual statements, significant legal proceedings, crucial organizational responses, and vital media coverage.

    // Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their relevance to the main event, including legal, ethical, and societal aspects. Consider the significance of each fact in the context of the transcript and the broader discussion.

    // Finally, from this analysis, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription, with an emphasis on those of higher priority. This approach ensures a thorough exploration of each significant aspect of the event or issue, with a focus on the most impactful elements.
    // Title: ${title},
    //   Transcript: ${!text ? JSON.stringify(transcriptionJob.utterance) : text}

    //   Lastly, please uses sources with this most credibility as priority`,
    // );

    // results.push(...hydeResponse);

    console.log(results);

    // const results = await vectorStoreRetriever.getRelevantDocuments(
    //   `Begin by analyzing the title for initial context. Then, delve deeply into the transcription, identifying key subjects, specific claims, statistics, or notable statements related to the main event or issue. Focus on extracting these core elements from the transcription, concentrating on the specifics of the situation rather than the speaker's broader perspective or the general context of the discussion.

    //   Construct search queries that specifically target these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their relevance to the main event, including legal, ethical, and societal aspects.

    //   When formulating your queries, ensure they are precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create queries that delve directly into the specifics of the situation, such as individual statements, legal proceedings, organizational responses, and media coverage.

    //   Finally, from this analysis, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription. This approach ensures a thorough exploration of each significant aspect of the event or issue.
    //   Title: ${title},
    //     Transcript: ${
    //       !text ? JSON.stringify(transcriptionJob.utterance) : text
    //     }`,
    // );

    const chain = loadQAStuffChain(model, {});

    const fullResults = [...results];

    const example = this.utilsService.promptExample();

    // const breakdownStatements = this.utilsService.breakdownTranscript(transcriptionJob.utterance)

    const result = await chain.call({
      input_documents: fullResults,
      question: `
      Please evaluate the following transcript with the help of the documents/context provided, as context that might have come out after the 2023 training data. 
            
      Labelled Context Summary, create a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Proceed with a methodical analysis of each major statement, while simultaneously maintaining an awareness of the overall context of the conversation. 
      
      In your analysis, it's crucial to treat each sentence or question in the transcript as a separate segment for evaluation. Follow these guidelines:

      Directive for Exclusive Use of Defined Categories:
      "In this analysis, strictly adhere to the categories and their definitions as provided below. Each statement in the transcript must be evaluated and categorized exclusively based on these definitions. Refrain from using any external or previous categorization frameworks. The goal is to ensure that the analysis is consistent, accurate, and aligned solely with the provided category definitions."

      CATEGORY DEFINITION

      "Verified facts are statements that present clear facts or claims about reality. For every verified fact, evaluation involves referencing training data up to April 2023 and considering any documented context supplied. Verification must include corroboration from at least one neutral, independent source, in addition to any other source. This can be done by:

      a) Quoting directly from context documents/context, including at least one neutral source, to serve as a citation.
      b) Referencing training data or external information, providing a specific reference akin to: 'As found in a study from [Specific Year] in [Specific Source Name],' or 'According to [Authoritative Source],' ensuring at least one of these is a neutral source.

      Facts or claims must align with well-established knowledge and be corroborated by credible sources, including at least one independent and neutral source. When a statement aligns with training data and documented context, elaborate on why it is considered a verified fact, discussing its factual accuracy, source credibility, and potential implications or applications. If the fact is part of a larger narrative with a specific intent (e.g., manipulative, speculative), this context should be noted, with emphasis on neutral source corroboration to ensure unbiased verification."

      Within the source verification, specifically reference the actual source used for verification, providing clarity on how it supports the fact.

      Evidence-Limited Theoretical Claim: This category is for statements grounded in theoretical models or hypotheses that are logically coherent but lack extensive empirical verification. It involves assessing the claim's alignment with established principles and its theoretical basis, while noting the absence or limitations of empirical evidence. Verification includes quoting authoritative theoretical sources and, where available, cross-referencing with empirical data. The analysis focuses on the theoretical strengths of the claim and its potential implications, highlighting the need for further empirical research to substantiate its validity. This category underscores the distinction between theoretically sound ideas and those backed by robust empirical evidence.
      
      Partially Verified" applies to statements or claims where there is some supporting evidence or credible sources that partially substantiate the claim, albeit not comprehensively. However, this category should be carefully distinguished from speculative assertions. If a statement, despite having some factual basis, leans significantly towards speculation or theoretical interpretation, especially in its overarching implication or conclusion, it should not be classified as 'Partially Verified'. Instead, such statements should be categorized as 'Grounded Speculation' or another more fitting category. 'Partially Verified' is reserved for claims that, while not fully corroborated due to limited evidence, maintain a predominant basis in verifiable facts or credible references, and do not extend into speculative territory beyond what the partial evidence can reasonably support
      
      Misleading Fact: This category is for identifying statements that, while based on verified facts or claims up to April 2023 from credible sources, include elements that could be misleading or taken out of context. When labeling a statement as a 'Misleading Fact,' it is crucial to first affirm the overall factual accuracy of the core claim, using training data, documented context, or credible public sources. The analysis should then focus on identifying and explaining specific aspects of the statement that are potentially misleading or misrepresented. This involves discussing which particular elements or phrasings in the statement contribute to a misleading narrative and why they are considered manipulative in the given context. Additionally, it is important to clarify what additional information or perspective is necessary to fully understand these elements and to rectify any misconceptions. The evaluation should also consider the potential utility and harm of these manipulated elements, discussing how they could influence interpretations or decisions in various scenarios. It is equally important to include counterpoints or alternative perspectives that add valuable context to the specific manipulated elements of the fact, especially those supported by training data or other credible sources. The goal is to guide the audience towards an informed understanding by distinguishing between the verified core of the claim and the contextually manipulated aspects of its presentation.

      Unverified Claims: Identify statements presented as facts or claims about reality that currently lack verifiable evidence or reliable sources for substantiation. Label these as 'Unverified Claim.' In your analysis, explain why the statement remains unverified, highlighting the limitations of the available resources or search capabilities that might have led to this conclusion. This includes acknowledging the importance of neutral and reliable sources for the verification process. Note that while the claim remains unverified at the moment, it does not necessarily mean it is false — further research or future information could potentially verify it. Discuss the potential implications of the claim, including how it might be used or misused in different contexts if accepted without verification, and encourage the audience to consider the claim with a critical perspective, acknowledging the current limitations in verifying its accuracy and the need for objective, evidence-based information sources.
      Factually Incorrect: This category applies to statements, claims, opinions, or speculations that either directly contradict current, well-established knowledge and empirical evidence, or represent a significant misunderstanding or misrepresentation of such knowledge. This includes not only statements that are demonstrably false but also those that, while possibly grounded in personal experience or belief, are at odds with established scientific consensus or factual understanding. The key aspect of this category is the presence of a clear conflict between the statement and established facts or scientific understanding, regardless of whether the statement is framed as a personal belief or experience.

      Unsupported Opinion: This category is for opinions that lack a basis in verified facts or empirical evidence. These opinions may not necessarily be in direct conflict with established facts (like flat earth theories would be), but they also do not align with or are supported by current empirical knowledge. This category helps to differentiate opinions that are not inherently harmful or manipulative but are also not supported by factual evidence.

      Well-Founded Opinion: This category is for opinions that align with established principles, recognized wisdom, or general best practices in a particular field, even if they are not explicitly supported by specific empirical data in the statement. These opinions reflect a general understanding or acceptance of certain concepts that are widely regarded as effective or true based on collective experience or consensus, rather than on direct empirical evidence.
      
      Fundamentally Confirmed: This categorization applies to statements where the core idea or principal assertion is validated through credible and independent sources, as per the latest known data, including training data up to April 2023. The term 'Fundamentally Confirmed' specifically highlights that the foundational aspect of the claim is verified and factual. However, it simultaneously brings attention to the fact that certain details, specific methods, or subsidiary elements within the claim have not been verified or may remain inconclusive. This classification is designed to explicitly differentiate between the aspects of the claim that are substantiated and those that are not, thereby providing a clear understanding of the extent of verification. The aim is to affirm the verified truth of the central claim while maintaining transparency about the unverified status of specific details, ensuring an informed and nuanced understanding of the claim's overall veracity.

      Factually Supported Opinion: An opinion or assertion that is grounded in verifiable facts or empirical evidence presented within the statement. This category is used when the opinion is formed by drawing conclusions or making judgments based on factual information or data that can be corroborated. It indicates that the opinion has a factual basis and is supported by concrete evidence or data within the statement, which can be referenced and verified.

      Grounded Speculations: Label a statement as grounded speculation if it makes a prediction or guess about the future based on current trends or data. Discuss the current trends, data, or historical events that support this speculation. Evaluate the potential utility or impact if this speculation was acted upon.
      
      Baseless Speculation: Identify statements that speculate or predict without a clear or logical basis in data or facts. As this could potentially be misleading or damaging, no utility analysis will be provided for these points.

      Baseless Opinions: Recognize statements of personal judgement or bias that are not backed by evidence or sound reasoning. Like with baseless speculation, no utility analysis will be provided due to the potential for misinformation or harm.

      Unelaborated Disagreement: Applicable when the speaker disagrees with a previous statement or question without providing reasoning or justification.

      Moral Disgust Expression: Applicable to statements where the speaker is conveying a sense of moral outrage or disgust in response to another's opinion or action.

      Manipulative Opinion: Identify statements that express a viewpoint or judgment and are presented in a way that aims to deceive, mislead, or provoke strong emotional responses. This could include the use of emotionally charged language, exaggerations, or rhetorical devices designed to manipulate the audience's perception. Whether the opinion is grounded in empirical evidence or not, provide an analysis that discusses the underlying evidence or reasoning, if any, and how it is being used manipulatively.

      Manipulative Speculation: Identify statements that make predictions or guesses, whether based on current trends, data, or without any clear basis, but are presented in a misleading or deceptive manner. Label these as 'Manipulative Speculation'. Discuss any trends, data, or historical events that may or may not support this speculation, and elaborate on how the statement is being used to deceive or mislead.

      Incomplete Statement: Identify statements that lack essential information or context to convey a clear meaning on their own. These statements may require additional information or elaboration to be fully understood. Use this category when a statement is presented in a way that is fragmented, vague, or lacking crucial details, making it challenging to categorize it otherwise.

      Question: A "Question" in a conversation is a segment characterized by its inquisitive intent, where the speaker seeks information, clarification, or a response from others. Unlike statements that present facts or opinions, a question is formulated to elicit additional details or viewpoints. Its evaluation focuses on the context within which it is asked, the phrasing that indicates inquiry (often involving interrogatives like who, what, where, when, why, or how), and the nature of the response it solicits. The purpose of a question can vary – it may be to gather information, probe deeper into a topic, challenge a previous statement, or stimulate further discussion. In analysis, a question is recognized not for its factual content but for its role in driving the conversation forward and inviting engagement from other participants.

      Personal Inquiry or Expression: This category is for statements where the speaker is expressing personal feelings, uncertainties, inquiries, or lacks knowledge about a topic. These statements are inherently subjective and cannot be independently verified. They are not factual claims but rather reflect the speaker's personal perspective or desire for information.

      Question: A "Question" in a conversation is a segment characterized by its inquisitive intent, where the speaker seeks information, clarification, or a response from others. Unlike statements that present facts or opinions, a question is formulated to elicit additional details or viewpoints. Its evaluation focuses on the context within which it is asked, the phrasing that indicates inquiry (often involving interrogatives like who, what, where, when, why, or how), and the nature of the response it solicits. The purpose of a question can vary – it may be to gather information, probe deeper into a topic, challenge a previous statement, or stimulate further discussion. In analysis, a question is recognized not for its factual content but for its role in driving the conversation forward and inviting engagement from other participants.

      Personal Inquiry or Expression: This category is for statements where the speaker is expressing personal feelings, uncertainties, inquiries, or lacks knowledge about a topic. These statements are inherently subjective and cannot be independently verified. They are not factual claims but rather reflect the speaker's personal perspective or desire for information.

      Category Directive: Do not label anything a Personal Fact. Always categorize based upon the CATEGORY DEFINITIONS ABOVE

      Sentence-by-Sentence Breakdown: Every sentence or question, marked by a full stop or a question mark, should be considered as a distinct segment. This means breaking down the transcript into smaller parts, each ending at a punctuation mark that concludes a sentence or a question.

      Individual Analysis of Segments: Apply the FactCheckSentence structure to each of these segments. This involves:

      Transcript Analysis Template

      Define Speaker Personas:

      Essential Persona Assignment: Begin by assigning a unique and descriptive persona to each speaker. This persona should reflect their distinct role or perspective in the conversation (e.g., Financial Novice, Investment Guide). It's crucial that these personas are not only unique but also capture the essence of each speaker's contribution to the conversation.
      Mandatory Persona Usage: Once a persona is assigned, it is mandatory to use this specific persona consistently throughout the analysis. Each segment of the conversation should clearly indicate the speaker's persona, reinforcing their role and perspective.
      
      Explicit Segmentation in Output:

      Clearly segment the transcript into individual parts. Each segment should consist of a single sentence or a closely related group of sentences.
      
      Structured Analysis for Each Segment

      Use the following structure for the analysis of each segment:
      Segment [Number] - Speaker [Persona]: [Brief Descriptor]
      Speaker: [Persona]
      Text: "[Exact quote from the segment]"
      Category: Assign an appropriate category from the Category enumeration.
      Explanation: Provide a detailed explanation for the categorization, considering the context and content of the statement.
      Source Verification: Detail the source verification, particularly for factual claims. Include references to credible sources or training data as necessary.
      Continuous Segmentation:

      Continue this structured analysis process for each sentence or question in the transcript, ensuring clarity and focus on each individual point.
      Category Enumeration:

      Clearly define and use categories from your Category enumeration, ensuring each statement is accurately categorized.
      Consistent Use of Personas:

      Refer to speakers by their personas throughout the analysis to maintain clarity and consistency.
      Example Analysis Structure:

      Segment 1 - Financial Novice: Expressing Uncertainty

      Speaker: Financial Novice
      Text: "I don't know about stocks and shares."
      Category: Unsupported Opinion
      Explanation: The speaker expresses a personal lack of knowledge about stocks and shares, categorizing this as an opinion rather than a verified fact.
      Source Verification: N/A
      Segment 2 - Investment Guide: Recommending Strategies

      Speaker: Investment Guide
      Text: "Invest in a diversified portfolio for long-term growth."
      Category: Well-Founded Opinion
      Explanation: The speaker offers investment advice based on common financial principles, suggesting a strategy widely recognized as effective for long-term growth.
      Source Verification: Supported by financial literature and expert advice.

      [Repeat the structure for the next sentence]
      By following this structured approach, ensure that each sentence or question is analyzed as an individual unit, maintaining clarity and focus in the evaluation of each segment.

      Directive for Deliberative Category Selection:

      In the process of categorizing each statement, it is imperative to undertake a deliberative and comparative evaluation. This involves:

      Potential Category Consideration: Initially, identify all possible categories that could apply to the statement based on its content and context.

      Comparative Evaluation: Compare the statement against the definitions and criteria of these potential categories. This step should involve a careful examination of how well the statement aligns with each category's definition and intent.

      Best Fit Determination: Select the category that most accurately and comprehensively captures the essence of the statement. The chosen category should be the one that best reflects the statement's factual basis, theoretical grounding, or speculative nature, as applicable.

      Justification for Selection: Provide a clear rationale for why the chosen category is the most appropriate. This should include a brief discussion of why other potential categories were considered but ultimately not selected.

      This directive aims to ensure a thorough and nuanced categorization process, reducing the likelihood of misclassification and enhancing the overall accuracy and depth of the analysis.

      Break down these statements into individual points or closely related sentences to understand the nuances, but regularly refer back to the broader conversation to ensure that each point is evaluated within its proper context. This approach aims to provide a thorough dissection of each statement while preserving the interconnectedness and flow of the conversation. By doing this, the evaluation will be more balanced, acknowledging both the specific details of individual statements and their meaning within the larger dialogue. For each point, identify it as either a Verified Fact, Partially  Verified, Grounded Speculation, Baseless Speculation, Baseless Opinion, Direct Response, Manipulative Opinion, Manipulative Speculation, Misleading Fact, Factually Incorrect, Question, Moral Disgust Expression, Unelaborated Disagreement, or Incomplete Statement. Consider the context in which the statement is made to ensure accurate categorization. In addition to contextual analysis, please ensure to assess the factual accuracy of each statement, taking into account established scientific knowledge and empirical evidence when applicable.

      When evaluating each statement within the provided documents/context, conduct a meticulous assessment of each source's credibility. This evaluation should include an in-depth examination of the author's expertise and qualifications, the source's history of accuracy and reliability, any potential biases or agendas, and the timeliness and relevance of the information presented. Cross-reference facts with multiple reputable sources, prioritizing primary sources and recognized authorities in the field. In cases of conflicting information, seek additional corroborative sources to discern the most robustly supported viewpoint. Document each step of this evaluation process, providing explicit justifications for the credibility assigned to each source. Regularly update and review source credibility, especially for ongoing analyses, to ensure the most current and accurate information is being utilized. This rigorous approach to source evaluation is crucial to ensure that the analysis is grounded not only in factual accuracy but also in the reliability and integrity of the information's origin.

      Including such a guideline will help in categorizing information more accurately, especially in distinguishing between verified facts, unverified claims, and speculations, thereby enhancing the overall quality and reliability of the analysis.

      Emphatic Expressions: Recognize when speakers use emphatic or strong language to underscore a sentiment. Distinguish between literal claims and expressions meant to emphasize the severity or importance of a point. Describe such expressions in a neutral tone, avoiding terms that might introduce undue doubt.

      Nuance and Complexity: Ensure that the analysis reflects the depth and diversity of views on the subject. Strive to uncover and explore the foundational beliefs and assumptions underpinning the speaker's statements, going beyond surface-level interpretations. Recognize areas where evidence is strong, where it's emerging, and where there's legitimate debate. Avoid over-simplifications.

      Identify the main target or subject of the speaker's comments. Is the speaker criticizing or commenting on a specific individual, a group of people, a system or institution, or a general concept or idea? Try to determine the primary source of the speaker's sentiment and the main issue at stake, based on their statements.

      Ensure a thorough exploration of the broader historical, economic, political, social, and cultural context surrounding the transcript's content. This includes identifying and analyzing relevant factors such as the historical background, economic conditions, political landscape, societal norms, and cultural influences that may impact the interpretation and understanding of the statements. Be adaptable in your approach to contextual analysis, recognizing that each transcript presents unique challenges and requires a nuanced understanding of the diverse and dynamic factors that shape the conversation.

      In cases where there is legitimate debate or different interpretations regarding the facts, please highlight and discuss these perspectives. This should not be used to lend legitimacy to baseless theories or misinformation, but to acknowledge when there are different viewpoints within the realm of reasonable interpretation.

      Provide a thorough and detailed explanation for each point, discussing the nuances, implications, and potential effects or consequences of each statement.

      Universal Contextual Analysis: In evaluating any statement from the transcript—be it a verified fact, an opinion, a speculative claim, or any other type—apply a consistent level of scrutiny that considers both the statement's individual accuracy and its role within the broader context of the discussion. This approach ensures a holistic analysis that recognizes the nuanced ways in which different types of statements contribute to the overall narrative or argument being presented.

      For each statement, consider the following aspects:

      Factual Accuracy: Assess the statement's alignment with known facts, empirical data, and established theories. This applies to all statements, regardless of their initial categorization as opinions or speculations.
      Contextual Relevance: Evaluate how the statement fits within the broader narrative or theory presented in the conversation. Determine whether the statement supports, contradicts, or adds complexity to the overall discussion.
      Implications and Inferences: Consider the potential implications or inferences that might arise from the statement, especially when it is part of a larger, speculative, or theoretical argument. Even factually accurate statements can be used to support broader claims that may not have the same level of verification.
      Broader Narrative Influence: Assess how the statement influences the broader narrative or theory. Does it serve as a pivotal piece of evidence for a larger claim? Is it used to draw conclusions that extend beyond its direct meaning?
      By applying this universal contextual analysis, the evaluation process becomes more rigorous and reflective of the multifaceted nature of discourse. It ensures that each statement is not only analyzed for its individual accuracy but also for its role and impact within the larger conversation. This approach is particularly important in complex discussions involving historical interpretations, scientific debates, or ideological exchanges, where the interplay between fact, opinion, and theory is intricate and significant.

      Ensure each segment's evaluation takes into account the broader context of the conversation.
      Highlight how preceding segments influence the statements being analyzed.
      Reference prior segments when evaluating a statement to show their impact on the speaker's perspective.
      Maintain consistency in categorizing statements as opinions, facts, or incomplete statements.
      Provide a comprehensive assessment that includes verifiable facts, opinions, and incomplete statements."

      Incorporating Documents/Context into Analysis Process:

      Ensure Documents/Context-Centric Verification: Actively cross-reference each segment against the information provided in the Documents/Context. Explicitly mention how the documents corroborate, contradict, or enhance the understanding of the statement being analyzed.

      Make Explicit Citations: Include direct references or citations from the Documents/Context in your explanations. This provides clarity on how the Documents/Context influenced the categorization and supports the analytical process.

      Assess Contextual Relevance: Evaluate the broader context given by the Documents/Context and consider how this context affects the interpretation of the statement. Determine if it provides additional insights or challenges the initial understanding.

      Balance Document Evidence with Other Credible Sources: While Documents/Context are key, balance their information with other credible sources, particularly for verified facts. This approach ensures a well-rounded analysis.

      Address Document Limitations: If there are any limitations in the Documents/Context related to scope, recency, or detail, acknowledge these in your analysis. Understanding these limitations is crucial for the categorization process.

      Regularly Update and Review Analysis: Keep the analysis current by regularly reviewing and updating the credibility of the sources, especially for ongoing analyses.

      Incorporate Diverse Perspectives: Make sure the Documents/Context are not the sole source of perspective. When relevant, include other viewpoints or interpretations to gain a more holistic understanding of the statement.

      By adhering to these steps, you ensure that each segment's evaluation is deeply informed by the Documents/Context and context provided, leading to a more accurate and comprehensive analysis.

      After categorizing and explaining each segment, provide a detailed Overall Assessment of the content. This assessment should commence with a summarization of the predominant categories (such as 'Unverified Claims', 'Manipulative Opinions', etc.), emphasizing those that appear with regularity. It should then critically examine the narrative constructed by these segments, highlighting any major inaccuracies, unsupported claims, or instances of misleading information. Evaluate the overall validity of the narrative by contrasting the collective content with verified data and reputable sources, pinpointing both corroborated and contentious points. Delve into the implications or potential effects of the narrative, considering how the blend of factual, speculative, and manipulative elements might influence the audience's perception and understanding of the topic. Conclude by reviewing the notable strengths (such as factual accuracy, logical coherence) and weaknesses (like reliance on emotional persuasion, factual inconsistencies) of the arguments presented, providing a balanced and comprehensive critique of the content's reliability, biases, and impact on informed discourse.
      
      Afterwards, we'll do a Consensus Check, labelled as Consensus Check. Begin the Consensus Check by evaluating the overarching narrative's representation across the spectrum of political analysis, noting especially if it primarily echoes the perspectives of certain commentators rather than a broad consensus among experts. Highlight this divergence or alignment upfront. Next, focus on the segments of the narrative that find grounding in verified facts, such as election procedures, voter statistics, or other concrete data, acknowledging where the narrative aligns with established, verifiable information. Lastly, address the elements of the narrative that delve into speculation, discussing conjectures around campaign strategies, voter behavior, or future political events. Critically assess these speculative statements against the backdrop of empirical evidence and the prevailing consensus in the field. This structure ensures a comprehensive evaluation, distinguishing between the narrative's factual base and its speculative projections, and offering a clear perspective on its overall alignment with recognized consensus and best practices.

      Assess not just whether these strategies, advice, or opinions are widely accepted or popular, but also whether they align with the prevailing consensus among experts in the field.

      Additionally, ensure to differentiate between views held by the majority and those held by a minority that may seem to be growing in influence. It's important not to incorrectly attribute a minority viewpoint as a majority consensus if a significantly larger consensus exists on a particular topic.

      Comment on how the speakers' views align or contrast with these recognized best practices and consensus. Especially note any instances of both grounded and baseless speculation and discuss how they may influence perceptions and understandings of the topic.

      In particular, assess the extent to which the speaker's sentiment is shared among the majority, and whether this majority consensus itself aligns with best practices or expert opinion. Be critical in distinguishing between common critiques or views and those which are supported by empirical evidence and expert consensus. Avoid drawing conclusions solely based on the prevalence of a particular view without examining its grounding in established and credible sources of knowledge in the field.

      Labelled, Consideration of Multiple Perspectives: Evaluate the primary perspective of the speaker. If they focus on a specific viewpoint or aspect, recognize that without introducing undue doubt. However, note if there are widely recognized alternative perspectives or nuances that the speaker might not have covered.

      Labelled, Fact Check Conclusion: Assess the general conclusion and overall reliability of a speaker's statements, then distill this information into a succinct "Fact Check Conclusion." Consider both the evidence presented and any logical or common-sense assumptions that may support the advice or information. The conclusion should guide the reader in layman terms on the practicality, potential reliability, and applicability of the content, even when full evidence isn't available.

      Labelled, Democratic Values and Consensus: Assess the extent to which the speaker's views and arguments align with democratic values, principles, and the current democratic consensus on the topic. Note any instances where the speaker's views diverge from these democratic standards and discuss how this might influence the conversation and the audience's understanding of the topic. Compare the speaker's views with the prevailing democratic consensus, noting any areas of agreement or disagreement.

      Labelled, Contextual Conclusion: Summarize the overall context in which facts, opinions, and speculations are presented in the transcript. Explicitly flag and highlight any recurring themes of contextual manipulation, misleading presentation, or instances where and speculations are used manipulatively. Assess the broader implications of these contextual issues on the validity of the speaker's arguments, the potential impact on public perception, and any attempts to steer the narrative away from the truth. This conclusion should guide the reader in understanding the practicality, reliability, and applicability of the content, especially in the context of any manipulative tactics identified.

      Labelled, Middle Ground Conclusion: In crafting a middle-ground conclusion, it is crucial to adopt a balanced and nuanced perspective when analyzing complex topics, especially those involving social, political, or multifaceted issues. The middle ground represents a viewpoint that strives to find common ground among differing opinions and takes into account the following key principles:
      
      Recognition of Specific Efforts and Progress:
      Identify and describe the specific efforts, policies, initiatives, or actions that have been undertaken to address the issue. Evaluate the effectiveness of these efforts by detailing the progress achieved in specific areas. Explore the question: "What specific actions have been taken to tackle the problem, and where has progress been made?"
      
      Acknowledgment of Ongoing Challenges and Unmet Needs:
      Highlight the persistent challenges and limitations of current approaches. Examine why these challenges continue to exist and what critical needs remain unmet. Delve into questions like: "What are the ongoing challenges, and why do they persist? What needs are yet to be fully addressed?"
      
      Synthesize into a Coherent Middle-Ground View:
      Based on your detailed exploration of complexities, efforts, and challenges, craft a middle-ground conclusion. This conclusion should synthesize the gathered information into a coherent viewpoint that acknowledges the multifaceted nature of the issue. Explain why this balanced view is considered the middle ground, considering the various perspectives and data presented.
      
      Emphasize the Rationale for Middle-Ground Thinking:
      Emphasize the importance of middle-ground thinking in understanding and addressing complex issues. Explain that this approach is crucial for acknowledging the validity of different perspectives, appreciating the intricacies of real-world challenges, and fostering pragmatic, inclusive solutions.
      
      A middle-ground conclusion aims to provide a balanced and comprehensive perspective on the issue, taking into account its complexities and recognizing both successes and challenges in addressing it.

      Note: In all sections labeled as 'Assessment,' 'Conclusion,' or any variations thereof—both present and those that may be added in the future—please provide a highly detailed and verbose response. These designated sections are intended to yield a comprehensive and nuanced understanding of the topic. Conciseness is acceptable for other sections not falling under these categories.

      Labeled, Main Claim:

      Summarized Main Claim: [To succinctly summarize the main claim discussed in the transcript, consider the central theme or argument that emerges from the conversation, taking into account the various perspectives and counterpoints presented. Focus on the primary contention or debate that serves as the nucleus of the discussion, distilling it into no more than 32 words. This summary should reflect the essence of the conversation, highlighting the key issue or dispute around which the discussion revolves, and acknowledging the context in which different claims are made.]      
      
      Selected Category: [Select the most appropriate category for the main claim from the provided Category enum. This selection should be based on a holistic evaluation of the claim's intrinsic validity and the argumentation pathway used, especially considering the broader context surrounding the issue.]

      Rationale for Category Selection: [Provide a well-structured rationale for selecting this category from the Category enum. The rationale should clearly link the category selection to insights and evidence gathered from the detailed analysis of the transcript and supporting documents. Address legal, ethical, factual accuracies, and the relationship between the claim's validity and the methodology used to arrive at it.]

      [Evaluate the speaker's approach and methodology in formulating the main claim. Assess how it aligns or conflicts with the broader context and established evidence. Evaluate the strengths and weaknesses of their argumentation, including the use of anecdotes, generalizations, and empirical data.]
      
      [Conduct a comprehensive analysis of the issue's complexities, taking into account economic, social, political, environmental, historical, and systemic factors. Discuss why the issue is complex and explore the multiple factors influencing it. Ensure that each major statement is analyzed separately, maintaining a structured and thorough approach throughout. Emphasize the interplay between these factors.]
     
      Each major statement should be analyzed separately, maintaining a structured and thorough approach throughout the analysis.

      Labelled, Resources, then, provide a list of resources or facts that offer greater context and insight into the broader issue. Ensure these resources come from credible and respected origins, are recognized for their sound advice and dependability across the relevant community, have stood the test of scrutiny and critical examination, are penned by authors without significant controversies in their background, and where feasible, include direct links for further exploration. Recommendations should lean towards sources with broad consensus, steering clear of those with mixed or contentious opinions.

      Please note that the transcript is an array of speeches from speakers using this format:

      export interface AmendedSpeech {
        speaker: string;
        text: string;
      }

      You will be given an array after the transcription which will have the type of AmendedSpeech or more.

      I've made these interfaces to help assist in the Output structure.

      interface MainClaim {
        mainClaim: string;
        category: Category;
        explanation: string;
      }

      interface FactCheckSentence {
        speaker: string;
        text: string;
        category: Category;
        explanation: string
        contextualAnalysis?: string // Optional field for contextual analysis
        sourceVerification: string; 
      }

      enum Category {
        ManipulativeOpinion = "Manipulative Opinion"
        BaselessOpinion = "Baseless Opinion",
        VerifiedFact = "Verified Fact",
        MisleadingFact = "Misleading Fact",
        UnverifiedClaims = "Unverified Claims",
        GroundedSpeculation = "Grounded Speculation",
        ManipulativeSpeculation = "Manipulative Speculation",
        BaselessSpeculation = "Baseless Speculation",
        PartiallyVerified = "Partially  Verified",
        FundamentallyConfirmed = "Fundamentally Confirmed",
        FactuallyIncorrect = "Factually Incorrect,
        Question = "Question",
        IncompleteStatement = "Incomplete Statement",
        UnelaboratedDisagreement= "Unelaborated Disagreement",
        MoralDisgustExpression = "Moral Disgust Expression"

      }

      interface Output {
        sentence: FactCheckSentence[]
        overalAssesment: string;
        consensusCheck: string;
        factCheckConclusion: string;
        considerationOfMultiplePerspectives: string;
        democraticConclusion: string;
        contextualConclusion: string;
        middlegroundConclusion: string;
        mainClaim: mainClaims;
        furtherResources: string[] // with link
      }

      title of video: ${title},
      Transcript of video to text: ${JSON.stringify(
        !text ? transcriptionJob.utterance : text,
        null,
        2,
      )}.

      If by any chance you can't assist, state exactly why, and show the transcript

      Note, I have done many of fact checking analysis jobs with gpt4 with no issues, therefore there should be no reason why you can't do this. All the information you need will be provided in the documents/context.

      Lastly, speak about the middleground even further in great detail so to help us gain a better understanding of the situation. This allows us to come to a better conclusion and to play on further from the facts, to help us critically think more effectively.

      Follow the output example structure: ${example[0].output}
      Here's another example structure: ${example[1].output}

      ⚠️ Critical Reminder: In your analysis, strictly adhere to segmenting the transcript into individual FactCheckSentence instances. Each sentence or closely related group of sentences must be analyzed and reported as a separate FactCheckSentence. This segmentation is essential for a detailed and accurate evaluation. Do not analyze or report the transcript as a single, continuous text. 
      
      PLEASE adhere exclusively to the categories listed in the Category enum and categorize each statement in the transcript based on these defined categories. Do not use any categories outside of this enum. Ensure that each categorization aligns accurately with the provided definitions.      `,
    });

    console.log(result);

    const parser = StructuredOutputParser.fromNamesAndDescriptions({
      context: 'extract the context section',
      overalAssesment: 'extract the overal Assesment section',
      generalConclusion: 'extract the general conclusion sesion',
      factCheckConclusion: 'extract the fact check conclusion section',
      considerationOfMultiplePerspectives:
        'extract the consideration of multiple perspectives section',
      democraticConclusion: 'extract the democratic conclusion section',
      contextualConclusion: 'extract the contextual conclusion section',
      middlegroundConclusion: 'extract the middleground conclusion section',
      mainClaimConclusion: 'extract the Rationale for Category Selection',
    });

    const formatInstructions = parser.getFormatInstructions();

    const formatPrompt = new PromptTemplate({
      template:
        'Using the following result text, please extract and format correctly to the JSON format which has been requested..\n{format_instructions}\n{result}',
      inputVariables: ['result'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const formatParseModel = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });

    const input = await formatPrompt.format({
      result: result.text,
    });
    const formatParseResponse = await formatParseModel.call(input);

    console.log(await parser.parse(formatParseResponse));

    return {
      id: faker.string.uuid(),
      created: new Date().getTime(),
      content: result.text,
      plainText: result.text.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
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

    // const completeFactsJob = await this.factCheckTranscription(
    //   completedVideoJob.video.name,
    //   transcriptionJob.utterance,
    // );
    const completeFactsJob = await this.factCheckLang({
      title: completedVideoJob.video.name,
      transcriptionJob: transcriptionJob,
    });

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
      status: JobStatus.COMPLETED,
    };

    console.log(fullJob);

    this.client.emit('completedJob', fullJob);

    return fullJob;
  }

  // Utility Functions
  singleAmendedUtterance(utterance: Speech): AmendedSpeech[] {
    console.log(utterance);
    return [
      {
        speaker: utterance.speaker,
        text: utterance.text,
      },
    ];
  }

  manyAmendedUttererance(utterance: Speech[]): AmendedSpeech[] {
    console.log(utterance);
    return utterance.map((speech: Speech): AmendedSpeech => {
      return {
        speaker: speech.speaker,
        text: speech.text,
      };
    });
  }

  checkURL(url: string): string {
    const youtube = ['youtube', 'youtu.be'];
    const tiktok = ['tiktok'];
    const instagram = ['instagram', 'instagr.am'];
    let site: string;

    for (const hostname of youtube) {
      if (url.includes(hostname) && !site) site = 'youtube';
    }

    for (const hostname of tiktok) {
      if (url.includes(hostname) && !site) site = 'tiktok';
    }

    for (const hostname of instagram) {
      if (url.includes(hostname) && !site) site = 'instagram';
    }

    switch (site) {
      case 'youtube':
        return 'Youtube';
      case 'tiktok':
        return 'TikTok';
      case 'instagram':
        return 'Instagram';
      default:
        return 'No Site Found';
    }
  }

  async aClaimFinder(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        answer: z.string().describe('Copy the query string made'),
      }),
    );

    const transcriptChain = RunnableSequence.from([
      PromptTemplate.fromTemplate(
        `Begin by analyzing the title for initial context. Delve into the transcription, identifying key subjects, specific claims, statistics, or notable statements. Focus on extracting these core elements from the transcription, rather than the speaker's broader perspective or the general context of the discussion.
        
        Construct a search query that specifically targets the amalgamation of these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their scientific, psychological, and societal aspects.
        
        When formulating your query, ensure it is precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create a query that directly delves into the subjects themselves, such as understanding 'depression' in a broader sense when mentioned, rather than focusing on the speaker's perspective or the mere fact that the subject was discussed.
        
        Finally, from this analysis, create one comprehensive search query string, that encompasses all key subjects or claims identified in the transcription. {format_instructions} {title} {transcription}`,
      ),
      new OpenAI({ temperature: 0, modelName: 'gpt-4-1106-preview' }),
      parser,
    ]);

    let parsed;

    try {
      parsed = await transcriptChain.invoke({
        format_instructions: parser.getFormatInstructions(),
        title,
        transcription: transcriptionJob.text,
      });
    } catch (error) {
      console.log(error);
    }

    return parsed?.answer ? parsed?.answer : null;
  }

  async mainClaimFinder(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string> {
    const parserMainClaim = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'extract the query property',
    });

    const formatInstructionsMainClaim = parserMainClaim.getFormatInstructions();

    const promptMainClaim = new PromptTemplate({
      template: `
      Succinctly state the main claim within a 16-word limit, capturing its essence as supported by the provided transcript/text and any relevant documents/context, labelled as query.
      
      {format_instructions} {title} {transcription}`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructionsMainClaim },
    });

    const inputMainClaim = await promptMainClaim.format({
      transcription: transcriptionJob.text,
      title,
    });

    // const model = new OpenAI({ temperature: 0, modelName: 'gpt-4' });
    const modelMainClaim = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });

    // const model = new OpenAI({ temperature: 0 });

    const responseMainClaim = await modelMainClaim.call(inputMainClaim);

    const parsedMainClaim = await parserMainClaim.parse(responseMainClaim);

    console.log(parsedMainClaim);
    return parsedMainClaim.query;
  }

  async hydeClaimList(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string[]> {
    // List test
    // With a `CommaSeparatedListOutputParser`, we can parse a comma separated list.
    const parserList = new CommaSeparatedListOutputParser();

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(`Begin by analyzing the title for initial context. Delve into the transcription, identifying key subjects, specific claims, statistics, or notable statements, regardless of the topic. Assess the importance of each element based on its emphasis within the transcript and its potential impact on the overall narrative or discussion.

      Construct search queries that are tailored to these identified subjects and claims. Ensure queries are precise and succinct, ideally limited to 32 words, and avoid special characters like question marks, periods, or non-alphanumeric symbols. Focus on creating queries that explore the specifics of the situation, prioritizing those aspects that are most central or repeatedly mentioned in the transcript.
      
      Aim to gather comprehensive and detailed information about each subject, utilizing current, credible, and scientific sources. Explore each subject in depth, examining its relevance to the main event or issue, including legal, ethical, societal, historical, or cultural aspects, as applicable.
      
      When formulating your queries, consider the variety and complexity of topics that might arise in the transcript. Tailor your queries to cover a wide range of potential areas, from specific factual verifications to broader contextual inquiries.
      
      Finally, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription. Organize these queries based on the relevance and importance of each topic within the context of the transcript. This approach ensures a thorough and adaptable exploration of each significant aspect of the event or issue, tailored to the specific content of the transcript. This list should be of the 6 best queries you can think of.

      {format_instructions} {title} {transcription}`),
      new OpenAI({
        temperature: 0,
        modelName: 'gpt-4-1106-preview',
      }),
      parserList,
    ]);

    const responseList = await chain.invoke({
      transcription: transcriptionJob.text,
      title,
      format_instructions: parserList.getFormatInstructions(),
    });

    return responseList;
  }

  async combinedClaimSetup(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string[]> {
    const listOfClaims = this.utilsService.getAllClaimsFromTranscript(
      transcriptionJob,
      title,
    );
    const aClaimFinderPromise = this.aClaimFinder(transcriptionJob, title);
    const mainClaimFinderPromise = this.mainClaimFinder(
      transcriptionJob,
      title,
    );
    const hydeClaimList = this.hydeClaimList(transcriptionJob, title);

    const arrayPromises = [listOfClaims, mainClaimFinderPromise, hydeClaimList];

    if (aClaimFinderPromise) arrayPromises.push(aClaimFinderPromise);

    const combinedClaimsSearch = await Promise.all([
      listOfClaims,
      mainClaimFinderPromise,
      hydeClaimList,
    ]);
    return combinedClaimsSearch.flat().filter((claim) => claim !== undefined);
  }

  async transcriptSearchGen(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string[]> {
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        answer: z.string().describe('Copy the query string made'),
      }),
    );

    const transcriptChain = RunnableSequence.from([
      PromptTemplate.fromTemplate(
        `Begin by analyzing the title for initial context. Delve into the transcription, identifying key subjects, specific claims, statistics, or notable statements. Focus on extracting these core elements from the transcription, rather than the speaker's broader perspective or the general context of the discussion.
        
        Construct a search query that specifically targets the amalgamation of these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their scientific, psychological, and societal aspects.
        
        When formulating your query, ensure it is precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create a query that directly delves into the subjects themselves, such as understanding 'depression' in a broader sense when mentioned, rather than focusing on the speaker's perspective or the mere fact that the subject was discussed.
        
        Finally, from this analysis, create one comprehensive search query string, that encompasses all key subjects or claims identified in the transcription. {format_instructions} {title} {transcription}`,
      ),
      new OpenAI({ temperature: 0, modelName: 'gpt-4-1106-preview' }),
      parser,
    ]);

    let parsed;

    try {
      parsed = await transcriptChain.invoke({
        format_instructions: parser.getFormatInstructions(),
        title,
        transcription: transcriptionJob.text,
      });
    } catch (error) {
      console.log(error);
    }

    console.log(parsed);

    const parserMainClaim = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'extract the query property',
    });

    const formatInstructionsMainClaim = parserMainClaim.getFormatInstructions();

    const promptMainClaim = new PromptTemplate({
      template: `
      Succinctly state the main claim within a 16-word limit, capturing its essence as supported by the provided transcript/text and any relevant documents/context, labelled as query.
      
      {format_instructions} {title} {transcription}`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructionsMainClaim },
    });

    const inputMainClaim = await promptMainClaim.format({
      transcription: transcriptionJob.text,
      title,
    });

    // const model = new OpenAI({ temperature: 0, modelName: 'gpt-4' });
    const modelMainClaim = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });

    // const model = new OpenAI({ temperature: 0 });

    const responseMainClaim = await modelMainClaim.call(inputMainClaim);

    const parsedMainClaim = await parserMainClaim.parse(responseMainClaim);

    console.log(parsedMainClaim);

    // List test
    // With a `CommaSeparatedListOutputParser`, we can parse a comma separated list.
    const parserList = new CommaSeparatedListOutputParser();

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(`Begin by analyzing the title for initial context. Delve into the transcription, identifying key subjects, specific claims, statistics, or notable statements, regardless of the topic. Assess the importance of each element based on its emphasis within the transcript and its potential impact on the overall narrative or discussion.

      Construct search queries that are tailored to these identified subjects and claims. Ensure queries are precise and succinct, ideally limited to 32 words, and avoid special characters like question marks, periods, or non-alphanumeric symbols. Focus on creating queries that explore the specifics of the situation, prioritizing those aspects that are most central or repeatedly mentioned in the transcript.
      
      Aim to gather comprehensive and detailed information about each subject, utilizing current, credible, and scientific sources. Explore each subject in depth, examining its relevance to the main event or issue, including legal, ethical, societal, historical, or cultural aspects, as applicable.
      
      When formulating your queries, consider the variety and complexity of topics that might arise in the transcript. Tailor your queries to cover a wide range of potential areas, from specific factual verifications to broader contextual inquiries.
      
      Finally, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription. Organize these queries based on the relevance and importance of each topic within the context of the transcript. This approach ensures a thorough and adaptable exploration of each significant aspect of the event or issue, tailored to the specific content of the transcript. This list should be of the 3 best queries you can think of.

      {format_instructions} {title} {transcription}`),
      new OpenAI({
        temperature: 0,
        modelName: 'gpt-4-1106-preview',
      }),
      parserList,
    ]);

    const responseList = await chain.invoke({
      transcription: transcriptionJob.text,
      title,
      format_instructions: parserList.getFormatInstructions(),
    });

    if (parsed) {
      responseList.push(parsed.answer);
    }
    if (parsedMainClaim) {
      responseList.push(parsedMainClaim.query);
    }
    console.log(Array.from(new Set(responseList)));
    console.log(responseList.length);
    return Array.from(new Set(responseList));
    // return Array.from(new Set([parsed.query]));
  }

  async generalTextSearchGen(
    text: string,
    title: string,
  ): Promise<{ [x: string]: string }> {
    const parser = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'A detailed Google search query',
    });

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `Begin by analyzing the title for initial context. Then, delve deeply into the transcription, identifying key subjects, specific claims, statistics, or notable statements. Focus on extracting these core elements from the transcription, rather than the speaker's broader perspective or the general context of the discussion.

      Construct search queries that specifically target these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their scientific, psychological, and societal aspects.
      
      When formulating your queries, ensure they are precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create queries that directly delve into the subjects themselves, such as understanding 'depression' in a broader sense when mentioned, rather than focusing on the speaker's perspective or the mere fact that the subject was discussed.
      
      Finally, from this analysis, create one targeted search query per key subject or claim identified in the transcription. Create one search query. {format_instructions} {title} {transcription}`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const input = await prompt.format({
      transcription: text,
      title,
    });

    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });
    // const model = new OpenAI({ temperature: 0 });

    const response = await model.call(input);

    const parsed = await parser.parse(response);

    console.log(parsed);
    return parsed;
  }

  async reutersSearchGen(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<{ [x: string]: string }> {
    const parser = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'A detailed Google search query',
    });

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `Analyze the provided transcription, focusing on the central subject or theme. Use the title for additional context to understand the overarching focus. Identify the key subject or event from the transcription and title. Then, create a Google search query that targets this specific subject on Reuters.com. The query should be concise yet comprehensive, capturing the essence of the primary subject in the transcription. {format_instructions} {title} {transcription} Generate a focused Google search query on Reuters.com based on the primary subject identified.`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const input = await prompt.format({
      transcription: transcriptionJob.text,
      title,
    });

    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });
    // const model = new OpenAI({ temperature: 0 });

    const response = await model.call(input);

    const parsed = await parser.parse(response);

    console.log(parsed);
    return parsed;
  }

  // Purely text only. No video conversion
  async textOnlyChecker() {}

  // TESTER
  async langChainTest(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<{ [x: string]: string }> {
    const parser = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'A detailed Google search query',
    });

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `Using the title as a primary context, analyze the provided transcription in detail. The title often offers key insights into the overarching theme. Identify specific entities, events, or nuances from both the title and transcription, and then generate a detailed and contextually accurate search term for research on Google. Ensure that your query is aligned with the essence of both the title and the transcription. {format_instructions} {title} {transcription}`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const input = await prompt.format({
      transcription: transcriptionJob.text,
      title,
    });

    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });
    // const model = new OpenAI({ temperature: 0 });

    const response = await model.call(input);

    const parsed = await parser.parse(response);

    console.log(parsed);
    return parsed;
  }
}

// interface FactCheckSentence {
//   speaker: string;
//   text: string;
//   category: Category;
//   explanation: string
// }

// enum Category {
//   Question = "Question",
//   IncompleteStatement = "Incomplete Statement",
//   BaselessOpinion = "Baseless Opinion",
//   VerifiableFact = "Verifiable Fact",
//   GroundedSpeculation = "Grounded Speculation",
//   BaselessSpeculation = "Baseless Speculation",
// }

// interface Output {
//   sentence: FactCheckSentence[]
//   overalAssesment: string;
//   generalConclusion: string;
//   democraticConclusion: string;
//   furtherResources: string[]
// }

// PROMPT FOR THE FUTURE

// From the provided transcript, extract:

// The primary person, entity, or subject being discussed.
// The main event, action, or occurrence related to this subject.
// Any additional context or specific details that further clarify the main event or action.
// Using the extracted information, formulate a concise search query to gather more information on the topic.
