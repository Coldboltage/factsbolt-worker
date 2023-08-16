import { Injectable } from '@nestjs/common';
import { SearchResult } from './utils.entity';

@Injectable()
export class UtilsService {
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
}
