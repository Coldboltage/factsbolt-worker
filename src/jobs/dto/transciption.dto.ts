import { IsString } from 'class-validator';
import { AmendedSpeech } from '../../utils/utils.types';

export class TranscriptionDto {
  @IsString()
  title: string;

  text: AmendedSpeech[];
}
