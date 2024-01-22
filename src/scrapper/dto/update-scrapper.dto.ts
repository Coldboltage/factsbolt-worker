import { PartialType } from '@nestjs/mapped-types';
import { CreateScrapperDto } from './create-scrapper.dto';

export class UpdateScrapperDto extends PartialType(CreateScrapperDto) {
  id: number;
}
