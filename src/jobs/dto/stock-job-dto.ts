import { IsString, IsOptional } from 'class-validator';

export class StockCheckupJobDto {
  @IsString()
  @IsOptional()
  title: string;

  @IsString()
  text: string;

  @IsString()
  @IsOptional()
  context: string;
}
