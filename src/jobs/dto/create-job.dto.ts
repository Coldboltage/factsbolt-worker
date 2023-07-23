import { IsString, IsUrl } from "class-validator";

export class CreateJobDto {
  @IsUrl()
  @IsString()
  link: string;
}
