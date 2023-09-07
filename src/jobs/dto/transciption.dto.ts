import { IsString } from 'class-validator';
import { AmendedSpeech } from 'factsbolt-types';

export class TranscriptionDto {
  @IsString()
  title: string;

  text: AmendedSpeech[];
}
