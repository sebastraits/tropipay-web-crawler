# Web Crawler

TropiPay BackEnd Challenge.
The objective of this challenge is to build the core of a web crawler that will crawl the websites that are linked to an initial URL

## Installation

### Clone the repository

```bash
git clone https://github.com/sebastraits/tropipay-web-crawler
```

### Install dependencies

```bash
npm install
```

### Building the Project

```bash
nest build
```

### Usage

To run the crawler with specific parameters, you can use the following command:

```bash
node dist/main crawler --url https://www.foodsubs.com/ --maxdist 4 --db foodsubs.db

# crawler is the name of the script or command you want to execute.
# --url specifies the URL you want to start crawling from (https://www.foodsubs.com/ in this case).
# --maxdist defines the maximum distance to crawl from the initial URL (5 in this case).
# --db sets the name of the database to use (foodsubs.db in this case).
```

## Stay in touch

- Author - [Sebastian Nieto]
- Linkedin - [https://www.linkedin.com/in/sebastian-nieto-developer/](https://www.linkedin.com/in/sebastian-nieto-developer/)
