import { IsString, IsUrl } from 'class-validator';

export class TranscribeAudioDto {
  @IsUrl()
  url: string;

  @IsString()
  filename: string;

  @IsString()
  folder: string;
}
