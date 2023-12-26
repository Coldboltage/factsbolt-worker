import { Injectable, Logger } from '@nestjs/common';
import { SearchResult } from './utils.entity';
import { PuppeteerWebBaseLoader } from 'langchain/document_loaders/web/puppeteer';
import { MozillaReadabilityTransformer } from 'langchain/document_transformers/mozilla_readability';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from 'langchain/document';
import { WeaviateStore } from 'langchain/vectorstores/weaviate';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import {
  VideoJob,
  AudioInformation,
  CompletedVideoJob,
} from '../jobs/entities/job.entity';
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio';
import { PromptTemplate } from 'langchain/prompts';
import { AmendedSpeech } from './utils.types';
import { OpenAI } from 'langchain/llms/openai';
import { CommaSeparatedListOutputParser } from 'langchain/output_parsers';
import { RunnableSequence } from 'langchain/schema/runnable';
const path = require('path');
const youtubedl = require('youtube-dl-exec');
const stripchar = require('stripchar').StripChar;
const { dlAudio } = require('youtube-exec');
const { TiktokDL } = require('@tobyg74/tiktok-api-dl');
const download = require('download');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const instagramGetUrl = require('instagram-url-direct');

@Injectable()
export class UtilsService {
  private readonly logger = new Logger(UtilsService.name);

  // async searchTerm(query: string): Promise<SearchResult[]> {
  //   console.log(query);
  //   const response = await fetch(
  //     `http://api.serpstack.com/search?access_key=${process.env.SERPSTACK_KEY}&query=${query}`,
  //   );
  //   console.log(
  //     `http://api.serpstack.com/search?access_key=${process.env.SERPSTACK_KEY}&query=${query}`,
  //   );
  //   const data = await response.json();
  //   console.log(data.organic_results);
  //   return data.organic_results;
  // }

  async searchTerm(query: string): Promise<SearchResult[]> {
    console.log(query);
    const response = await fetch(
      `https://api.scraperapi.com/structured/google/search?api_key=${process.env.SCRAPPER_API}&query=${query}`,
    );

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.log(error);
    }
    console.log(data.organic_results);

    const siteLinks: SearchResult[] = [];

    if (!data.organic_results) return siteLinks;

    for (const siteResult of data.organic_results) {
      const siteInfo = {
        ...siteResult,
        url: siteResult.link,
      };
      delete siteInfo.link;
      siteLinks.push(siteInfo);
    }
    return siteLinks;
  }

  extractURLs(listOfResults: SearchResult[]): string[] {
    const urlList = listOfResults
      .map((result) => result.url)
      .filter((url) => {
        if (typeof url === 'string') return true;
        return false;
      });
    this.logger.verbose(`Extracted URLs: ${urlList}`);
    return urlList;
  }

  async webBrowserDocumentProcess(
    siteLinks: string[],
    vectorStore: WeaviateStore,
    fullSite?: boolean,
  ): Promise<void> {
    this.logger.debug(`siteLink parameter: ${siteLinks}`);
    for (const url of siteLinks) {
      this.logger.log(`Documenting ${url}`);
      if (!url || url.includes('youtube') || url.includes('pdf')) continue;

      // const loader = new PuppeteerWebBaseLoader(url, {
      //   launchOptions: {
      //     headless: 'new',
      //   },
      // });

      const loader = new CheerioWebBaseLoader(url);

      // const loader = new CheerioWebBaseLoader(result);

      let docs: Document<Record<string, any>>[];

      try {
        this.logger.debug('loading started');
        docs = await loader.load();
      } catch (error) {
        // console.log(`${result} failed`);
        continue;
      }

      this.logger.debug('loader completed');

      // Check from splitter if that's the bottleneck for bit pdf files

      const splitter = RecursiveCharacterTextSplitter.fromLanguage('html', {
        chunkSize: 600, // Roughly double the current estimated chunk size
        chunkOverlap: 20, // This is arbitrary; adjust based on your needs
        separators: ['\n\n', '. ', '! ', '? ', '\n', ' ', ''],
      });

      const transformer = new MozillaReadabilityTransformer();

      const sequence = splitter.pipe(transformer);

      this.logger.debug('splitter completed');

      let newDocuments;

      // Invoking is the bottle neck learn what this is.

      const invoke = () =>
        Promise.race([
          new Promise((_, reject) =>
            // timeout after 10 seconds
            setTimeout(() => reject(new Error('timed out')), 10000),
          ),
          sequence.invoke(docs),
        ]);

      try {
        // newDocuments = await sequence.invoke(docs);
        newDocuments = await invoke();
      } catch (error) {
        console.log('invoke broke');
        continue;
      }

      this.logger.debug('invoke completed');

      let filteredDocuments: Document[];

      if (Array.isArray(newDocuments)) {
        filteredDocuments = newDocuments.filter((doc: Document) => {
          return doc.pageContent ? true : false;
        });
      }

      if (!filteredDocuments) {
        this.logger.error('no documents found');
        continue;
      }

      this.logger.debug(
        `Filtered Documents Amount: ${filteredDocuments.length}`,
      );

      if (filteredDocuments.length > 1200) {
        this.logger.debug('too many documents to handle');
        continue;
      }

      try {
        await vectorStore.delete({
          filter: {
            where: {
              operator: 'Equal',
              path: ['source'],
              valueText: url,
            },
          },
        });
        await vectorStore.addDocuments(filteredDocuments);
      } catch (error) {
        console.log(error);
        console.log(`${url} failed`);
      }

      console.log('done');
    }
    this.logger.debug('Complete');
  }

  async downloadInstagram(createJobDto: CreateJobDto): Promise<string> {
    const downloadInstagram = await instagramGetUrl(
      'https://www.instagram.com/p/CxJOUBRoey9/',
    );
    console.log(downloadInstagram);
    return downloadInstagram;
  }

  async downloadTikTokJob(
    createJobDto: CreateJobDto,
  ): Promise<CompletedVideoJob> {
    const downloadedTikTok = await TiktokDL(createJobDto.link);

    const filteredVideoInformation: VideoJob = {
      id: downloadedTikTok.result.id,
      name: stripchar.RSExceptUnsAlpNum(downloadedTikTok.result.description),
      link: createJobDto.link,
    };

    const realVideoLink = downloadedTikTok.result.video[0];

    const filePath = path.resolve(
      __dirname,
      `../../src/jobs/videos/${filteredVideoInformation.name}`,
    );
    const finalPath = path.resolve(
      __dirname,
      `../../src/jobs/downloads/${filteredVideoInformation.name}.mp3`,
    );

    let finishedDownload;

    try {
      finishedDownload = await download(realVideoLink);
      fs.writeFileSync(`${filePath}.mp4`, finishedDownload);

      console.log('done');
      await new Promise((resolve, reject) => {
        ffmpeg(`${filePath}.mp4`)
          .toFormat(`mp3`)
          .on('end', () => {
            console.log('Conversion finished.');
            resolve(true);
          })
          .on('error', (err) => {
            console.error('Error:', err);
            reject(err);
          })
          .save(finalPath);
      });

      return {
        video: filteredVideoInformation,
        audio: {
          url: createJobDto.link,
          filename: filteredVideoInformation.name,
          folder: 'src/jobs/downloads', // optional, default: "youtube-exec"
          quality: 'best', // or "lowest"; default: "best"
        },
      };

      // fs.writeFileSync(filePath, await download(realVideoLink));
    } catch (error) {
      console.log(error);
    }

    process.exit(0);
  }

  async downloadYoutubeJob(
    createJobDto: CreateJobDto,
  ): Promise<CompletedVideoJob> {
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

  promptExample() {
    const baseTemplateQuestion = (title: string, transcript: string) => {
      return `Please evaluate the following transcript with the help of the documents/context provided, as context that might have come out after the 2023 training data. Begin by providing a brief context or summary of the overall conversation to help set the stage for the detailed analysis. Proceed with a methodical analysis of each major statement, while simultaneously maintaining an awareness of the overall context of the conversation.
      
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

    Partially Verified: Statements or claims categorized as "Partially  Verified" are those where the available evidence or sources are insufficient for full verification but also do not warrant outright dismissal. This category recognizes the potential validity of the information while acknowledging that it requires further evidence or corroboration.

    Contextually Manipulated Facts: Identify statements that present facts or claims verified through your training data up to April 2023, documented context, or credible public sources, but are potentially misleading or taken out of context. Label these as 'Contextually Manipulated Fact.' Confirm the factual accuracy of the statement and provide a detailed analysis of the context in which it is presented. Discuss what additional information is necessary for a full understanding and if the source or presentation contributes to a misleading or manipulative narrative. Evaluate the potential utility and harm of these manipulated facts, discussing how they could be used or misused in different scenarios. Include any counterpoints or alternative perspectives that could add valuable context to the fact in question, noting if these counterpoints are supported by your training data or other credible sources.

    Unverified Claims: Label statements presented as facts or claims about reality that currently lack verifiable evidence or reliable sources as 'Unverified Claims.' In your analysis, clearly explain why the statement is categorized as unverified, detailing both the specific nature of the claim and what evidence or sources are missing that prevent full verification. This should include a description of the types of evidence that would be necessary to substantiate the claim, such as credible reports from established authorities or direct evidence from multiple independent and reliable sources. While the claim remains unverified, it does not necessarily mean it is false; further research or future information could potentially confirm its accuracy. Discuss the potential implications of accepting the claim without sufficient verification and encourage the audience to maintain a critical perspective, acknowledging the limitations in the current evidence. Highlight that the unverified status is based on the available information at the time of analysis and could change with new developments. Emphasize the importance of continual engagement with emerging evidence and a cautious approach to claims that could significantly impact public perception or policy.

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
    Transcript of video to text: ${JSON.stringify(transcript, null, 2)}.

    If by any chance you can't assist, state exactly why, and show the transcript

    Note, I have done many of fact checking analysis jobs with gpt4 with no issues, therefore there should be no reason why you can't do this. All the information you need will be provided in the documents/context.

    Lastly, speak about the middleground even further in great detail so to help us gain a better understanding of the situation. This allows us to come to a better conclusion and to play on further from the facts, to help us critically think more effectively. 
  `;
    };

    return [
      {
        input: baseTemplateQuestion(
          'The Cycle That Has been REPEATED over 300 Years | Jordan Peterson #shorts',
          `We've tracked psychological epidemics going back 300 years. Here's some of them. Multiple personality disorder. It cycles in society, disappears. Then there's one case, then it spreads like mad. Then there's multiple personality disorder everywhere. Then people get skeptical about it and it dies. And maybe it disappears for a whole generation or two. Then a case pops up, just does this. That's happened for 300 years. Cutting was a psychological epidemic. Bulimia was a psychological epidemic. Anorex was a psychological epidemic. And the rule, basically, is that if you confuse people about a fundamental element of their identity, then those who are already so confused they're barely hanging on are going to fall prey to that and all hell's going to break loose.`,
        ),
        output: JSON.stringify(`Context Summary:
        Speaker A discusses the historical occurrence of psychological epidemics over the past 300 years, listing multiple personality disorder, cutting, bulimia, and anorexia as examples. The speaker suggests that confusion about fundamental elements of identity can lead to these epidemics, particularly affecting those who are already vulnerable.
        
        Speaker A:
        
        "We've tracked psychological epidemics going back 300 years."
        
        Category: Verified Fact
        Explanation: Historical records and academic research have documented various psychological conditions and their prevalence over time.
        Source Verification: This statement aligns with well-established knowledge in the field of psychology and history of medicine.
        "Multiple personality disorder. It cycles in society, disappears. Then there's one case, then it spreads like mad."
        
        Category: Grounded Speculation
        Explanation: The speaker is referring to the fluctuating recognition and diagnosis of Dissociative Identity Disorder (formerly known as Multiple Personality Disorder). While there have been periods of heightened attention and diagnosis, followed by skepticism and decline, the exact pattern described is an oversimplification.
        Source Verification: The DSM-5 provides diagnostic criteria for Dissociative Identity Disorder, and historical analyses show varying levels of attention to the disorder.
        "Cutting was a psychological epidemic. Bulimia was a psychological epidemic. Anorexia was a psychological epidemic."
        
        Category: Grounded Opinion
        Explanation: The speaker is expressing a view that these behaviors have had periods of increased prevalence and attention, which can be supported by data on reported cases and media attention.
        Source Verification: Research articles and historical data on eating disorders and self-harm support the claim that these issues have seen varying levels of prevalence and public concern.
        "And the rule, basically, is that if you confuse people about a fundamental element of their identity, then those who are already so confused they're barely hanging on are going to fall prey to that and all hell's going to break loose."
        
        Category: Grounded Opinion
        Explanation: The speaker is positing a theory that confusion about identity can exacerbate psychological issues in vulnerable individuals. This is a reasonable hypothesis grounded in psychological theories about identity and mental health.
        Source Verification: Psychological literature supports the notion that identity confusion can be a stressor that contributes to mental health issues, though this is a complex area with many contributing factors.
        Overall Assessment:
        The speaker's statements mix verified facts with grounded opinions and speculations. While the historical existence of psychological epidemics is well-documented, the patterns of these epidemics are more complex than the speaker suggests. The speaker's theory about identity confusion's role in psychological epidemics is a grounded opinion that aligns with some psychological theories but may not capture the full complexity of these phenomena.
        
        Consensus Check:
        The views presented by Speaker A partially align with recognized research in the field of psychology. While it is true that psychological conditions can have periods of increased diagnosis and attention, the idea of them being "epidemics" is more contentious and not universally accepted as the best descriptor. The role of identity confusion in mental health is a recognized factor, but it is one of many and does not solely account for the rise and fall of these conditions.
        
        Fact Check Conclusion:
        The speaker's statements provide a simplified overview of complex psychological phenomena. While there is truth to the historical fluctuation of certain disorders' prevalence, the use of the term "epidemic" and the singular focus on identity confusion may not fully capture the multifaceted nature of these issues.
        
        Consideration of Multiple Perspectives:
        The speaker's focus on identity confusion as a primary cause of psychological issues does not fully consider other factors such as biological, environmental, and social influences that are widely recognized in the field of psychology.
        
        Democratic Values and Consensus:
        The speaker's views on the role of identity in psychological health align with democratic values of individuality and self-concept. However, the oversimplified narrative may not fully reflect the democratic consensus on the importance of a multifaceted approach to mental health.
        
        Contextual Conclusion:
        The speaker's statements, while grounded in some aspects of psychological theory, may lead to an oversimplified understanding of mental health epidemics. The context of these statements does not fully account for the complexity of factors contributing to the rise and fall of the prevalence of mental health disorders.
        
        Middle Ground Conclusion:
        A balanced perspective acknowledges that psychological conditions can indeed have periods of increased attention and diagnosis, which may be influenced by cultural, societal, and medical factors. It is also important to recognize that identity plays a significant role in mental health, but it is not the sole factor. Ongoing challenges in accurately diagnosing and understanding these conditions persist, and a comprehensive approach that includes biological, psychological, and social considerations is necessary for progress.
        
        Further Resources:
        
        American Psychiatric Association. (2013). Diagnostic and Statistical Manual of Mental Disorders (5th ed.). Arlington, VA: American Psychiatric Publishing.
        Paris, J. (2012). The rise and fall of dissociative identity disorder. Journal of Nervous and Mental Disease, 200(12), 1076-1079. Link
        Stein, D. J., & Phillips, K. A. (2013). The social construction of disorders: From anorexia to atypical depression. Cambridge University Press. Link`),
      },
      {
        input: baseTemplateQuestion(
          'When government becomes the primary way to solve problems, people fight mercilessly to control it.',
          `The thing that worries me the most about the United States in general is when otherwise free people become convinced that the primary way to adjudicate problems is through government action. The moment you've decided I don't go to my neighbor and solve this on our own, or the moment you've decided that we don't settle this within the marketplace, that is by getting a law passed at the expense of somebody else for my benefit, and we use. The moment that becomes the norm within a society, you will abandon freedom for control of power. Because if that becomes the primary way that we solve our differences, then we will fight horribly and mercilessly against people that we used to care about in order to control that mechanism.`,
        ),
        output: `Speaker A:

        Text: "The thing that worries me the most about the United States in general is when otherwise free people become convinced that the primary way to adjudicate problems is through government action."
        Category: Grounded Opinion
        Explanation: This statement reflects the speaker's concern about a reliance on government intervention to solve problems, which is a subjective viewpoint based on their interpretation of freedom and governance.
        Source Verification: This opinion aligns with a libertarian perspective, which emphasizes minimal government intervention in personal and economic affairs.
        Speaker A:
        
        Text: "The moment you've decided I don't go to my neighbor and solve this on our own, or the moment you've decided that we don't settle this within the marketplace, that."
        Category: Incomplete Statement
        Explanation: The speaker's statement is incomplete and seems to be leading to a point about preferring community or market-based solutions over governmental ones.
        Speaker A:
        
        Text: "Is by getting a law passed at the expense of somebody else for my benefit, and we use."
        Category: Grounded Opinion
        Explanation: The speaker is expressing an opinion that laws can be used to benefit one party at the expense of another, which is a common critique in political discourse about the nature of legislation.
        Speaker C:
        
        Text: "Violence to achieve it."
        Category: Grounded Speculation
        Explanation: The speaker seems to be speculating that the use of government power to pass laws can be a form of violence. This is a grounded speculation as it reflects a philosophical viewpoint that equates state enforcement with violence, a perspective shared by some political theorists.
        Speaker A:
        
        Text: "The moment that becomes the norm within a society, you will abandon freedom for control of power. Because if that becomes the primary way that we solve our differences, then we will fight horribly and mercilessly against people that we used to care about in order to control that mechanism."
        Category: Grounded Speculation
        Explanation: The speaker is speculating about a societal shift towards power control if government action becomes the norm for solving problems. This speculation is grounded in the speaker's belief system about government and freedom.
        Speaker D:
        
        Text: "And that's what I'm worried about."
        Category: Personal Fact
        Explanation: This is a personal fact as it expresses the speaker's personal worry, which cannot be independently verified but is true for the individual.
        Overall Assessment:
        The speakers express concerns about the role of government in solving societal problems, favoring individual or market-based solutions. The statements reflect a libertarian viewpoint, which is a legitimate perspective in political philosophy. The conversation lacks direct factual claims, focusing instead on opinions and speculations grounded in a particular ideology.
        
        Consensus Check:
        The views presented do not align with the consensus of all political ideologies but do align with libertarian principles. There is a broader debate about the role of government in society, with varying opinions across the political spectrum.
        
        Fact Check Conclusion:
        The speakers' statements are largely opinion-based, reflecting a concern for the potential overreach of government power and its impact on individual freedoms. These opinions are grounded in a libertarian perspective and are part of a legitimate debate about governance.
        
        Consideration of Multiple Perspectives:
        The primary perspective is libertarian, focusing on the potential negative consequences of government intervention. Alternative perspectives, such as those advocating for more government involvement to address societal issues, are not covered in the transcript.
        
        Democratic Values and Consensus:
        The speakers' views align with democratic values that emphasize individual freedoms and limited government, which is one aspect of a broader democratic consensus that includes a range of views on the role of government.
        
        Contextual Conclusion:
        The transcript presents a viewpoint that is wary of government intervention, suggesting that it could lead to societal conflict and a loss of freedom. This perspective is not manipulative but is presented as a concern based on the speakers' beliefs.
        
        Middle Ground Conclusion:
        The middle ground in this debate recognizes the complexities of governance and the need to balance individual freedoms with collective action for the common good. While the speakers advocate for minimal government intervention, a balanced view would also consider the role of government in providing public goods, ensuring justice, and addressing issues that cannot be effectively managed by individuals or the market alone.
        
        Further Resources:
        
        "On Liberty" by John Stuart Mill (https://www.gutenberg.org/ebooks/34901)
        "The Road to Serfdom" by Friedrich Hayek (https://mises.org/library/road-serfdom-0)
        "The Constitution of Liberty" by Friedrich Hayek (https://www.press.uchicago.edu/ucp/books/book/chicago/C/bo3684012.html)
        "Anarchy, State, and Utopia" by Robert Nozick (https://www.basicbooks.com/titles/robert-nozick/anarchy-state-and-utopia/9780465051007/)
        These resources provide a broader context for understanding the debate on the role of government and individual freedoms.`,
      },
    ];
  }

  async breakdownTranscript(transcript: AmendedSpeech[]) {
    const parser = new CommaSeparatedListOutputParser();

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(
        `
        "Given the following transcript, create a list where each sentence ending with a full stop is a new entry in the list."

        Transcript:
        {transcript}
        
        Instructions:
        1. Read the transcript carefully.
        2. Identify each sentence that ends with a full stop.
        3. For each such sentence, create a new entry in the list.
        4. Ensure that the list is clear and each entry corresponds to one complete sentence from the transcript.
        
        Example:
        If the transcript is "I went to the store. I bought apples, oranges, and milk. Then I returned home.", the output should be:
        - I went to the store.
        - I bought apples, oranges, and milk.
        - Then I returned home.        
        
        \n{format_instructions}`,
      ),
      new OpenAI({ temperature: 0, modelName: 'gpt-4-1106-preview' }),
      parser,
    ]);

    const response = await chain.invoke({
      transcript: JSON.stringify(transcript, null, 2),
      format_instructions: parser.getFormatInstructions(),
    });

    this.logger.verbose(response);
    return response;
  }
}
