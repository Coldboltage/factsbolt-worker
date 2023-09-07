import { Injectable, Logger } from '@nestjs/common';
import { SearchResult } from './utils.entity';
import { PuppeteerWebBaseLoader } from 'langchain/document_loaders/web/puppeteer';
import { MozillaReadabilityTransformer } from 'langchain/document_transformers/mozilla_readability';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from 'langchain/document';
import { WeaviateStore } from 'langchain/vectorstores/weaviate';

@Injectable()
export class UtilsService {
  private readonly logger = new Logger(UtilsService.name);

  async searchTerm(query: string): Promise<SearchResult[]> {
    console.log(query);
    const response = await fetch(
      `http://api.serpstack.com/search?access_key=${process.env.SERPSTACK_KEY}&query=${query}`,
    );
    const data = await response.json();
    console.log(data.organic_results);
    return data.organic_results;
  }

  extractURLs(listOfResults: SearchResult[]) {
    return listOfResults.map((result) => result.url);
  }

  async webBrowserDocumentProcess(
    siteLinks: string[],
    vectorStore: WeaviateStore,
  ): Promise<void> {
    for (const url of siteLinks) {
      if (url.includes('youtube')) continue;
      const loader = new PuppeteerWebBaseLoader(url, {
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
}
