import { Client } from '@elastic/elasticsearch';

//Credentials are exposed here for testing purposes.
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

function computeName(input) {
    const decodedInput = decodeURIComponent(input);
    let result = decodedInput.replace(/([A-Z])([a-z]+)/g, ' $1$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

    return result;
}

export async function queryData(queryStrings, INDEX_NAME){
    const name = computeName(queryStrings[0]);
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
                                fields: ['website^3', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names^2', 'websiteData.socialMedia']
                            }
                        },
                        phone && {
                            match: { 'websiteData.phone': phone }
                        },
                        website && {
                            multi_match: {
                                query: website,
                                fields: ['website^3', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names^2']
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
        if (results.hits.hits.length === 0) {
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
                                        fields: ['website^3', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names^2'],
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
                                        fields: ['website^3', 'websiteData.company_commercial_name', 'websiteData.company_legal_name', 'websiteData.company_all_available_names^2'],
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

        return results;
    } catch (error) {
        throw new Error('Internal Server Error');
    }
}