import { IsNotEmpty, IsString } from 'class-validator';

export class TextOnlyDto {
  @IsString()
  title: string;

  @IsString()
  @IsNotEmpty()
  text: string;
}
