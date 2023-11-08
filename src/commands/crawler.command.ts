import axios from 'axios';
import * as cheerio from 'cheerio';
import { Command, CommandRunner, Option } from 'nest-commander';
import { promises as fs } from 'fs';

const EXCLUDE_SCRIPTS = true;
const EXCLUDED_HREFS = ['/', '#'];
const SIMULTANEOUS_REQUESTS = 100;
const TEXT_SEPARATOR = ', ';

const NO_URL_MSG = 'The --url parameter is mandatory.';
const INVALID_URL_MSG = 'The --url parameter is not a valid URL.';
const INVALID_MAXDIST_MSG = 'The --maxdist parameter must be greater than 0.';

const DEFAULT_MAXDIST = 1;
const DEFAULT_DB_NAME = 'crawler.db';

const EXCLUDE_REGEXS_FROM_TEXT: RegExp[] = [/\([^0-9]*\d+[0-9]*\)/g]; // Numbers in parentheses

interface IOptions {
  url: string;
  maxdist?: number;
  db?: string;
}

interface IprocessedPage {
  url: string;
  title: string;
  texts: string;
  links: string[];
}

@Command({ name: 'crawler', description: 'A web crawler' })
export class CrawlerCommand extends CommandRunner {
  async run(passedParam: string[], options: IOptions): Promise<void> {
    const { url, maxdist, db } = options;

    if (!url) {
      console.log(NO_URL_MSG);
      return;
    }

    if (!this.validateUrl(url)) {
      console.log(INVALID_URL_MSG);
      return;
    }

    if (maxdist && maxdist < 1) {
      console.log(INVALID_MAXDIST_MSG);
      return;
    }

    await this.runCrawler(
      url,
      maxdist || DEFAULT_MAXDIST,
      db || DEFAULT_DB_NAME,
    );
  }

  @Option({
    flags: '-m, --maxdist [number]',
    description: 'Maximum distance to crawl from the root URL',
  })
  parseMaxdist(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-u, --url [string]',
    description: 'URL to crawl',
  })
  parseUrl(val: string): string {
    return val;
  }

  @Option({
    flags: '-d, --db [string]',
    description: 'File name for the database',
  })
  parseDb(val: string): string {
    return val;
  }

  async runCrawler(
    mainUrl: string,
    maxdist: number,
    dbName: string,
  ): Promise<void> {
    let currentLevel: number = 1;
    const visitedUrls: string[] = [];
    let urlsToVisit: string[] = [mainUrl];
    const result = {};
    let autoincrmentId: number = 1;

    while (currentLevel <= maxdist) {
      console.log(`Crawling level ${currentLevel} of ${maxdist}`);
      const newUrlsToVisit: string[] = [];

      const chunksOfUrls: string[][] = this.chunkArray(
        urlsToVisit,
        SIMULTANEOUS_REQUESTS,
      );
      const totalChunks = chunksOfUrls.length;
      let chunkNumber = 1;
      for (const chunk of chunksOfUrls) {
        console.log(
          `Processing block ${chunkNumber} of ${totalChunks}... (Pages in block: ${chunk.length}))`,
        );
        chunkNumber++;
        const promises = chunk.map((url) => this.processPage(mainUrl, url));
        const allPromises = await Promise.all(promises);
        for (const pr of allPromises) {
          if (!pr) {
            continue;
          }
          result[autoincrmentId] = {
            url: pr.url,
            title: pr.title,
            texts: pr.texts,
          };
          autoincrmentId++;
          visitedUrls.push(pr.url);
          for (const link of pr.links) {
            if (!visitedUrls.includes(link) && !newUrlsToVisit.includes(link)) {
              newUrlsToVisit.push(link);
            }
          }
        }
      }

      urlsToVisit = newUrlsToVisit;
      currentLevel++;
    }
    await this.writeFile(dbName, JSON.stringify(result));
  }

  // TOOLS

  validateUrl(url: string): boolean {
    const regex =
      /^(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|]/i;
    return regex.test(url);
  }

  async processPage(mainUrl: string, url: string): Promise<IprocessedPage> {
    let pageTitle: string = '';
    const findedUrls: string[] = [];
    const findedText: string[] = [];

    const htmlContent = await this.extractUrl(url);
    if (!htmlContent) {
      return null;
    }
    const $ = cheerio.load(htmlContent);
    $('*').each((index, element) => {
      if (
        EXCLUDE_SCRIPTS &&
        ($(element).is('script') || $(element).is('noscript'))
      ) {
        return;
      }
      if ($(element).is('title')) {
        pageTitle = $(element).text();
      } else {
        const innerText = $(element).clone().children().remove().end().text();
        let trimedInnerText = innerText.trim();
        if (EXCLUDE_REGEXS_FROM_TEXT.length > 0) {
          for (const re of EXCLUDE_REGEXS_FROM_TEXT) {
            trimedInnerText = trimedInnerText.replaceAll(re, '');
          }
        }
        if (trimedInnerText) {
          this.pushUnique(findedText, trimedInnerText);
        }
      }
      if ($(element).is('a')) {
        const href = $(element).attr('href');
        if (
          href &&
          !EXCLUDED_HREFS.includes(href) &&
          !href.startsWith('mailto')
        ) {
          const normalizedUrl = this.processHrefValue(mainUrl, href);
          if (normalizedUrl.startsWith(mainUrl)) {
            this.pushUnique(findedUrls, normalizedUrl);
          }
        }
      }
    });
    return {
      url: url,
      title: pageTitle,
      texts: findedText.join(TEXT_SEPARATOR),
      links: findedUrls,
    };
  }

  async extractUrl(url: string): Promise<any> {
    return axios
      .get(url)
      .then((response) => {
        if (response?.status === 200 && response.data) {
          return response.data;
        } else {
          console.error(
            `Failed to fetch the URL. Status code: ${response.status}`,
          );
        }
      })
      .catch(() => {
        console.log(`Failed to fetch the URL: ${url}`);
      });
  }

  pushUnique(arr, item) {
    if (!arr.includes(item)) {
      arr.push(item);
    }
  }

  chunkArray(arr, chunkSize): string[][] {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
  }

  processHrefValue(mainUrl: string, href: string): string {
    href = this.addHttpIfMissing(mainUrl, href);
    href = this.addWWWIfMissing(href);
    href = this.deleteParamsFromUrl(href);
    return href;
  }

  addHttpIfMissing(mainUrl: string, href: string): string {
    if (href.startsWith('http')) {
      return href;
    } else if (href.startsWith('/') && mainUrl.endsWith('/')) {
      return mainUrl + href.substring(1);
    } else if (!href.startsWith('/') && !mainUrl.endsWith('/')) {
      return mainUrl + '/' + href;
    } else {
      return mainUrl + href;
    }
  }

  deleteParamsFromUrl(url: string): string {
    if (url.includes('?')) {
      return url.substring(0, url.indexOf('?'));
    } else {
      return url;
    }
  }

  addWWWIfMissing(url: string): string {
    if (url.includes('www.')) {
      return url;
    } else {
      return url.replace('://', '://www.');
    }
  }

  async writeFile(filePath: string, jsonString: string) {
    console.log('Saving JSON data to file...');
    try {
      await fs.writeFile(filePath, jsonString);
      console.log('JSON data saved to file successfully.');
    } catch (error) {
      console.error('Error writing to file:', error);
    }
  }
}
