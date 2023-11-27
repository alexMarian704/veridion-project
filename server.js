import express from 'express';
import { extractUrlFromCSV, mergeWebsiteData } from './csvParser.js';
import { elasticClient, createIndex, saveDataToElasticsearch, queryData } from './elasticClient.js';
import { getWebSitesData } from './parseWebsites.js';

const app = express();

const websites = [];
const websitesDataMap = new Map();
let scrapingStatus = {
    numberOfDomains: 0,
    scrapedWebsites: 0,
    failedWebsites: 0,
    status: "not_started"
};
let lastScrapeTime = 0;
const INDEX_NAME = "websites-data";

app.get('/', (req, res) => {
    return res.json({ message: "Server is running" });
})

app.get('/scrape', async (req, res) => {
    if (scrapingStatus.status === "in_progress") {
        return res.status(503).json({ message: "Scraping is already in progress. Please wait." });
    }

    if (scrapingStatus.status === "indexing") {
        return res.status(503).json({ message: "Scraping completed. The data is indexing. Please wait." });
    }

    const currentTime = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    if (currentTime - lastScrapeTime < tenMinutes) {
        return res.status(503).json({ message: "The scraper can only be runned once every 10 minutes. Please wait." });
    }

    scrapingStatus.scrapedWebsites = 0;
    scrapingStatus.failedWebsites = 0;
    scrapingStatus.status = "in_progress";
    lastScrapeTime = currentTime;
    websitesDataMap.clear();

    getWebSitesData(websites, websitesDataMap, scrapingStatus).then(async () => {
        mergeWebsiteData(websitesDataMap);
        scrapingStatus.status = "indexing";

        await createIndex(INDEX_NAME);
        await saveDataToElasticsearch(websitesDataMap, INDEX_NAME);
        scrapingStatus.status = "completed";
    });

    if (scrapingStatus.status === "in_progress") {
        return res.json({ message: "Scraper started. Please wait." });
    }
});

app.get('/last-scrape', (req, res) => {
    const resultArray = Array.from(websitesDataMap, ([website, websiteData]) => ({
        website: website,
        websiteData: websiteData
    }));

    return res.json(resultArray);
})

app.get('/search', async (req, res) => {
    const { query } = req.query;
    let queryStrings = query.split(",");
    if (queryStrings.length != 4) {
        const queryParamIndex = req.originalUrl.indexOf("query=") + 6;
        let queryFull = req.originalUrl.substring(queryParamIndex);
        queryStrings = queryFull.split(",");
        if (queryStrings.length != 4)
            return res.status(400).json({ message: "Wrong number of arguments. You need 4 arguments splitted by ," })
    }

    try{
        const result = await queryData(queryStrings, INDEX_NAME);
        return res.json(result);
    }catch(error){
        res.status(500).send({ message: error.message });
    }
});

app.get('/all-data', async (req, res) => {
    try {
        const results = await elasticClient.search({
            index: INDEX_NAME,
            body: {
                query: {
                    match_all: {}
                },
                size: websites.length
            }
        });

        res.json(results.hits.hits);
    } catch (error) {
        console.error('Elasticsearch search error:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

app.get('/data-analysis', (req, res) => {
    if (scrapingStatus.status === "completed") {
        let totalPhoneNumbers = 0;
        let totalSocialMediaLinks = 0;
        let totalAddresses = 0;

        websitesDataMap.forEach((data, website) => {
            totalPhoneNumbers += data.phone.length;
            totalSocialMediaLinks += data.socialMedia.length;
            totalAddresses += data.address.length;
        });

        const analysisResult = {
            scrapingStatus,
            totalPhoneNumbersExtracted: totalPhoneNumbers,
            totalSocialMediaLinksExtracted: totalSocialMediaLinks,
            totalAddressesExtracted: totalAddresses
        };

        return res.json(analysisResult);
    } else if (scrapingStatus.status === "in_progress" || scrapingStatus.status === "indexing") {
        res.json(scrapingStatus);
    } else {
        return res.json({ message: "Please run the scraper" });
    }
})

extractUrlFromCSV(websites, scrapingStatus).then(() => {
    app.listen(3000, () => {
        console.log(`Server started on http://localhost:3000`);
    });
}).catch((err) => {
    console.error('Failed to start server', err);
});