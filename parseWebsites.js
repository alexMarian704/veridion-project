import { Cluster } from 'puppeteer-cluster';
import { getDomain } from 'tldts';

export async function getWebSitesData(websites, websitesDataMap, scrapingStatus) {
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 25,
        puppeteerOptions: {
            headless: "new",
            ignoreHTTPSErrors: true
        }
    });

    await cluster.task(async ({ page, data: url }) => {
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
            const headers = {
                'Sec-Ch-Ua': '"Brave";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Sec-Gpc': '1',
                'Upgrade-Insecure-Requests': '1'
            };
            await page.setExtraHTTPHeaders(headers);
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            if (response) {
                if (response && (response.status() < 200 || response.status() >= 400)) {
                    throw new Error(`Response status ${response.status()} for ${url}`);
                }
                const bodyContent = await page.evaluate(() => document.body.innerText);

                const phoneRegex = /(\+\d{1,3}([- ])\d{1,4}\2\d{1,4}\2\d{1,4})|(\b\d{3}[-.]\d{3}[-.]\d{4}\b)|(\(\d{3}\)\s\d{3}[-.]\d{4})|(\+\d{1,3}\s\(\d{3}\)\s\d{3}[-.]\d{4})/g
                let phoneNumbers = bodyContent.match(phoneRegex) || [];
                phoneNumbers = phoneNumbers.filter(match => match.length >= 10);

                const links = await page.$$eval('a', elements => elements.map(el => ({
                    href: el.href,
                    text: el.textContent.trim()
                })));

                const urlObj = new URL(url);

                const socialMediaLinks = links
                    .filter(linkObj => {
                        try {
                            const isSocialMedia = linkObj.href.includes('facebook') || linkObj.href.includes('twitter') || linkObj.href.includes('linkedin') || linkObj.href.includes('instagram');
                            if (!isSocialMedia) return false;

                            const url = new URL(linkObj.href);
                            return url.pathname !== '/' && url.pathname !== '';
                        } catch (error) {
                            return false;
                        }
                    })
                    .map(linkObj => linkObj.href);

                const addressContent = await page.$$eval('address', elements => elements.map(el => el.textContent.trim()));
                let address = addressContent.length > 0 ? addressContent : [];

                if (address.length === 0) {
                    const mapIframeSrc = await page.$$eval('iframe[src*="google.com/maps"], iframe[src*="maps.google"]', iframes => iframes.map(iframe => iframe.src));
                    if (mapIframeSrc.length > 0) {
                        address = mapIframeSrc;
                    }
                }

                if (address.length === 0) {
                    const addressLinks = links.filter(linkObj => {
                        return linkObj.href.includes('maps.google') || linkObj.href.includes('google.com/maps');
                    }).map(linkObj => linkObj.href);

                    if (addressLinks.length > 0) {
                        address = addressLinks;
                    }
                }

                let hostname = urlObj.hostname;
                if (hostname.startsWith("www.")) hostname = hostname.slice(4);
                if (websitesDataMap.has(getDomain(hostname))) {
                    hostname = getDomain(hostname);
                }

                if (websitesDataMap.has(hostname)) {
                    const existingEntry = websitesDataMap.get(hostname);
                    existingEntry.phone = [...new Set([...existingEntry.phone, ...phoneNumbers])];
                    existingEntry.socialMedia = [...new Set([...existingEntry.socialMedia, ...socialMediaLinks])];
                    existingEntry.address = [...new Set([...existingEntry.address, ...address])]
                    websitesDataMap.set(hostname, existingEntry);
                } else {
                    websitesDataMap.set(hostname, {
                        phone: [...new Set(phoneNumbers)],
                        socialMedia: [...new Set(socialMediaLinks)],
                        address: [...new Set(address)]
                    });
                    scrapingStatus.scrapedWebsites++;
                }

                if (urlObj.pathname === '/' || urlObj.pathname === '') {
                    let uniqueUrls = new Set();
                    links.forEach(linkObj => {
                        if (linkObj.href.toLowerCase().includes('contact') || linkObj.text.toLowerCase().includes('contact')) {
                            if (linkObj.href.endsWith('/'))
                                uniqueUrls.add(linkObj.href.substring(0, linkObj.href.length - 1));
                            else
                                uniqueUrls.add(linkObj.href);
                        }
                    });
                    const contactLinks = Array.from(uniqueUrls);

                    for (const contactLink of contactLinks) {
                        if (contactLink.length != 0 && contactLink != url && !contactLink.includes('@')) {
                            const contactLinkUrl = new URL(contactLink);
                            if (contactLinkUrl.pathname != '/' && contactLinkUrl.pathname != '' && !contactLinkUrl.hostname.includes("contact") && contactLinkUrl.hostname.includes(hostname))
                                cluster.queue(contactLink);
                        }
                    }
                }
            } else {
                let hostname = new URL(url).hostname;
                if (hostname.startsWith("www.")) hostname = hostname.slice(4);
                handleError(hostname, url, "No response received.", websitesDataMap, scrapingStatus);
            }
        } catch (error) {
            let hostname = new URL(url).hostname;
            if (hostname.startsWith("www.")) hostname = hostname.slice(4);
            handleError(hostname, url, error.message, websitesDataMap, scrapingStatus);
        }
    });

    const first50Websites = websites.slice(112, 114);
    for (const website of first50Websites) {
        const formattedUrl = `https://${website}`;
        cluster.queue(formattedUrl);
    }

    await cluster.idle();
    await cluster.close();
}

function handleError(hostname, url, message, websitesDataMap, scrapingStatus) {
    if (websitesDataMap.has(hostname)) {
        const existingEntry = websitesDataMap.get(hostname);
        existingEntry.error = {
            url: url,
            message: message
        };
        websitesDataMap.set(hostname, existingEntry);
    } else {
        websitesDataMap.set(hostname, {
            phone: [],
            socialMedia: [],
            address: [],
            error: {
                url: url,
                message: message
            }
        });
        scrapingStatus.failedWebsites++;
    }
}