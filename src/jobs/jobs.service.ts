import { TensorFlowEmbeddings } from 'langchain/embeddings/tensorflow';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import {
  AudioInformation,
  ChatGPT,
  CompletedVideoJob,
  FullJob,
  Speech,
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
import { AmendedSpeech, AmendedUtterance, Utterance } from 'factsbolt-types';
import { OpenAI, PromptTemplate } from 'langchain';
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio';

import { PuppeteerWebBaseLoader } from 'langchain/document_loaders/web/puppeteer';

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { HtmlToTextTransformer } from 'langchain/document_transformers/html_to_text';
import { MozillaReadabilityTransformer } from 'langchain/document_transformers/mozilla_readability';
import { LLMChainExtractor } from 'langchain/retrievers/document_compressors/chain_extract';
import { ContextualCompressionRetriever } from 'langchain/retrievers/contextual_compression';

import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import {
  RetrievalQAChain,
  loadQAChain,
  loadQAStuffChain,
} from 'langchain/chains';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { UtilsService } from '../utils/utils.service';
import { HydeRetriever } from 'langchain/retrievers/hyde';
import { faker } from '@faker-js/faker';

import weaviate from 'weaviate-ts-client';
import { WeaviateStore } from 'langchain/vectorstores/weaviate';
import { Document } from 'langchain/document';

@Injectable()
export class JobsService {
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
      quality: 'best', // or "lowest"; default: "best"
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
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          // {
          //   role: 'user',
          //   content: `Please evaluate the following transcript. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Then, break down each major statement into individual points. For each point, identify it as either a verifiable fact, personal fact, grounded speculation, grounded opinion, baseless speculation, baseless opinion, or a question.

          //   Verifiable facts: Identify any statement that presents a clear fact or claim about reality that can be confirmed using publicly accessible data, well-established knowledge in the field, or widely recognized information. Elaborate on why you believe it to be a verifiable fact and provide detailed information and references that support it. Discuss the potential utility of this fact, including how it could be used or applied in different scenarios.

          //   Personal facts: Note any statements that are based on personal experience or knowledge and are true for the individual, but can't be independently verified by others. Discuss the potential utility of this personal fact, including how it may influence understanding or perspective.

          //   Grounded Speculations: Label a statement as grounded speculation if it makes a prediction or guess about the future based on current trends or data. Discuss the current trends, data, or historical events that support this speculation. Evaluate the potential utility or impact if this speculation was acted upon.

          //   Grounded Opinions: Recognize statements of personal preference or judgement as grounded opinions if they are based in well-reasoned thinking or empirical evidence. Discuss the empirical evidence or logical reasoning that supports these grounded opinions, and discuss the potential utility or impact of these grounded opinions if adopted.

          //   Baseless Speculation: Identify statements that speculate or predict without a clear or logical basis in data or facts. As this could potentially be misleading or damaging, no utility analysis will be provided for these points.

          //   Baseless Opinions: Recognize statements of personal judgement or bias that are not backed by evidence or sound reasoning. Like with baseless speculation, no utility analysis will be provided due to the potential for misinformation or harm.

          //   Questions: These are inquiries or requests for information, often seeking clarification or further details on a particular topic. Discuss the utility of these questions in providing greater clarity or understanding.

          //   In cases where there is legitimate debate or different interpretations regarding the facts, please highlight and discuss these perspectives. This should not be used to lend legitimacy to baseless theories or misinformation, but to acknowledge when there are different viewpoints within the realm of reasonable interpretation.

          //   Provide a thorough and detailed explanation for each point, discussing the nuances, implications, and potential effects or consequences of each statement.

          //   After categorizing and explaining each point, provide an in-depth overall assessment of the content. This should include a discussion of any major inaccuracies, unsupported claims, or misleading information, an evaluation of the overall validity of the points presented, an exploration of the implications or potential effects of these points, and a review of any notable strengths or weaknesses in the arguments made.

          //   Following this overall assessment, provide a general conclusion. Instead of categorizing the conversation as a whole, critically evaluate whether the strategies, advice, or opinions expressed align with the best practices as recognized by leading experts, authoritative bodies in the field, or reputable scientific research. Assess whether these strategies, advice, or opinions align with the prevailing consensus among experts in the field. Comment on how the speakers' views align or contrast with these recognized best practices and consensus, not merely what is popular or commonly accepted. Especially note any instances of both grounded and baseless speculation and discuss how they may influence perceptions and understandings of the topic. Then, provide a list of further resources or facts about the topic that can give more context and understanding of the broader issue to the user, in bullet point format. These resources should be from credible sources, and if possible, include direct links for further reference.

          //   Each major statement should be analyzed separately, maintaining a structured and thorough approach throughout the analysis.

          //   Please note that the transcript is an array of speeches from speakers using this format:

          //   export interface AmendedSpeech {
          //     speaker: string;
          //     text: string;
          //   }

          //   You will be given an array after the transcription which will have the type of AmendedSpeech or more.

          //   Video title: ${title}
          //   Transcript: ${JSON.stringify(transcription, null, 2)}`,
          // },

          // {
          //   role: 'user',
          //   content: `"Please evaluate the following transcript, diving deep into foundational assumptions or beliefs of the speaker. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Avoid surface-level interpretations and strive for depth and nuance. Then, break down each major statement into individual points. For each point, identify it as either a verifiable fact, personal fact, grounded speculation, grounded opinion, baseless speculation, baseless opinion, or a question.

          //   Identify the main target or subject of the speaker's comments. Is the speaker criticizing or commenting on a specific individual, a group of people, a system or institution, or a general concept or idea? Try to determine the primary source of the speaker's sentiment and the main issue at stake, based on their statements.

          //   Verifiable facts: Identify any statement that presents a clear fact or claim about reality that can be confirmed using publicly accessible data, well-established knowledge in the field, or widely recognized information. Elaborate on why you believe it to be a verifiable fact and provide detailed information and references that support it. Discuss the potential utility of this fact, including how it could be used or applied in different scenarios.

          //   Personal facts: Note any statements that are based on personal experience or knowledge and are true for the individual, but can't be independently verified by others. Discuss the potential utility of this personal fact, including how it may influence understanding or perspective.

          //   Grounded Speculations: Label a statement as grounded speculation if it makes a prediction or guess about the future based on current trends or data. Discuss the current trends, data, or historical events that support this speculation. Evaluate the potential utility or impact if this speculation was acted upon.

          //   Grounded Opinions: Recognize statements of personal preference or judgement as grounded opinions if they are based in well-reasoned thinking or empirical evidence. Discuss the empirical evidence or logical reasoning that supports these grounded opinions, and discuss the potential utility or impact of these grounded opinions if adopted.

          //   Baseless Speculation: Identify statements that speculate or predict without a clear or logical basis in data or facts. As this could potentially be misleading or damaging, no utility analysis will be provided for these points.

          //   Baseless Opinions: Recognize statements of personal judgement or bias that are not backed by evidence or sound reasoning. Like with baseless speculation, no utility analysis will be provided due to the potential for misinformation or harm.

          //   Questions: These are inquiries or requests for information, often seeking clarification or further details on a particular topic. Discuss the utility of these questions in providing greater clarity or understanding.

          //   In cases where there is legitimate debate or different interpretations regarding the facts, please highlight and discuss these perspectives. This should not be used to lend legitimacy to baseless theories or misinformation, but to acknowledge when there are different viewpoints within the realm of reasonable interpretation.

          //   Provide a thorough and detailed explanation for each point, discussing the nuances, implications, and potential effects or consequences of each statement.

          //   After categorizing and explaining each point, provide an in-depth overall assessment of the content. This should include a discussion of any major inaccuracies, unsupported claims, or misleading information, an evaluation of the overall validity of the points presented, an exploration of the implications or potential effects of these points, and a review of any notable strengths or weaknesses in the arguments made.

          //   Following this overall assessment, provide a general conclusion, labeled general conclusion. Instead of categorizing the conversation as a whole, critically evaluate whether the strategies, advice, or opinions expressed align with the best practices as recognized by leading experts, authoritative bodies in the field, or reputable scientific research.

          //   Assess not just whether these strategies, advice, or opinions are widely accepted or popular, but also whether they align with the prevailing consensus among experts in the field.

          //   Additionally, ensure to differentiate between views held by the majority and those held by a minority that may seem to be growing in influence. It's important not to incorrectly attribute a minority viewpoint as a majority consensus if a significantly larger consensus exists on a particular topic.

          //   Comment on how the speakers' views align or contrast with these recognized best practices and consensus. Especially note any instances of both grounded and baseless speculation and discuss how they may influence perceptions and understandings of the topic.

          //   In particular, assess the extent to which the speaker's sentiment is shared among the majority, and whether this majority consensus itself aligns with best practices or expert opinion. Be critical in distinguishing between common critiques or views and those which are supported by empirical evidence and expert consensus. Avoid drawing conclusions solely based on the prevalence of a particular view without examining its grounding in established and credible sources of knowledge in the field.

          //   Democratic Values and Consensus: Assess the extent to which the speaker's views and arguments align with democratic values, principles, and the current democratic consensus on the topic. Note any instances where the speaker's views diverge from these democratic standards and discuss how this might influence the conversation and the audience's understanding of the topic. Compare the speaker's views with the prevailing democratic consensus, noting any areas of agreement or disagreement.

          //   Then, provide a list of further resources or facts about the topic that can give more context and understanding of the broader issue to the user, in bullet point format. These resources should be from credible sources, and if possible, include direct links for further reference.

          //   Each major statement should be analyzed separately, maintaining a structured and thorough approach throughout the analysis.

          //   Please note that the transcript is an array of speeches from speakers using this format:

          //   export interface AmendedSpeech {
          //     speaker: string;
          //     text: string;
          //   }

          //   You will be given an array after the transcription which will have the type of AmendedSpeech or more.

          //   Video title: ${title}
          //   Transcript: ${JSON.stringify(transcription, null, 2)}`,
          // },
        ],
      });
    } catch (error) {
      console.log(error);
    }

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

  async factCheckLang(title: string, transcriptionJob: TranscriptionJob) {
    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4',
      // modelName: 'gpt-3.5-turbo-16k',
    });

    // Something wrong with the weaviate-ts-client types, so we need to disable
    const client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'localhost:8080',
    });

    const llm = new OpenAI({ modelName: 'gpt-3.5-turbo-16k' });

    // const baseCompressor = LLMChainExtractor.fromLLM(model);

    const searchTerm = await this.transcriptSearchGen(transcriptionJob, title);

    const cbdResult = await this.utilsService.searchTerm(searchTerm.query);
    const cbdResultFilter = this.utilsService.extractURLs(cbdResult);

    // const embeddings = new OpenAIEmbeddings();
    // const vectorStore = new MemoryVectorStore(embeddings);

    const vectorStore = new WeaviateStore(new OpenAIEmbeddings(), {
      client,
      indexName: 'Factsbolt',
      metadataKeys: ['source'],
    });

    for (const result of cbdResultFilter) {
      if (result.includes('youtube')) continue;
      const loader = new PuppeteerWebBaseLoader(result, {
        launchOptions: {
          headless: 'new',
        },
      });

      // const loader = new CheerioWebBaseLoader(result);

      let docs;

      try {
        docs = await loader.load();
      } catch (error) {
        // console.log(`${result} failed`);
        continue;
      }

      const splitter = RecursiveCharacterTextSplitter.fromLanguage('html', {
        chunkSize: 1500, // Roughly double the current estimated chunk size
        chunkOverlap: 10, // This is arbitrary; adjust based on your needs
        separators: ['\n\n', '. ', '! ', '? ', '\n', ' ', ''],
      });

      const transformer = new MozillaReadabilityTransformer();

      const sequence = splitter.pipe(transformer);

      let newDocuments: Document[];

      try {
        newDocuments = await sequence.invoke(docs);
      } catch (error) {
        console.log('invoke broke');
        continue;
      }

      const filteredDocuments: Document[] = newDocuments.filter(
        (doc: Document) => {
          return doc.pageContent ? true : false;
        },
      );
      try {
        await vectorStore.delete({
          filter: {
            where: {
              operator: 'Equal',
              path: ['source'],
              valueText: result,
            },
          },
        });
        await vectorStore.addDocuments(filteredDocuments);
        // await WeaviateStore.fromDocuments(
        //   filteredDocuments,
        //   new OpenAIEmbeddings(),
        //   client,
        // );
      } catch (error) {
        console.log(error);
        console.log(`${result} failed`);
      }

      console.log('done');
    }

    const vectorStoreRetriever = new HydeRetriever({
      vectorStore,
      llm,
      k: 6,
      verbose: true,
    });

    const results = await vectorStoreRetriever.getRelevantDocuments(
      `Using the title for context and details from the transcription, extract key entities and nuances. Then, combine these insights to form a contextually accurate search query, ensuring alignment with both the title and transcription's essence: 
      Title: ${title},
      Transcript: ${JSON.stringify(transcriptionJob.utterance, null, 2)}`,
    );

    const chain = loadQAStuffChain(model, {});

    const vectorStoreRetrieverFactFinder = new HydeRetriever({
      vectorStore,
      llm,
      k: 4,
      verbose: true,
    });

    const factSources =
      await vectorStoreRetrieverFactFinder.getRelevantDocuments(
        `Given the following title and transcript, first identify key phrases or entities that are the focus of factual claims, speculations, or opinions. Then, classify the content into broad categories such as 'economy', 'politics', etc. Finally, retrieve the most relevant documents that could help in fact-checking the identified facts, speculations, and opinions:
        Title: ${title},
        Transcript: ${JSON.stringify(transcriptionJob.utterance, null, 2)}`,
      );

    const fullResults = [...results, ...factSources];

    const result = await chain.call({
      input_documents: fullResults,
      question: `
      The Question, please evaluate the following transcript with the help of the documents provided before as context that might have come out after the 2021 training data. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Then, break down each major statement into individual points following the interface FactCheckSentence shape.

      Please evaluate the following transcript with the help of the documents provided before, as context that might have come out after the 2021 training data. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Then, break down each major statement into individual points or closely related sentences for a nuanced understanding. For each point, identify it as either a Verified Fact, Personal Fact, Grounded Speculation, Grounded Opinion, Baseless Speculation, Baseless Opinion, Manipulative Opinion, Manipulative Speculation, Contextually Manipulated Fact, Question, or Incomplete Statement. Consider the context in which the statement is made to ensure accurate categorization.

      Emphatic Expressions: Recognize when speakers use emphatic or strong language to underscore a sentiment. Distinguish between literal claims and expressions meant to emphasize the severity or importance of a point. Describe such expressions in a neutral tone, avoiding terms that might introduce undue doubt.

      Nuance and Complexity: Ensure that the analysis reflects the depth and diversity of views on the subject. Strive to uncover and explore the foundational beliefs and assumptions underpinning the speaker's statements, going beyond surface-level interpretations. Recognize areas where evidence is strong, where it's emerging, and where there's legitimate debate. Avoid over-simplifications.

      Identify the main target or subject of the speaker's comments. Is the speaker criticizing or commenting on a specific individual, a group of people, a system or institution, or a general concept or idea? Try to determine the primary source of the speaker's sentiment and the main issue at stake, based on their statements.

      Verified facts: Identify any statement that presents a clear fact or claim about reality. Evaluate the statement by referencing your training data up to September 2021 and consider any documented context supplied. Assert facts or claims that align with well-established knowledge or are corroborated by credible sources. If the statement in question aligns with your training data and the documented context, elaborate on why you believe it to be a verified fact. Discuss the factual accuracy, source credibility, and the potential implications or applications of the fact. If the fact is part of a larger narrative that has a specific intent (e.g., manipulative, speculative), note that context.

      Contextually Manipulated Facts: Identify statements that present facts or claims verified through your training data up to September 2021, documented context, or credible public sources, but are potentially misleading or taken out of context. Label these as 'Contextually Manipulated Fact.' Confirm the factual accuracy of the statement and provide a detailed analysis of the context in which it is presented. Discuss what additional information is necessary for a full understanding and if the source or presentation contributes to a misleading or manipulative narrative. Evaluate the potential utility and harm of these manipulated facts, discussing how they could be used or misused in different scenarios. Include any counterpoints or alternative perspectives that could add valuable context to the fact in question, noting if these counterpoints are supported by your training data or other credible sources.

      Unverified Claims: Identify statements that are presented as facts or claims about reality but lack verifiable evidence or reliable sources to substantiate them. Label these as 'Unverified Claim.' Provide a detailed analysis of why the statement remains unverified, including the absence of publicly accessible data or well-established knowledge in the field to support it. Discuss the potential implications of the claim, including how it could be used or misused in different contexts if accepted without verification.

      Personal facts: Note any statements that are based on personal experience or knowledge and are true for the individual, but can't be independently verified by others. Discuss the potential utility of this personal fact, including how it may influence understanding or perspective.

      Grounded Speculations: Label a statement as grounded speculation if it makes a prediction or guess about the future based on current trends or data. Discuss the current trends, data, or historical events that support this speculation. Evaluate the potential utility or impact if this speculation was acted upon.

      Grounded Opinions: Recognize statements of personal preference or judgment as grounded opinions if they are based on well-reasoned thinking or empirical evidence. These statements should be supported by logical reasoning or data that can be independently verified. Discuss the empirical evidence or logical reasoning that supports these grounded opinions, and discuss the potential utility or impact of these grounded opinions if adopted.
      
      Baseless Speculation: Identify statements that speculate or predict without a clear or logical basis in data or facts. As this could potentially be misleading or damaging, no utility analysis will be provided for these points.

      Baseless Opinions: Recognize statements of personal judgement or bias that are not backed by evidence or sound reasoning. Like with baseless speculation, no utility analysis will be provided due to the potential for misinformation or harm.

      Manipulative Opinion: Identify statements that express a viewpoint or judgment and are presented in a way that aims to deceive, mislead, or provoke strong emotional responses. This could include the use of emotionally charged language, exaggerations, or rhetorical devices designed to manipulate the audience's perception. Whether the opinion is grounded in empirical evidence or not, provide an analysis that discusses the underlying evidence or reasoning, if any, and how it is being used manipulatively.

      Manipulative Speculation: Identify statements that make predictions or guesses, whether based on current trends, data, or without any clear basis, but are presented in a misleading or deceptive manner. Label these as 'Manipulative Speculation'. Discuss any trends, data, or historical events that may or may not support this speculation, and elaborate on how the statement is being used to deceive or mislead.

      Questions: These are inquiries or requests for information, often seeking clarification or further details on a particular topic. Discuss the utility of these questions in providing greater clarity or understanding.

      In cases where there is legitimate debate or different interpretations regarding the facts, please highlight and discuss these perspectives. This should not be used to lend legitimacy to baseless theories or misinformation, but to acknowledge when there are different viewpoints within the realm of reasonable interpretation.

      Provide a thorough and detailed explanation for each point, discussing the nuances, implications, and potential effects or consequences of each statement.

      After categorizing and explaining each point, provide an in-depth overall assessment of the content, labelled as overall assessment. This should include a discussion of any major inaccuracies, unsupported claims, or misleading information, an evaluation of the overall validity of the points presented, an exploration of the implications or potential effects of these points, and a review of any notable strengths or weaknesses in the arguments made. State the categories that appeared with regularity

      Afterwards, we'll do a Consensus Check, labelled as Consensus Check. Start by immediately stating if the views or information presented align or do not align with recognized best practices, consensus, or research in the field. After this initial alignment statement, delve into the specifics. Evaluate the content to determine how closely it matches the prevailing consensus, recognized best practices, the most robust evidence available, and the latest, most accepted research. Summarize the primary sentiments or messages of the content. If these views are in accordance with well-established norms or knowledge, detail the reasons for this alignment. Conversely, if there are discrepancies, specify the reasons for non-alignment. Additionally, critically examine any strategies, advice, or opinions shared and assess how they compare with the consensus of leading experts, authoritative bodies, or reputable scientific research.

      Assess not just whether these strategies, advice, or opinions are widely accepted or popular, but also whether they align with the prevailing consensus among experts in the field.

      Additionally, ensure to differentiate between views held by the majority and those held by a minority that may seem to be growing in influence. It's important not to incorrectly attribute a minority viewpoint as a majority consensus if a significantly larger consensus exists on a particular topic.

      Comment on how the speakers' views align or contrast with these recognized best practices and consensus. Especially note any instances of both grounded and baseless speculation and discuss how they may influence perceptions and understandings of the topic.

      In particular, assess the extent to which the speaker's sentiment is shared among the majority, and whether this majority consensus itself aligns with best practices or expert opinion. Be critical in distinguishing between common critiques or views and those which are supported by empirical evidence and expert consensus. Avoid drawing conclusions solely based on the prevalence of a particular view without examining its grounding in established and credible sources of knowledge in the field.

      Labedlled, Consideration of Multiple Perspectives: Evaluate the primary perspective of the speaker. If they focus on a specific viewpoint or aspect, recognize that without introducing undue doubt. However, note if there are widely recognized alternative perspectives or nuances that the speaker might not have covered.

      Labedlled, Fact Check Conclusion: Assess the general conclusion and overall reliability of a speaker's statements, then distill this information into a succinct "Fact Check Conclusion." Consider both the evidence presented and any logical or common-sense assumptions that may support the advice or information. The conclusion should guide the reader in layman terms on the practicality, potential reliability, and applicability of the content, even when full evidence isn't available.

      Labedlled, Democratic Values and Consensus: Assess the extent to which the speaker's views and arguments align with democratic values, principles, and the current democratic consensus on the topic. Note any instances where the speaker's views diverge from these democratic standards and discuss how this might influence the conversation and the audience's understanding of the topic. Compare the speaker's views with the prevailing democratic consensus, noting any areas of agreement or disagreement.

      Labedlled, Contextual Conclusion: Summarize the overall context in which facts, opinions, and speculations are presented in the transcript. Explicitly flag and highlight any recurring themes of contextual manipulation, misleading presentation, or instances where grounded opinions and speculations are used manipulatively. Assess the broader implications of these contextual issues on the validity of the speaker's arguments, the potential impact on public perception, and any attempts to steer the narrative away from the truth. This conclusion should guide the reader in understanding the practicality, reliability, and applicability of the content, especially in the context of any manipulative tactics identified.

      Note: In all sections labeled as 'Assessment,' 'Conclusion,' or any variations thereof—both present and those that may be added in the future—please provide a highly detailed and verbose response. These designated sections are intended to yield a comprehensive and nuanced understanding of the topic. Conciseness is acceptable for other sections not falling under these categories.

      Labedlled, Resources, then, provide a list of resources or facts that offer greater context and insight into the broader issue. Ensure these resources come from credible and respected origins, are recognized for their sound advice and dependability across the relevant community, have stood the test of scrutiny and critical examination, are penned by authors without significant controversies in their background, and where feasible, include direct links for further exploration. Recommendations should lean towards sources with broad consensus, steering clear of those with mixed or contentious opinions.

      Each major statement should be analyzed separately, maintaining a structured and thorough approach throughout the analysis.

      Please note that the transcript is an array of speeches from speakers using this format:

      export interface AmendedSpeech {
        speaker: string;
        text: string;
      }

      You will be given an array after the transcription which will have the type of AmendedSpeech or more.

      I've made these interfaces to help assist in the Output structure.

      interface FactCheckSentence {
        speaker: string;
        text: string;
        category: Category;
        explanation: string
        contextualAnalysis?: string // Optional field for contextual analysis
        sourceVerification?: string; // Optional field for source verification
      }

      enum Category {
        Question = "Question",
        IncompleteStatement = "Incomplete Statement",
        GroundedOpinion = "Grounded Opinion",
        ManipulativeOpinion = "Manipulative Opinion"
        BaselessOpinion = "Baseless Opinion",
        VerifiedFact = "Verified Fact",
        ContextuallyManipulatedFact = "Contextually Manipulated Fact",
        UnverifiedClaims = "Unverified Claims",
        PersonalFact = "Personal Fact",
        GroundedSpeculation = "Grounded Speculation",
        ManipulativeSpeculation = "Manipulative Speculation",
        BaselessSpeculation = "Baseless Speculation",
      }


      interface Output {
        sentence: FactCheckSentence[]
        overalAssesment: string;
        consensusCheck: string;
        factCheckConclusion: string;
        considerationOfMultiplePerspectives: string;
        democraticConclusion: string;
        contextualConclusion: string;
        furtherResources: string[] // with link
      }

      title of video: ${title},
      Transcript of video: ${JSON.stringify(
        transcriptionJob.utterance,
        null,
        2,
      )}.

      If by any chance you can't assist, state exactly why, and show the transcript
      `,
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
    });

    const formatInstructions = parser.getFormatInstructions();

    const formatPrompt = new PromptTemplate({
      template:
        'Using the following result text, please extract and format correctly to the JSON format which has been requested..\n{format_instructions}\n{result}',
      inputVariables: ['result'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const formatParseModel = new OpenAI({ temperature: 0, modelName: 'gpt-4' });

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

    const completeFactsJob = await this.factCheckLang(
      completedVideoJob.video.name,
      transcriptionJob,
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

  checkURL(url: string) {
    const youtube = ['youtube', 'youtu.be'];
    let site: string;

    for (const hostname of youtube) {
      if (url.includes(hostname)) site = 'youtube';
    }

    switch (site) {
      case 'youtube':
        return 'Youtube';
      default:
        return 'No Site Found';
    }
  }

  async transcriptSearchGen(
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

    const model = new OpenAI({ temperature: 0, modelName: 'gpt-4' });
    // const model = new OpenAI({ temperature: 0 });

    const response = await model.call(input);

    const parsed = await parser.parse(response);

    console.log(parsed);
    return parsed;
  }

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

    const model = new OpenAI({ temperature: 0, modelName: 'gpt-4' });
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
//   GroundedOpinion = "Grounded Opinion",
//   BaselessOpinion = "Baseless Opinion",
//   VerifiableFact = "Verifiable Fact",
//   PersonalFact = "Personal Fact",
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
