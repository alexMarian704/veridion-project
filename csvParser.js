import csv from 'csv-parser';
import fs from 'fs';

export function extractUrlFromCSV(websites, scrapingStatus) {
    return new Promise((resolve, reject) => {
        fs.createReadStream('sample-websites.csv')
            .pipe(csv())
            .on('data', (row) => {
                websites.push(row.domain);
            })
            .on('end', () => {
                console.log('CSV file successfully processed');
                scrapingStatus.numberOfDomains = websites.length;
                resolve();
            })
            .on('error', (err) => {
                console.error('Error reading CSV file', err);
                reject(err);
            });
    });
}

export function mergeWebsiteData(websitesDataMap) {
    fs.createReadStream('sample-websites-company-names.csv')
        .pipe(csv())
        .on('data', (row) => {
            if (websitesDataMap.has(row.domain)) {
                const existingEntry = websitesDataMap.get(row.domain);
                existingEntry.company_commercial_name = row.company_commercial_name;
                existingEntry.company_legal_name = row.company_legal_name;
                existingEntry.company_all_available_names = row.company_all_available_names;
            }
        }).on('error', (err) => {
            console.error('Error reading CSV file', err);
        });
}