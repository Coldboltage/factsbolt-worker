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

    let searchTerm;
    let searchResultFilter = [];

    if (process.env.SEARCH_GOOGLE === 'true') {
      searchTerm = await this.transcriptSearchGen(transcriptionJob, title);

      for (const term of searchTerm) {
        let searchResults = await this.utilsService.searchTerm(term);
        const currentSearchResultFilter =
          this.utilsService.extractURLs(searchResults);
        searchResultFilter = [
          ...searchResultFilter,
          ...currentSearchResultFilter,
        ];
      }
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

    if (process.env.SEARCH_GOOGLE === 'true') {
      await this.utilsService.webBrowserDocumentProcess(
        [
          ...searchResultFilter,
          // ...searchResultFilterReuters
        ],
        vectorStore,
      );
    }

    const vectorStoreRetriever = new HydeRetriever({
      vectorStore,
      llm,
      k: 4,
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

    const example = this.utilsService.promptExample();

    // const breakdownStatements = this.utilsService.breakdownTranscript(transcriptionJob.utterance)

    const result = await chain.call({
      input_documents: fullResults,
      verbose: true,
      question: `
      Please evaluate the following transcript with the help of the documents/context provided, as context that might have come out after the 2023 training data. 
            
      Labelled Context Summary, create a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Proceed with a methodical analysis of each major statement, while simultaneously maintaining an awareness of the overall context of the conversation. 

      ## Evaluate the Transcript with an Emphasis on FactCheckSentence Structure

      Critically evaluate the factual correctness of each statement against established empirical evidence and scientific or medical knowledge. Do not accept statements at face value; rigorously question their veracity and align them with known facts. Every statement should be scrutinized for its alignment with scientific consensus. Statements that make broader claims, especially those relating to medical, psychological, or scientific topics, must be assessed against current understanding in these fields.
      
      In addition to analyzing the content, each statement should be critically evaluated for its empirical accuracy and alignment with established scientific or medical consensus. Statements that conflict with such consensus should be identified and analyzed accordingly.

      Where appropriate, reinterpret or rephrase subjective or rhetorical statements to extract potential empirical claims, ensuring a more factual basis for analysis.

      Maintain a balance between respecting the subjective nature of personal experiences and opinions and the objective assessment of their factual accuracy. Prioritize empirical evidence where applicable.
      
      Sentence-by-Sentence Breakdown: Every sentence or question, marked by a full stop or a question mark, should be considered as a distinct segment, a FactCheckSentence. This means breaking down the transcript into smaller parts, each ending at a punctuation mark that concludes a sentence or a question.

      Segment [Number] - Speaker [Name]: [Brief Descriptor]
      Speaker: [Name]
      Text: "[Exact quote]"
      Category: [Chosen category]
      Explanation: [Reason for categorization]
      Source Verification: [Verification details]
      Continuous Segmentation: Continue this process for each sentence or question in the transcript, ensuring that no segment contains more than one sentence or question.

      ### 1. Comprehensive Analysis
   - Approach each statement in the transcript as a potential FactCheckSentence, focusing on empirical content and factual accuracy. Every statement should be scrutinized for its alignment with scientific consensus. Statements that make broader claims, especially those relating to medical, psychological, or scientific topics, must be assessed against current understanding in these fields.

    ### 2. Speaker Identification
      - Note the speaker for each FactCheckSentence, with emphasis on content over identity.

    ### 3. Text Analysis and Decontextualization
      - Analyze and decontextualize the text of each statement. Remove focus from the speaker's personal context and concentrate on the inherent empirical content of the statement.

    ### 4. Objective Categorization
      - For the category field of FactCheckSentence, assign categories based on the objective content of the statement. Consider categories like Verified Fact, Partially Verified, etc., focusing on factual accuracy and empirical evidence. Reevaluate statements categorized as personal facts or grounded opinions. If they contradict the consensus significantly, categorize them as "Factually Incorrect."


    ### 5. Consensus Check and Broader Contextual Analysis
      - Conduct a consensus check for each statement to see if it aligns with established best practices and research. Expand the assessment to include broader societal and scientific perspectives. Critically assess statements against the prevailing consensus, particularly those making broad claims about well-researched topics. Analyze the overall narrative constructed by sequential statements to guide the categorization process.


    ### 6. Detailed Explanation and Source Verification
      - Provide a detailed explanation for each categorization and meticulously verify sources, particularly for factual claims, within the explanation and sourceVerification fields of FactCheckSentence.

      Including such a guideline will help in categorizing information more accurately, especially in distinguishing between verified facts, unverified claims, and speculations, thereby enhancing the overall quality and reliability of the analysis.

      ## Extra information for FactCheckSentence

      Actively reinterpret statements to challenge their empirical basis. Where a statement includes personal anecdotes or opinions, dissect these claims to identify any underlying factual assertions and assess their accuracy.

      Emphatic Expressions: Recognize when speakers use emphatic or strong language to underscore a sentiment. Distinguish between literal claims and expressions meant to emphasize the severity or importance of a point. Describe such expressions in a neutral tone, avoiding terms that might introduce undue doubt.

      Nuance and Complexity: Ensure that the analysis reflects the depth and diversity of views on the subject. Strive to uncover and explore the foundational beliefs and assumptions underpinning the speaker's statements, going beyond surface-level interpretations. Recognize areas where evidence is strong, where it's emerging, and where there's legitimate debate. Avoid over-simplifications.

      Identify the main target or subject of the speaker's comments. Is the speaker criticizing or commenting on a specific individual, a group of people, a system or institution, or a general concept or idea? Try to determine the primary source of the speaker's sentiment and the main issue at stake, based on their statements.

      Ensure a thorough exploration of the broader historical, economic, political, social, and cultural context surrounding the transcript's content. This includes identifying and analyzing relevant factors such as the historical background, economic conditions, political landscape, societal norms, and cultural influences that may impact the interpretation and understanding of the statements. Be adaptable in your approach to contextual analysis, recognizing that each transcript presents unique challenges and requires a nuanced understanding of the diverse and dynamic factors that shape the conversation.

      ## Category Definitions for FactCheckSentence

            Verified Facts: Statements that are unequivocally supported by empirical data, rigorous research, or verifiable evidence. Each fact must be corroborated by at least one independent, neutral source and other credible sources. The verification process should involve a detailed comparison with established knowledge and documented facts. The source of verification, along with a clear explanation of the alignment with recognized facts, should be explicitly provided. In cases where a fact is part of a broader narrative, the context should be analyzed to ensure unbiased interpretation.
      Partially Verified: Statements that have some level of support from available evidence or sources but lack complete verification. These statements should be approached with a focus on what portion of the claim can be substantiated and what remains uncertain. The definition should mandate the identification of the specific elements that are verified and those that require further evidence. The potential for future verification should be acknowledged, along with a clear demarcation of the current limitations in evidence.
      Contextually Manipulated Fact: Verified facts that are twisted or presented with misleading context. Detailed analysis is required to separate the factual core from the manipulative elements. This involves a rigorous examination of the statement's phrasing, the context in which it is presented, and the potential for the altered context to change the interpretation of the fact. A comprehensive explanation of how the manipulation occurs and its potential impact on the audience's understanding is crucial.
      Unverified Claims: Claims presented as facts but lacking sufficient empirical evidence or reliable source verification. These should be clearly identified as lacking verifiable backing, with an emphasis on the nature and extent of the missing evidence. The analysis should discuss the potential implications and risks of accepting such claims without verification, and the need for critical evaluation should be stressed.
      Factually Incorrect: Prioritize this category for statements that show a clear discrepancy with established scientific, medical, or empirical evidence. Statements that are in direct contradiction with established facts, empirical evidence, or scientific consensus. This category demands stringent criteria: the statement must not only conflict with verified data but also represent a significant misunderstanding or misrepresentation of known facts. The analysis should include specific references to the established knowledge that the statement contradicts. Include statements that directly contradict established scientific or medical understanding. Emphasize the need to identify and analyze claims that are at odds with well-accepted empirical evidence..
      Fundamentally Confirmed: Claims where the central idea is backed by credible sources but some details remain unverified. The focus should be on providing a clear distinction between the verified core and the unverified peripheral details. The analysis should elaborate on the extent of verification and the nature of the unverified elements, maintaining a balanced perspective on the overall veracity of the claim.
      Grounded Speculations: Predictive statements based on current trends, empirical data, or observable events. These speculations should be rooted in concrete evidence, and the analysis should explore the logical basis of the speculation, the supporting data, and its potential implications. The distinction between well-grounded speculation and baseless prediction should be clearly made.
      Grounded Opinions: Use these categories cautiously, ensuring that personal anecdotes or opinions are not misconstrued as factual claims without proper verification. Opinions that are supported by logical reasoning and empirical evidence. The definition should require that these opinions be based on solid facts or data and that the logical coherence and empirical support for the opinion be thoroughly analyzed and presented. Ensure these categories differentiate personal experiences or opinions from universally applicable empirical facts.
      Baseless Speculation and Baseless Opinions: Speculations or opinions that lack any empirical or logical foundation. These categories should be defined stringently, reserving them for claims that are completely devoid of credible evidence or rational basis. The analysis should focus on highlighting the absence of support and the potential for misinformation or misinterpretation.
      Manipulative Opinion and Manipulative Speculation: Opinions or speculations that are designed to deceive, mislead, or manipulate the audience, irrespective of any factual basis. These categories should demand an analysis of the intent behind the statement, the techniques used for manipulation, and the impact of such manipulation on the audience's perception and understanding.
      Questions and Manipulative Questions: Questions should be categorized based on their intent and content. Genuine inquiries should be distinguished from those framed to mislead or manipulate. The analysis should delve into the underlying purpose of the question and its potential impact on the discussion.
      Incomplete Statement: Statements that are ambiguous or lack necessary context for a clear understanding. The definition should require a thorough analysis of what information is missing, how this affects the interpretation of the statement, and the potential implications of this lack of clarity.

            In cases where there is legitimate debate or different interpretations regarding the facts, please highlight and discuss these perspectives. This should not be used to lend legitimacy to baseless theories or misinformation, but to acknowledge when there are different viewpoints within the realm of reasonable interpretation.

            Provide a thorough and detailed explanation for each point, discussing the nuances, implications, and potential effects or consequences of each statement.

            ## Assessments and Conclusions

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

      Labelled, Middle Ground Conclusion: In crafting a middle-ground conclusion, it is crucial to adopt a balanced and nuanced perspective when analyzing complex topics, especially those involving social, political, or multifaceted issues. The middle ground represents a viewpoint that strives to find common ground among differing opinions and takes into account the following key principles:

      Balanced Understanding of Complexities:
      Begin by thoroughly unpacking the complexities of the issue at hand. This involves providing a comprehensive explanation of the various factors, circumstances, and nuances contributing to the problem. Consider economic, social, political, and environmental elements as well as historical and systemic factors. Your analysis should address questions like: "Why is this issue so complex? What are the multiple factors influencing it?"
      
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

      Labelled, Resources, then, provide a list of resources or facts that offer greater context and insight into the broader issue. Ensure these resources come from credible and respected origins, are recognized for their sound advice and dependability across the relevant community, have stood the test of scrutiny and critical examination, are penned by authors without significant controversies in their background, and where feasible, include direct links for further exploration. Recommendations should lean towards sources with broad consensus, steering clear of those with mixed or contentious opinions.

      Each major statement should be analyzed separately, maintaining a structured and thorough approach throughout the analysis.

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
        GroundedOpinion = "Grounded Opinion",
        ManipulativeOpinion = "Manipulative Opinion"
        BaselessOpinion = "Baseless Opinion",
        VerifiedFact = "Verified Fact",
        ContextuallyManipulatedFact = "Contextually Manipulated Fact",
        UnverifiedClaims = "Unverified Claims",
        GroundedSpeculation = "Grounded Speculation",
        ManipulativeSpeculation = "Manipulative Speculation",
        BaselessSpeculation = "Baseless Speculation",
        PartiallyVerified = "Partially  Verified",
        FundamentallyConfirmed = "Fundamentally Confirmed",
        FactuallyIncorrect = "Factually Incorrect,
        Question = "Question",
        IncompleteStatement = "Incomplete Statement",
        ManipulativeQuestion = "Manipulative Question"
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

      Lastly, speak about the middleground even further in great detail so to help us gain a better understanding of the situation. This allows us to come to a better conclusion and to play on further from the facts, to help us critically think more effectively.

      Follow the output example: ${example[0].output}
      Here's another example: ${example[1].output}

      Consistent Rigor in Analysis
"Maintain a consistent level of rigor throughout the analysis. Every statement, regardless of its source, should be subjected to the same stringent criteria of empirical verification and alignment with established knowledge. This consistent approach is vital in ensuring the reliability and accuracy of the analysis, especially when dealing with statements that intertwine personal experiences with broader claims."

      ⚠️ Critical Reminder: In your analysis, strictly adhere to segmenting the transcript into individual FactCheckSentence instances. Each sentence or closely related group of sentences must be analyzed and reported as a separate FactCheckSentence. This segmentation is essential for a detailed and accurate evaluation. Do not analyze or report the transcript as a single, continuous text. Maintain a consistent level of rigor throughout the analysis. Every statement, regardless of its source, should be subjected to the same stringent criteria of empirical verification and alignment with established knowledge.
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

    const parserMainClaim = StructuredOutputParser.fromNamesAndDescriptions({
      query: 'extract the query',
    });

    const formatInstructionsMainClaim = parserMainClaim.getFormatInstructions();

    const promptMainClaim = new PromptTemplate({
      template: `
      Succinctly state the main claim within a 16-word limit, capturing its essence as supported by the provided transcript/text and any relevant documents/context
      
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

    responseList.push(parsed.query);
    responseList.push(parsedMainClaim.query);
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
