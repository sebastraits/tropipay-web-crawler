import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CrawlerCommand } from './commands/crawler.command';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, CrawlerCommand],
})
export class AppModule {}
