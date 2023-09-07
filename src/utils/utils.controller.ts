import { Controller, Get, Param } from '@nestjs/common';
import { UtilsService } from './utils.service';

@Controller('utils')
export class UtilsController {
  constructor(private readonly utilsService: UtilsService) {}
  @Get('search/:query')
  async searchQuery(@Param('query') query: string) {
    this.utilsService.searchTerm(query);
  }
}
