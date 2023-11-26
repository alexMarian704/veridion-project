import { Client } from '@elastic/elasticsearch';

export const elasticClient = new Client({
    cloud: {
        id: "6710828ddf5049979367972d04f8bb38:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvOjQ0MyQxNzZlOTBjZjZjMzQ0MzdhYTAzYjFhMjQ2ZTVhYzY5ZiRiZTI2NTBhYzAyOTA0NTM3YjIwNTUzYWE5ZGZmZGQ2Nw=="
    },
    auth: {
        username: "elastic",
        password: "gBu0pJNI5GLXn3A9YOVopdVP"
    }
})

export async function createIndex(indexName) {
    const exists = await elasticClient.indices.exists({ index: indexName });
    if (!exists) {
        await elasticClient.indices.create({
            index: indexName,
            body: {
                mappings: {
                    properties: {
                        website: { type: "text" },
                        websiteData: {
                            type: "object",
                            properties: {
                                phone: { 
                                    type: "text"
                                },
                                socialMedia: { 
                                    type: "text"
                                },
                                address: { 
                                    type: "text"
                                },
                                error: {
                                    type: "object",
                                    properties: {
                                        url: { type: "text" },
                                        message: { type: "keyword" }
                                    }
                                },
                                company_commercial_name: { type: "text" },
                                company_legal_name: { type: "text" },
                                company_all_available_names: { type: "text" }
                            }
                        }
                    }
                }                
            }
        });
    }
}

export async function saveDataToElasticsearch(websitesDataMap, indexName) {
    const resultArray = Array.from(websitesDataMap, ([website, websiteData]) => ({
        website: website,
        websiteData: websiteData
    }));

    for (const entry of resultArray) {
        await elasticClient.index({
            index: indexName,
            body: entry
        });
    }
}