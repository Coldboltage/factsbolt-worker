import { IsString } from 'class-validator';

export class TranscriptionDto {
  @IsString()
  title: string;

  @IsString()
  text: string;
}
