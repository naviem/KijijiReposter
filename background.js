// Background script for Kijiji Reposter Extension
// Handles opening edit pages and messaging between content scripts

// Storage keys - match the main content script
const STORAGE_KEYS = {
    HISTORY: 'adHistory',
    STATUS: 'kijiji:repostStatus'
};

// Utilities
async function getLocal(key, fallback) {
    const obj = await chrome.storage.local.get(key);
    return obj[key] ?? fallback;
}

async function setLocal(key, value) {
    await chrome.storage.local.set({ [key]: value });
}

async function pushHistory(entry) {
    const hist = await getLocal(STORAGE_KEYS.HISTORY, []);
    
    // Convert the ad data to the format expected by the history display
    const historyEntry = {
        id: entry.id,
        title: entry.title,
        price: entry.priceAmount ? `$${entry.priceAmount}` : 'Price not available',
        category: entry.categoryName || 'Unknown Category',
        savedAt: new Date().toISOString(),
        thumbnailUrl: entry.thumbnailUrl || ''
    };
    
    hist.unshift(historyEntry);
    await setLocal(STORAGE_KEYS.HISTORY, hist.slice(0, 750));
}

async function updateStatus(adId, status) {
    const statusMap = await getLocal(STORAGE_KEYS.STATUS, {});
    statusMap[adId] = { status, lastUpdated: Date.now() };
    await setLocal(STORAGE_KEYS.STATUS, statusMap);
}

// Open edit page in a new window
async function openEditPage(adId) {
    console.log('Opening edit page for adId:', adId);
    const width = Math.floor(Math.random() * 800) + 500;
    const height = Math.floor(Math.random() * 800) + 500;
    
    const editUrl = `https://www.kijiji.ca/p-edit-ad.html?adId=${adId}`;
    console.log('Opening URL:', editUrl);
    
    const { id: windowId, tabs } = await chrome.windows.create({
        url: editUrl,
        focused: false,
        height,
        width,
        type: 'panel'
    });
    
    const tabId = tabs && tabs[0] ? tabs[0].id : null;
    console.log('Created window:', windowId, 'tab:', tabId);
    return { windowId, tabId };
}

// Handle single repost
async function handleSingleRepost(adData) {
    try {
        // Save ad to history like the original extension
        await pushHistory(adData);
        await updateStatus(String(adData.id), 'Opening edit page');
        
        // Set up pending repost data for the edit page content script
        const pendingRepostData = {
            ...adData,
            isPostSimilar: false // This is a regular repost, not post similar
        };
        
        await setLocal('pendingRepost', pendingRepostData);
        await setLocal('repostTimestamp', Date.now());
        await setLocal('isPostSimilar', false);
        
        const { windowId, tabId } = await openEditPage(adData.id);
        
        // Wait for the edit page to load and then send the repost command
        setTimeout(async () => {
            try {
                console.log('Sending START_REPOST message to tab:', tabId);
                await chrome.tabs.sendMessage(tabId, {
                    type: 'START_REPOST',
                    payload: { adId: adData.id, waitSeconds: 180 } // 3 minutes for single repost
                });
            } catch (error) {
                console.error('Failed to send repost command:', error);
            }
        }, 3000); // Wait 3 seconds for page to load
        
        return { ok: true, windowId, tabId };
    } catch (error) {
        console.error('Error opening edit page:', error);
        return { ok: false, error: error.message };
    }
}

// Handle batch repost with staggered timing
async function handleBatchRepost(ads) {
    console.log(`Starting batch repost for ${ads.length} ads`);
    
    for (let i = 0; i < ads.length; i++) {
        const ad = ads[i];
        const extraMinutes = i; // First ad: 0 extra minutes, second ad: 1 extra minute, etc.
        const waitSeconds = 180 + (extraMinutes * 60); // 3 minutes + extra minutes
        
        console.log(`Processing ad ${i + 1}/${ads.length}: ${ad.title} (waiting ${waitSeconds} seconds)`);
        
        try {
            // Save ad to history
            await pushHistory(ad);
            await updateStatus(String(ad.id), `Batch ${i + 1}/${ads.length}: Opening edit page`);
            
            // Set up pending repost data for the edit page content script
            const pendingRepostData = {
                ...ad,
                isPostSimilar: false // This is a regular repost, not post similar
            };
            
            await setLocal('pendingRepost', pendingRepostData);
            await setLocal('repostTimestamp', Date.now());
            await setLocal('isPostSimilar', false);
            
            const { windowId, tabId } = await openEditPage(ad.id);
            
            // Wait for the edit page to load and then send the repost command
            setTimeout(async () => {
                try {
                    console.log(`Sending START_REPOST message to tab ${tabId} for ad ${ad.id} (waiting ${waitSeconds}s)`);
                    await chrome.tabs.sendMessage(tabId, {
                        type: 'START_REPOST',
                        payload: { adId: ad.id, waitSeconds: waitSeconds }
                    });
                } catch (error) {
                    console.error('Failed to send repost command:', error);
                }
            }, 3000); // Wait 3 seconds for page to load
            
            // Wait a bit before processing the next ad
            if (i < ads.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between ads
            }
            
        } catch (error) {
            console.error(`Error processing ad ${ad.id}:`, error);
            await updateStatus(String(ad.id), `Error: ${error.message}`);
        }
    }
}

// Handle repost requests from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (!msg || !msg.type) return;
        
        switch (msg.type) {
            case 'REPOST_AD': {
                const adData = msg.payload;
                console.log('Received REPOST_AD request for ad:', adData);
                const result = await handleSingleRepost(adData);
                sendResponse(result);
                break;
            }
            case 'REPOST_BATCH': {
                const ads = msg.payload;
                console.log('Received REPOST_BATCH request for ads:', ads);
                handleBatchRepost(ads); // Don't wait for completion
                sendResponse({ ok: true, message: `Started batch repost for ${ads.length} ads` });
                break;
            }
        }
    })();
    return true; // Keep channel open for async response
});
