import axios from 'axios';
import * as cheerio from 'cheerio';
import { Command, CommandRunner, Option } from 'nest-commander';
import { promises as fs } from 'fs';

const EXCLUDE_SCRIPTS = true; // Here you declare if you want to exclude the scripts from the text captured
const EXCLUDED_HREFS = ['/', '#']; // Here you declare the hrefs that you want to exclude from the crawler
const SIMULTANEOUS_REQUESTS = 100; // Here you declare the number of simultaneous requests to the URLs
const TEXT_SEPARATOR = ', '; // Here you declare the separator for the texts captured from the pages
const PARAGRAPHS_OR_WORDS: 'words' | 'paragraphs' = 'words'; // Here you declare if you want to store the paragraphs or the words of the texts captured

const NO_URL_MSG = 'The --url parameter is mandatory.'; // Here you declare the error message that will be displayed when the --url parameter does not exist.
const INVALID_URL_MSG = 'The --url parameter is not a valid URL.'; // Here you declare the error message that will be displayed when the --url parameter is not a valid URL.
const INVALID_MAXDIST_MSG = 'The --maxdist parameter must be greater than 0.'; // Here you declare the error message that will be displayed when the --maxdist parameter is not a valid number.

const DEFAULT_MAXDIST = 1; // Here you declare the default value for the --maxdist parameter.
const DEFAULT_DB_NAME = 'crawler.JSON'; // Here you declare the default value for the --db parameter.

const EXCLUDE_REGEXS_FROM_TEXT: RegExp[] = [/\([^0-9]*\d+[0-9]*\)/g]; // Here you declare the regexs that you want to exclude from the text captured

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
    if (!val.endsWith('.JSON')) {
      return val + '.JSON';
    } else {
      return val;
    }
  }

  async runCrawler(
    mainUrl: string,
    maxdist: number,
    dbName: string,
  ): Promise<void> {
    let currentLevel: number = 1; // Here we store the current level of the crawler
    const visitedUrls: string[] = []; // Here we store the visited URLs
    let urlsToVisit: string[] = [mainUrl]; // Here we store the URLs to visit

    const stackedOutput = {}; // Here we build the output object
    let autoincrmentId: number = 1; // Here we store the autoincrement ID for the output object

    while (currentLevel <= maxdist) {
      // Here we iterate through the levels of the crawler
      console.log('*****************************');
      console.log(`Crawling level ${currentLevel} of ${maxdist}`);
      console.log('*****************************');

      const chunksOfUrls: string[][] = this.chunkArray(
        // Here we split the URLs to visit in chunks of SIMULTANEOUS_REQUESTS
        urlsToVisit,
        SIMULTANEOUS_REQUESTS,
      );
      const totalChunks = chunksOfUrls.length; // Here we store the total number of chunks
      let chunkNumber = 1; // Here we store the current chunk number
      const newUrlsToVisit: string[] = []; // Here we store the new URLs to visit
      for (const chunk of chunksOfUrls) {
        // Here we iterate through the chunks
        console.log(
          `Processing block ${chunkNumber} of ${totalChunks}... (Pages in block: ${chunk.length}))`,
        );
        const promises = chunk.map((url) => this.processPage(mainUrl, url)); // Here we create an array of promises
        const allPromises = await Promise.all(promises); // Here we wait for all the promises to be resolved
        for (const pr of allPromises) {
          // Here we iterate through the promises
          if (!pr) {
            continue;
          }
          stackedOutput[autoincrmentId] = {
            // Here we build the output object
            url: pr.url,
            title: pr.title,
            texts: pr.texts,
          };
          autoincrmentId++; // Here we increment the autoincrement ID
          visitedUrls.push(pr.url); // Here we add the URL to the visited URLs
          for (const link of pr.links) {
            // Here we iterate through the finded links of the page
            if (!visitedUrls.includes(link) && !newUrlsToVisit.includes(link)) {
              // Here we check if the link is not in the visited URLs and not in the new URLs to visit
              newUrlsToVisit.push(link); // Here we add the link to the new URLs to visit
            }
          }
        }
        chunkNumber++; // Here we increment the chunk number
      }

      urlsToVisit = newUrlsToVisit; // Here we update the URLs to visit
      currentLevel++; // Here we increment the current level
    }
    await this.writeFile(dbName, JSON.stringify(stackedOutput)); // Here we save the output object to a file
  }

  // TOOLS

  validateUrl(url: string): boolean {
    // Here we validate if the URL is valid
    const regex =
      /^(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|]/i;
    return regex.test(url);
  }

  async processPage(mainUrl: string, url: string): Promise<IprocessedPage> {
    let pageTitle: string = ''; // Here we store the page title
    const findedUrls: string[] = []; // Here we store the finded URLs
    const findedText: string[] = []; // Here we store the finded text

    const htmlContent = await this.extractUrl(url); // Here we extract the HTML content from the URL
    if (!htmlContent) {
      // Here we check if the HTML content exists
      return null;
    }
    const $ = cheerio.load(htmlContent); // Here we load the HTML content into cheerio
    $('*').each((index, element) => {
      // Here we iterate through the elements of the page
      if (
        EXCLUDE_SCRIPTS && // Here we check if the element is a script or noscript
        ($(element).is('script') || $(element).is('noscript'))
      ) {
        return;
      }
      if ($(element).is('title')) {
        // Here we check if the element is a title
        pageTitle = $(element).text();
      } else {
        let innerText = $(element).clone().children().remove().end().text(); // Here we get the inner text of the element
        innerText = innerText.trim(); // Here we trim the inner text
        // Here we check if there are regexs to exclude from the text
        for (const re of EXCLUDE_REGEXS_FROM_TEXT) {
          innerText = innerText.replaceAll(re, ''); // Here we replace the regexs with an empty string
        }
        if (innerText) {
          // Here we check if the inner text is not empty
          if (PARAGRAPHS_OR_WORDS === 'paragraphs') {
            this.pushUnique(findedText, innerText); // Here we add the inner text to the finded text
          } else {
            const words = innerText.split(' '); // Here we split the inner text in words
            const utfWordsRegex =
              /^[^\u0000-\u0040\u005B-\u0060\u007B-\u00BF\u02B0-\u036F\u00D7\u00F7\u2000-\u2BFF]+$/; // Here we declare the regex to check if a word is UTF-8
            for (const word of words) {
              // Here we iterate through the words
              if (word && utfWordsRegex.test(word)) {
                this.pushUnique(findedText, word); // Here we add the word to the finded text
              }
            }
          }
        }
      }
      if ($(element).is('a')) {
        // Here we check if the element is a link
        const href = $(element).attr('href'); // Here we get the href value of the link
        if (
          // Here we check if the href value is not empty and is not in the excluded hrefs
          href &&
          !EXCLUDED_HREFS.includes(href) &&
          !href.startsWith('mailto') // Here we check if the href value is not a mailto
        ) {
          const normalizedUrl = this.processHrefValue(mainUrl, href); // Here we process the href value
          if (normalizedUrl.startsWith(mainUrl)) {
            // Here we check if the href value starts with the main URL
            this.pushUnique(findedUrls, normalizedUrl); // Here we add the href value to the finded URLs
          }
        }
      }
    });
    return {
      // Here we return the processed page
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
    // Here we add an item to an array if it does not exist
    if (!arr.includes(item)) {
      arr.push(item);
    }
  }

  chunkArray(arr, chunkSize): string[][] {
    // Here we split an array in chunks
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
  }

  processHrefValue(mainUrl: string, href: string): string {
    // Here we process the href value
    href = this.addHttpIfMissing(mainUrl, href);
    href = this.addWWWIfMissing(href);
    href = this.deleteParamsFromUrl(href);
    return href;
  }

  addHttpIfMissing(mainUrl: string, href: string): string {
    // Here we complete the urls if they are incomplete.
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
    // Here we delete the params from the URL
    if (url.includes('?')) {
      return url.substring(0, url.indexOf('?'));
    } else {
      return url;
    }
  }

  addWWWIfMissing(url: string): string {
    // Here we add the www if it is missing
    if (url.includes('www.')) {
      return url;
    } else {
      return url.replace('://', '://www.');
    }
  }

  async writeFile(filePath: string, jsonString: string) {
    // Here we save the JSON data to a file
    console.log('Saving JSON data to file...');
    try {
      await fs.writeFile(filePath, jsonString);
      console.log('JSON data saved to file successfully.');
    } catch (error) {
      console.error('Error writing to file:', error);
    }
  }
}
