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
    const data = await response.json();
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
      if (!url || url.includes('youtube') || url.includes('.pdf')) continue;

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

  promptExample() {}
}
