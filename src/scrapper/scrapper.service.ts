import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateScrapperDto } from './dto/create-scrapper.dto';
import { UpdateScrapperDto } from './dto/update-scrapper.dto';
import { Scrapper, ScrapperStatus } from './entities/scrapper.entity';
import axios from 'axios';

@Injectable()
export class ScrapperService {
  async monitorScrapper(id: string): Promise<void> {
    console.log('monitorScrapper');
    await fetch(`${process.env.API_BASE_URL}/scrapper/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, status: ScrapperStatus.READY }),
    });

    let status = false;

    await new Promise((resolve) => {
      const pollStatus = async (id: string) => {
        console.log('Loop started');
        console.log(id);
        const scrapperEntity = await this.findOne(id);
        if (scrapperEntity.status === ScrapperStatus.DONE) {
          resolve('lol'); // Resolve the promise when done
        } else {
          console.log(`Status is ${scrapperEntity.status}`);
          setTimeout(() => pollStatus(id), 5000);
        }
      };

      pollStatus(id); // Initial call to start polling
    });
  }

  create(createScrapperDto: CreateScrapperDto) {
    return 'This action adds a new scrapper';
  }

  findAll() {
    return `This action returns all scrapper`;
  }

  async findOne(id: string): Promise<Scrapper> {
    const response = await axios.get(
      `${process.env.API_BASE_URL}/scrapper/${id}`,
    );
    if (!response) throw new NotFoundException('scrapper-entity-not-found');
    const scrapperEntity: Scrapper = response.data;
    return scrapperEntity;
  }

  update(id: number, updateScrapperDto: UpdateScrapperDto) {
    return `This action updates a #${id} scrapper`;
  }

  remove(id: number) {
    return `This action removes a #${id} scrapper`;
  }
}
