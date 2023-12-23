import { TensorFlowEmbeddings } from 'langchain/embeddings/tensorflow';
import {
  BadGatewayException,
  ImATeapotException,
  Inject,
  Injectable,
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
const stripchar = require('stripchar').StripChar;
import { OpenAI, PromptTemplate } from 'langchain';

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
    });

    const llm = new OpenAI({ temperature: 0, modelName: 'gpt-4-1106-preview' });

    // const baseCompressor = LLMChainExtractor.fromLLM(model);

    // First Phase
    // const searchTerm = !text
    //   ? await this.transcriptSearchGen(transcriptionJob, title)
    //   : await this.generalTextSearchGen(text, title);
    const searchTerm = await this.transcriptSearchGen(transcriptionJob, title);

    let searchResultFilter = [];

    for (const term of searchTerm) {
      let searchResults = await this.utilsService.searchTerm(term);
      const currentSearchResultFilter =
        this.utilsService.extractURLs(searchResults);
      searchResultFilter = [
        ...searchResultFilter,
        ...currentSearchResultFilter,
      ];
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

    const vectorStore = new WeaviateStore(new TensorFlowEmbeddings(), {
      client,
      indexName: 'Factsbolt',
      metadataKeys: ['source'],
    });

    await this.utilsService.webBrowserDocumentProcess(
      [
        ...searchResultFilter,
        // ...searchResultFilterReuters
      ],
      vectorStore,
    );

    const vectorStoreRetriever = new HydeRetriever({
      vectorStore,
      llm,
      k: 40,
      verbose: true,
    });

    const results = await vectorStoreRetriever.getRelevantDocuments(
      `Begin by analyzing the title for initial context. Then, delve deeply into the transcription, identifying key subjects, specific claims, statistics, or notable statements related to the main event or issue. Assess and prioritize these elements based on their contextual importance and relevance to the main discussion.
    
      Construct search queries that target these identified subjects and claims, with a focus on those deemed more significant. Ensure queries are precise and succinct, ideally limited to 32 words, and avoid the use of special characters like question marks, periods, or non-alphanumeric symbols. The goal is to create queries that delve into the specifics of the situation, giving priority to the most important aspects, such as key individual statements, significant legal proceedings, crucial organizational responses, and vital media coverage.
    
      Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their relevance to the main event, including legal, ethical, and societal aspects. Consider the significance of each fact in the context of the transcript and the broader discussion.
    
      Finally, from this analysis, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription, with an emphasis on those of higher priority. This approach ensures a thorough exploration of each significant aspect of the event or issue, with a focus on the most impactful elements.
      Title: ${title},
        Transcript: ${!text ? JSON.stringify(transcriptionJob.utterance) : text}
        
        Lastly, please uses sources with this most credibility as priority`,
    );

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

    const result = await chain.call({
      input_documents: fullResults,
      verbose: true,
      question: `
      Please evaluate the following transcript with the help of the documents/context provided, as context that might have come out after the 2023 training data. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Proceed with a methodical analysis of each major statement, while simultaneously maintaining an awareness of the overall context of the conversation. 
      
      Carefully dissect the transcript into distinct contextual sections, each focusing on a separate point or topic, while ensuring that each section is aware of and relates coherently to every other section, to allow for precise and targeted fact-checking of each segment independently as well as in the context of the entire transcript.
      
      Break down these statements into individual points or closely related sentences to understand the nuances, but regularly refer back to the broader conversation to ensure that each point is evaluated within its proper context. This approach aims to provide a thorough dissection of each statement while preserving the interconnectedness and flow of the conversation. By doing this, the evaluation will be more balanced, acknowledging both the specific details of individual statements and their meaning within the larger dialogue. For each point, identify it as either a Verified Fact, Provisionally Unverified, Personal Fact, Grounded Speculation, Grounded Opinion, Baseless Speculation, Baseless Opinion, Manipulative Opinion, Manipulative Speculation, Contextually Manipulated Fact, Question, or Incomplete Statement. Consider the context in which the statement is made to ensure accurate categorization.

      When evaluating each statement within the provided documents/context, conduct a meticulous assessment of each source's credibility. This evaluation should include an in-depth examination of the author's expertise and qualifications, the source's history of accuracy and reliability, any potential biases or agendas, and the timeliness and relevance of the information presented. Cross-reference facts with multiple reputable sources, prioritizing primary sources and recognized authorities in the field. In cases of conflicting information, seek additional corroborative sources to discern the most robustly supported viewpoint. Document each step of this evaluation process, providing explicit justifications for the credibility assigned to each source. Regularly update and review source credibility, especially for ongoing analyses, to ensure the most current and accurate information is being utilized. This rigorous approach to source evaluation is crucial to ensure that the analysis is grounded not only in factual accuracy but also in the reliability and integrity of the information's origin.

      Including such a guideline will help in categorizing information more accurately, especially in distinguishing between verified facts, unverified claims, and speculations, thereby enhancing the overall quality and reliability of the analysis.

      Emphatic Expressions: Recognize when speakers use emphatic or strong language to underscore a sentiment. Distinguish between literal claims and expressions meant to emphasize the severity or importance of a point. Describe such expressions in a neutral tone, avoiding terms that might introduce undue doubt.

      Nuance and Complexity: Ensure that the analysis reflects the depth and diversity of views on the subject. Strive to uncover and explore the foundational beliefs and assumptions underpinning the speaker's statements, going beyond surface-level interpretations. Recognize areas where evidence is strong, where it's emerging, and where there's legitimate debate. Avoid over-simplifications.

      Identify the main target or subject of the speaker's comments. Is the speaker criticizing or commenting on a specific individual, a group of people, a system or institution, or a general concept or idea? Try to determine the primary source of the speaker's sentiment and the main issue at stake, based on their statements.

      Ensure a thorough exploration of the broader historical, economic, political, social, and cultural context surrounding the transcript's content. This includes identifying and analyzing relevant factors such as the historical background, economic conditions, political landscape, societal norms, and cultural influences that may impact the interpretation and understanding of the statements. Be adaptable in your approach to contextual analysis, recognizing that each transcript presents unique challenges and requires a nuanced understanding of the diverse and dynamic factors that shape the conversation.

      "Verified facts are statements that present clear facts or claims about reality. For every verified fact, evaluation involves referencing training data up to April 2023 and considering any documented context supplied. Verification must include corroboration from at least one neutral, independent source, in addition to any other source. This can be done by:

      a) Quoting directly from context documents/context, including at least one neutral source, to serve as a citation.
      b) Referencing training data or external information, providing a specific reference akin to: 'As found in a study from [Specific Year] in [Specific Source Name],' or 'According to [Authoritative Source],' ensuring at least one of these is a neutral source.

      Facts or claims must align with well-established knowledge and be corroborated by credible sources, including at least one independent and neutral source. When a statement aligns with training data and documented context, elaborate on why it is considered a verified fact, discussing its factual accuracy, source credibility, and potential implications or applications. If the fact is part of a larger narrative with a specific intent (e.g., manipulative, speculative), this context should be noted, with emphasis on neutral source corroboration to ensure unbiased verification."

      Within the source verification, specifically reference the actual source used for verification, providing clarity on how it supports the fact.

      Partially  Verified: Statements or claims categorized as "Partially  Verified" are those where the available evidence or sources are insufficient for full verification but also do not warrant outright dismissal. This category recognizes the potential validity of the information while acknowledging that it requires further evidence or corroboration.

      Contextually Manipulated Facts: Identify statements that present facts or claims verified through your training data up to April 2023, documented context, or credible public sources, but are potentially misleading or taken out of context. Label these as 'Contextually Manipulated Fact.' Confirm the factual accuracy of the statement and provide a detailed analysis of the context in which it is presented. Discuss what additional information is necessary for a full understanding and if the source or presentation contributes to a misleading or manipulative narrative. Evaluate the potential utility and harm of these manipulated facts, discussing how they could be used or misused in different scenarios. Include any counterpoints or alternative perspectives that could add valuable context to the fact in question, noting if these counterpoints are supported by your training data or other credible sources.

      Unverified Claims: Identify statements presented as facts or claims about reality that currently lack verifiable evidence or reliable sources for substantiation. Label these as 'Unverified Claim.' In your analysis, explain why the statement remains unverified, highlighting the limitations of the available resources or search capabilities that might have led to this conclusion. Note that while the claim remains unverified at the moment, it does not necessarily mean it is false — further research or future information could potentially verify it. Discuss the potential implications of the claim, including how it might be used or misused in different contexts if accepted without verification, and encourage the audience to consider the claim with a critical perspective, acknowledging the current limitations in verifying its accuracy.
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

      Labelled, Consideration of Multiple Perspectives: Evaluate the primary perspective of the speaker. If they focus on a specific viewpoint or aspect, recognize that without introducing undue doubt. However, note if there are widely recognized alternative perspectives or nuances that the speaker might not have covered.

      Labelled, Fact Check Conclusion: Assess the general conclusion and overall reliability of a speaker's statements, then distill this information into a succinct "Fact Check Conclusion." Consider both the evidence presented and any logical or common-sense assumptions that may support the advice or information. The conclusion should guide the reader in layman terms on the practicality, potential reliability, and applicability of the content, even when full evidence isn't available.

      Labelled, Democratic Values and Consensus: Assess the extent to which the speaker's views and arguments align with democratic values, principles, and the current democratic consensus on the topic. Note any instances where the speaker's views diverge from these democratic standards and discuss how this might influence the conversation and the audience's understanding of the topic. Compare the speaker's views with the prevailing democratic consensus, noting any areas of agreement or disagreement.

      Labelled, Contextual Conclusion: Summarize the overall context in which facts, opinions, and speculations are presented in the transcript. Explicitly flag and highlight any recurring themes of contextual manipulation, misleading presentation, or instances where grounded opinions and speculations are used manipulatively. Assess the broader implications of these contextual issues on the validity of the speaker's arguments, the potential impact on public perception, and any attempts to steer the narrative away from the truth. This conclusion should guide the reader in understanding the practicality, reliability, and applicability of the content, especially in the context of any manipulative tactics identified.

      Labelled, Middle Ground Conclusion: In this section, we synthesize the diverse viewpoints presented in the transcript, aiming to uncover common ground and balanced perspectives. This involves summarizing key points from all sides, identifying shared goals, values, or acknowledged facts, despite differing opinions. We highlight areas of potential agreement and overlap, suggesting how various perspectives might be reconciled to form a more comprehensive understanding of the issue. This balanced view is not only about finding a compromise but also about recognizing how different viewpoints contribute to a fuller picture. We propose pathways for constructive dialogue based on these findings, emphasizing how a unified approach can lead to practical and effective solutions. Additionally, we assess the real-world implications of these middle-ground perspectives, considering their potential application in policy-making and societal impact. Lastly, we identify areas that require further discussion or research, acknowledging that the path to consensus often involves ongoing dialogue and exploration. This approach strives to foster a constructive and inclusive conversation, moving beyond polarization towards collaborative problem-solving.

      Note: In all sections labeled as 'Assessment,' 'Conclusion,' or any variations thereof—both present and those that may be added in the future—please provide a highly detailed and verbose response. These designated sections are intended to yield a comprehensive and nuanced understanding of the topic. Conciseness is acceptable for other sections not falling under these categories.

      Labelled, Resources, then, provide a list of resources or facts that offer greater context and insight into the broader issue. Ensure these resources come from credible and respected origins, are recognized for their sound advice and dependability across the relevant community, have stood the test of scrutiny and critical examination, are penned by authors without significant controversies in their background, and where feasible, include direct links for further exploration. Recommendations should lean towards sources with broad consensus, steering clear of those with mixed or contentious opinions.

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
        sourceVerification: string; 
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
        Partially Verified = "Partially  Verified"
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

      Lastly, if there's a case of not enough information being stated, please advise on a search term that may help collect the information.
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
      middlegroundConclusion: 'extract the middleground conclusion section',
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

  async transcriptSearchGen(
    transcriptionJob: TranscriptionJob,
    title: string,
  ): Promise<string[]> {
    const parser = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'extract the query',
    });

    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `
      Begin by analyzing the title for initial context. Delve into the transcription, identifying key subjects, specific claims, statistics, or notable statements. Focus on extracting these core elements from the transcription, rather than the speaker's broader perspective or the general context of the discussion.
      
      Construct a search query that specifically targets the amalgamation of these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their scientific, psychological, and societal aspects.
      
      When formulating your query, ensure it is precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create a query that directly delves into the subjects themselves, such as understanding 'depression' in a broader sense when mentioned, rather than focusing on the speaker's perspective or the mere fact that the subject was discussed.
      
      Finally, from this analysis, create one comprehensive search query that encompasses all key subjects or claims identified in the transcription.. {format_instructions} {title} {transcription}`,
      inputVariables: ['transcription', 'title'],
      partialVariables: { format_instructions: formatInstructions },
    });

    const input = await prompt.format({
      transcription: transcriptionJob.text,
      title,
    });

    // const model = new OpenAI({ temperature: 0, modelName: 'gpt-4' });
    const model = new OpenAI({
      temperature: 0,
      modelName: 'gpt-4-1106-preview',
    });

    // const model = new OpenAI({ temperature: 0 });

    const response = await model.call(input);

    const parsed = await parser.parse(response);

    console.log(parsed);

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

    // const chain = RunnableSequence.from([
    //   PromptTemplate.fromTemplate(`Begin by analyzing the title for initial context. Then, delve deeply into the transcription, identifying key subjects, specific claims, statistics, or notable statements related to the main event or issue. Focus on extracting these core elements from the transcription, concentrating on the specifics of the situation rather than the speaker's broader perspective or the general context of the discussion.

    //   Construct search queries that specifically target these identified subjects and claims. Aim to gather comprehensive and detailed information about them, utilizing current, credible, and scientific sources. Explore the subjects in depth, examining their relevance to the main event, including legal, ethical, and societal aspects.

    //   When formulating your queries, ensure they are precise and succinct, ideally limited to 32 words. Avoid the use of special characters like question marks, periods, or any non-alphanumeric symbols. The goal is to create queries that delve directly into the specifics of the situation, such as individual statements, legal proceedings, organizational responses, and media coverage.

    //   Finally, from this analysis, create a list of targeted search queries, each corresponding to a key subject or claim identified in the transcription. This approach ensures a thorough exploration of each significant aspect of the event or issue.

    //   {format_instructions} {title} {transcription}`),
    //   new OpenAI({
    //     temperature: 0,
    //     modelName: 'gpt-4-1106-preview',
    //   }),
    //   parserList,
    // ]);

    const responseList = await chain.invoke({
      transcription: transcriptionJob.text,
      title,
      format_instructions: parserList.getFormatInstructions(),
    });

    responseList.push(parsed.query);
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
