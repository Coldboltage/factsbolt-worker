import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CreateGoogleDto } from './dto/create-google.dto';
import { UpdateGoogleDto } from './dto/update-google.dto';
import { GoogleSearch } from './entities/google.entity';
const serp = require('serp');

@Injectable()
export class GoogleService implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> {
    // console.log('Hmm this is got to fire');
    // const claims = ['openai', 'gpt4', 'llm open'];
    // const claimsPromises = claims.map((claim) => this.googleSearch(claim));
    // const promises = await Promise.all(claimsPromises);
    // console.log(promises.flat());
  }

  async googleSearch(query: string) {
    const options = {
      host: 'google.com',
      qs: {
        q: query,
        filter: 0,
        pws: 0,
      },
      num: 100,
    };
    console.log('Interesting');
    const links: GoogleSearch[] = await serp.search(options);
    const filterLinks = links
      .map((link) => {
        return { url: link.url };
      })
      .filter((_, index) => index < 3);
    return filterLinks;
  }

  create(createGoogleDto: CreateGoogleDto) {
    return 'This action adds a new google';
  }

  findAll() {
    return `This action returns all google`;
  }

  findOne(id: number) {
    return `This action returns a #${id} google`;
  }

  update(id: number, updateGoogleDto: UpdateGoogleDto) {
    return `This action updates a #${id} google`;
  }

  remove(id: number) {
    return `This action removes a #${id} google`;
  }
}
