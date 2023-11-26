import express from 'express';
import { extractUrlFromCSV, mergeWebsiteData } from './csvParser.js';
import { elasticClient, createIndex, saveDataToElasticsearch } from './elasticClient.js';
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

app.get('/', async (req, res) => {
    await createIndex(INDEX_NAME);
    await elasticClient.reindex({
        body: {
            source: { index: 'websites' },
            dest: { index: INDEX_NAME }
        }
    });
    await elasticClient.indices.delete({ index: 'websites' });

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
        return res.status(503).json({ message: "The scraper can only be runned once every 10 minutes. You can retrieve the actual data at /map-data or the saved data at /all-data. Please wait." });
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

app.get('/map-data', (req, res) => {
    const resultArray = Array.from(websitesDataMap, ([website, websiteData]) => ({
        website: website,
        websiteData: websiteData
    }));

    return res.json(resultArray);
})

app.get('/search', async (req, res) => {
    const { query } = req.query;
    const queryStrings = query.split(",");
    if (queryStrings.length != 4)
        return res.status(400).json({ message: "Wrong number of arguments. You need 4 arguments splitted by ," })

    const name = queryStrings[0];
    const phone = queryStrings[1];
    const website = queryStrings[2];
    const facebook = queryStrings[3];

    const searchQuery = {
        index: INDEX_NAME,
        size: 1,
        body: {
            query: {
                bool: {
                    should: [
                        name && {
                            multi_match: {
                                query: name,
                                fields: ['website', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names', 'websiteData.socialMedia']
                            }
                        },
                        phone && {
                            match: { 'websiteData.phone': phone }
                        },
                        website && {
                            multi_match: {
                                query: website,
                                fields: ['website', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names']
                            }
                        },
                        facebook && {
                            match: { 'websiteData.socialMedia': facebook }
                        }
                    ].filter(Boolean),
                    minimum_should_match: 1
                }
            }
        }
    };

    try {
        let results = await elasticClient.search(searchQuery);
        if(results.hits.hits.length === 0){
            const fuzzyQuery = {
                index: INDEX_NAME,
                size: 1,
                body: {
                    query: {
                        bool: {
                            should: [
                                name && {
                                    multi_match: {
                                        query: name,
                                        fields: ['website', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names'],
                                        fuzziness: "AUTO"
                                    }
                                },
                                phone && {
                                    fuzzy: {
                                        'websiteData.phone': {
                                            value: phone,
                                            fuzziness: "AUTO"
                                        }
                                    }
                                },
                                website && {
                                    multi_match: {
                                        query: website,
                                        fields: ['website', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names'],
                                        fuzziness: "AUTO"
                                    }
                                },
                                facebook && {
                                    fuzzy: {
                                        'websiteData.socialMedia': {
                                            value: facebook,
                                            fuzziness: "AUTO"
                                        }
                                    }
                                }
                            ].filter(Boolean),
                            minimum_should_match: 1
                        }
                    }
                }
            };
            results = await elasticClient.search(fuzzyQuery);
        }

        res.json(results);
    } catch (error) {
        console.error('Elasticsearch search error:', error);
        res.status(500).send({ message: 'Internal Server Error' });
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
                size: 1000
            }
        });

        res.json(results.hits.hits);
    } catch (error) {
        console.error('Elasticsearch search error:', error);
        res.status(500).send({ message: 'Internal Server Error' });
    }
});

app.get('/delete', async (req, res) => {
    try {
        await elasticClient.deleteByQuery({
            index: INDEX_NAME,
            body: {
                query: {
                    match_all: {}
                }
            }
        });

        res.json({ message: "All data deleted from the index successfully." });
    } catch (error) {
        console.error('Error deleting data from the index:', error);
        res.status(500).json({ message: "Error deleting data from the index." });
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