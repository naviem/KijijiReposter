// Kijiji Reposter Pro - Content Script
// Enhanced Kijiji reposting with no limits and extended delays

class KijijiReposter {
    constructor() {
        this.isProcessing = false;
        this.DELETE_DELAY = 180000; // 3 minutes
        this.BATCH_DELAY = 30000; // 30 seconds between batch items
        
        // Load settings from storage
        this.loadSettings();
        
        // Setup the page
        this.setupPage();

        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'showHistory') {
                this.showHistory();
            } else if (message.action === 'updateSettings') {
                // Handle settings update if needed
                console.log('Settings updated:', message);
            }
        });
    }

    async loadSettings() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['deleteDelay', 'batchDelay'], resolve);
            });
            
            if (result.deleteDelay) this.DELETE_DELAY = result.deleteDelay;
            if (result.batchDelay) this.BATCH_DELAY = result.batchDelay;
        } catch (error) {
            console.error('Error loading settings:', error);
            // Fallback to localStorage
            try {
                const stored = localStorage.getItem('kijijiReposterSettings');
                if (stored) {
                    const settings = JSON.parse(stored);
                    if (settings.deleteDelay) this.DELETE_DELAY = settings.deleteDelay;
                    if (settings.batchDelay) this.BATCH_DELAY = settings.batchDelay;
                }
            } catch (localError) {
                console.error('Error loading settings from localStorage:', localError);
            }
        }
    }

    setupPage() {
        const path = window.location.pathname;
        
        if (path.includes('/m-my-ads')) {
            this.setupMyAdsPage();
        } else if (path.includes('/p-edit-ad')) {
            this.setupEditPage();
        } else if (path.includes('/p-post-ad')) {
            this.setupPostAdPage();
        } else if (path.includes('/v-')) {
            this.setupAdViewPage();
        }
    }

    setupMyAdsPage() {
        // Set up a MutationObserver to watch for dynamic content loading
        this.setupContentObserver();
        
        // Wait for ads to load
        this.waitForAds(() => {
            this.addRepostButtonsToAds();
            this.addBatchRepostButton();
        });
    }

    setupContentObserver() {
        // Create a MutationObserver to watch for new content being added
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    // Check if any new nodes contain ad-like content
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const text = node.textContent.toLowerCase();
                            if ((text.includes('edit') || text.includes('delete') || text.includes('repost')) && 
                                (text.includes('$') || text.includes('price') || text.includes('for sale'))) {
                                // Re-run ad detection
                                setTimeout(() => {
                                    this.addRepostButtonsToAds();
                                    this.addBatchRepostButton();
                                }, 500);
                            }
                        }
                    });
                }
            });
        });
        
        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    async setupEditPage() {
        console.log('Setting up Edit page...');
        
        // Check if this is a manual navigation (not from extension)
        // If someone manually navigates to edit page, clear any pending repost data
        const referrer = document.referrer;
        const isManualNavigation = !referrer.includes('chrome-extension://') && 
                                  !referrer.includes('moz-extension://') &&
                                  !window.opener; // Not opened by extension
        
        if (isManualNavigation) {
            console.log('Detected manual navigation to edit page - clearing any pending repost data');
            try {
                chrome.storage.local.remove(['pendingRepost', 'repostTimestamp', 'isPostSimilar']);
                localStorage.removeItem('kijijiReposterPendingRepost');
            } catch (error) {
                // Ignore errors
            }
            return; // Don't proceed with repost logic for manual navigation
        }
        
        // Check for pending repost
        await this.checkForPendingRepost();
        
        // Add "Post Similar" button if not already present
        if (!document.querySelector('.post-similar-btn')) {
            this.addPostSimilarButton();
        }
    }

    setupAdViewPage() {
        console.log('Setting up Ad View page...');
        
        // Add "Post Similar" button
        this.addPostSimilarButton();
    }

    setupPostAdPage() {
        console.log('Setting up Post Ad page...');
        
        // Check for pending repost
        this.checkForPendingRepost();
    }

    waitForAds(callback) {
        let attempts = 0;
        const maxAttempts = 30; // Wait up to 30 seconds
        
        const checkForAds = () => {
            attempts++;
            
            // Check if loading is still happening
            const loadingIndicator = document.querySelector('[data-testid="loading-indicator"]');
            if (loadingIndicator && !loadingIndicator.classList.contains('dots__hidden-768901747')) {
                if (attempts < maxAttempts) {
                    setTimeout(checkForAds, 1000);
                } else {
                    callback();
                }
                return;
            }
            
            // Look for actual ad content
            const pageText = document.body.textContent.toLowerCase();
            const hasAdContent = pageText.includes('edit') || 
                                pageText.includes('delete') || 
                                pageText.includes('repost') ||
                                pageText.includes('$') ||
                                pageText.includes('price') ||
                                pageText.includes('for sale') ||
                                pageText.includes('active') ||
                                pageText.includes('inactive');
            
            if (hasAdContent) {
                callback();
            } else if (attempts < maxAttempts) {
                setTimeout(checkForAds, 1000);
            } else {
                callback();
            }
        };
        
        checkForAds();
    }

    addRepostButtonsToAds() {
        // Try multiple approaches to find ad containers - be more specific to avoid navigation
        let adContainers = [];
        
        // Method 1: Look for action containers first (this was working before)
        const actionContainers = document.querySelectorAll('[class^="actionsContainer-"]');
        if (actionContainers.length > 0) {
            console.log(`Found ${actionContainers.length} action containers`);
            adContainers = Array.from(actionContainers);
        }
        
        // Method 2: If no action containers, try specific ad card selectors
        if (adContainers.length === 0) {
            const adCardSelectors = [
                '[data-testid="my-ad-card"]',
                '[data-qa-id="my-ad-card"]', 
                '[data-testid="list-item"]',
                '.my-ad-card',
                '.card'
            ];
            
            for (const selector of adCardSelectors) {
                const found = document.querySelectorAll(selector);
                if (found.length > 0) {
                    adContainers = Array.from(found);
                    console.log(`Found ${adContainers.length} ad containers using selector: ${selector}`);
                    break;
                }
            }
        }
        
        // Method 3: Look for ad links and find their containers
        if (adContainers.length === 0) {
            const adLinks = document.querySelectorAll('a[href*="/v-"], a[href*="/p-edit-ad.html?adId="]');
            
            const filteredAdLinks = [];
            adLinks.forEach(link => {
                const href = link.href;
                // Skip navigation links
                if (href.includes('/p-select-category.html') || 
                    href.includes('/m-my-favourites') ||
                    href.includes('/m-msg-my-messages') ||
                    href.includes('/m-my-ads') ||
                    href.includes('/m-my-orders') ||
                    href.includes('/m-my-profile') ||
                    href.includes('/m-account-settings') ||
                    href.includes('/search') ||
                    href.includes('/filter') ||
                    href.includes('/sort') ||
                    href.includes('/page') ||
                    href.includes('/category') ||
                    href.includes('/location')) {
                    return;
                }
                
                // Find the parent container that likely contains the full ad
                let container = link.closest('li, article, div[class*="card"], div[class*="item"], div[class*="listing"]');
                if (container && !filteredAdLinks.includes(container)) {
                    filteredAdLinks.push(container);
                }
            });
            
            if (filteredAdLinks.length > 0) {
                adContainers = filteredAdLinks;
                console.log(`Found ${adContainers.length} ad containers using link filtering`);
            }
        }
        
        console.log(`Processing ${adContainers.length} total ad containers/elements`);
        
        // Process each ad container
        adContainers.forEach((container, index) => {
            let adId = null;
            
            // Extract ad ID from the container
            if (container.className && container.className.includes('actionsContainer-')) {
                // Extract ID from class name like "actionsContainer-2816087452"
                const classMatch = container.className.match(/actionsContainer-(\d+)/);
                if (classMatch) {
                    adId = classMatch[1];
                }
            }
            
            // Try to extract ad ID from various sources
            if (!adId && container.tagName === 'A' && container.href) {
                const href = container.href;
                const hrefMatch = href.match(/\/(v-|p-|ad\/|listing\/)(\d+)/);
                if (hrefMatch) {
                    adId = hrefMatch[2];
                }
            }
            
            // Try data attributes
            if (!adId) {
                adId = container.getAttribute('data-ad-id') || 
                       container.getAttribute('data-listing-id') ||
                       container.getAttribute('data-testid')?.match(/\d+/)?.[0];
            }
            
            // Try class names
            if (!adId) {
                const className = container.className || '';
                const classMatch = className.match(/(\d{7,})/);
                if (classMatch) {
                    adId = classMatch[1];
                }
            }
            
            if (adId) {
                console.log(`Processing ad ${adId} at index ${index}`);
                this.processAd(adId, container, index);
            } else {
                console.log(`No ad ID found for container ${index}`);
            }
        });
    }

    processAd(adId, container, index) {
        // Skip if already processed
        if (container.querySelector('.repost-btn')) return;
        
        // Extract ad data for history saving
        const adData = this.extractAdDataFromElement(container);
        if (!adData) {
            // Fallback to just adId if full extraction fails
            adData = { id: adId, title: 'Unknown Title', priceAmount: 0, categoryName: 'Unknown Category', thumbnailUrl: '' };
        }
            
            // Create a container for the controls
            const controlsContainer = document.createElement('div');
            controlsContainer.className = 'repost-controls';
            controlsContainer.style.cssText = `
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin: 8px 0 !important;
                padding: 8px !important;
                background: #f8f9fa !important;
                border-radius: 4px !important;
                border: 1px solid #e9ecef !important;
                position: relative !important;
                z-index: 1000 !important;
            `;
            
            // Add checkbox for batch selection
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'repost-checkbox';
            checkbox.dataset.adId = adId;
            checkbox.style.cssText = 'margin: 0; cursor: pointer;';
            
            // Add repost button
            const repostBtn = document.createElement('button');
            repostBtn.className = 'repost-btn';
            repostBtn.textContent = 'Repost Now';
            repostBtn.style.cssText = `
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                transition: all 0.3s ease;
                flex: 1;
            `;
            
            // Add hover effect
            repostBtn.addEventListener('mouseenter', () => {
                repostBtn.style.transform = 'translateY(-1px)';
                repostBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
            });
            
            repostBtn.addEventListener('mouseleave', () => {
                repostBtn.style.transform = 'translateY(0)';
                repostBtn.style.boxShadow = 'none';
            });
            
        repostBtn.addEventListener('click', () => this.repostSingleAd(adData));
            checkbox.addEventListener('change', () => this.updateSelectedCount());
            
            // Add controls to container
            controlsContainer.appendChild(checkbox);
            controlsContainer.appendChild(repostBtn);
            
            // Insert the controls into the container
            container.appendChild(controlsContainer);
    }

    isNotAnAd(element) {
        // Check if element is clearly not an ad
        const text = element.textContent.toLowerCase();
        const tagName = element.tagName.toLowerCase();
        const className = element.className.toLowerCase();
        
        // Skip navigation, headers, footers, etc.
        if (tagName === 'nav' || tagName === 'header' || tagName === 'footer') return true;
        
        // Skip elements with specific Kijiji non-ad classes
        if (className.includes('search-category') || className.includes('category-selector')) return true;
        if (className.includes('filter') || className.includes('sort')) return true;
        if (className.includes('pagination') || className.includes('breadcrumb')) return true;
        
        // Skip if element is too small (likely not an ad)
        const rect = element.getBoundingClientRect();
        if (rect.height < 30 || rect.width < 50) return true;
        
        // Skip if element contains ONLY navigation/UI text (not ad content)
        if (text.includes('search') && text.includes('category') && !text.includes('for sale') && !text.includes('wanted')) {
            return true;
        }
        
        return false;
    }

    findBestInsertLocation(adElement) {
        // Try to find the best place to insert controls within the ad
        const possibleLocations = [
            // Look for content containers
            adElement.querySelector('[class*="content"]'),
            adElement.querySelector('[class*="body"]'),
            adElement.querySelector('[class*="main"]'),
            adElement.querySelector('[class*="details"]'),
            // Look for specific Kijiji containers
            adElement.querySelector('[class*="ad-content"]'),
            adElement.querySelector('[class*="listing-content"]'),
            // Fallback to the ad element itself
            adElement
        ];
        
        for (const location of possibleLocations) {
            if (location) return location;
        }
        
        return adElement;
    }

    addBatchRepostButton() {
        // Remove existing batch section if any
        const existingSection = document.querySelector('.batch-repost-section');
        if (existingSection) existingSection.remove();
        
        const batchSection = document.createElement('div');
        batchSection.className = 'batch-repost-section';
        batchSection.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: white;
            border: 2px solid #3498db;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            z-index: 9999;
            min-width: 280px;
            max-width: 320px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        batchSection.innerHTML = `
            <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #2c3e50; text-align: center; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px;">🚀 Batch Repost</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                <button id="select-all" style="padding: 10px 12px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s ease;">Select All</button>
                <button id="repost-all" style="padding: 10px 12px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s ease;">Repost All</button>
            </div>
            <button id="repost-selected" style="width: 100%; padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; margin-bottom: 15px; transition: all 0.2s ease;">Repost Selected (0)</button>
            <button id="view-history" style="width: 100%; padding: 12px; background: #f39c12; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; margin-bottom: 15px; transition: all 0.2s ease;">View History (0)</button>
            <div style="text-align: center; padding-top: 15px; border-top: 1px solid #ecf0f1;">
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #7f8c8d;">Enjoying this extension?</p>
                <a href="https://www.paypal.com/donate/?hosted_button_id=T8DEQ4E4CU95N" target="_blank" style="display: inline-block; padding: 8px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 12px; transition: all 0.2s ease;">☕ Support Me</a>
            </div>
        `;
        
        document.body.appendChild(batchSection);
        
        // Add hover effects to buttons
        const buttons = batchSection.querySelectorAll('button');
        buttons.forEach(button => {
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'translateY(-2px)';
                button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'translateY(0)';
                button.style.boxShadow = 'none';
            });
        });
        
        // Add event listeners
        document.getElementById('select-all').addEventListener('click', () => this.selectAllAds());
        document.getElementById('repost-selected').addEventListener('click', () => this.repostSelectedAds());
        document.getElementById('repost-all').addEventListener('click', () => this.repostAllAds());
        document.getElementById('view-history').addEventListener('click', () => this.showHistory());
        
        this.updateSelectedCount();
    }

    addPostSimilarButton() {
        // Add "Post Similar" button to ad view page
        const postSimilarBtn = document.createElement('button');
        postSimilarBtn.textContent = 'Post Similar';
        postSimilarBtn.className = 'post-similar-btn';
        postSimilarBtn.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            margin: 10px;
            transition: all 0.3s ease;
        `;
        
        postSimilarBtn.addEventListener('click', () => {
            const adId = this.extractAdIdFromUrl();
            if (adId) {
                this.postSimilar(adId);
            }
        });
        
        // Find a good place to insert the button
        const container = document.querySelector('[class*="action"], [class*="button"], .ad-actions') || document.body;
        container.appendChild(postSimilarBtn);
    }

    extractAdDataFromElement(element) {
        // If this is an action container, we need to look at its parent for the actual ad content
        let adContainer = element;
        if (element.className && element.className.includes('actionsContainer-')) {
            // Go up the DOM tree to find the actual ad container
            let parent = element.parentElement;
            for (let i = 0; i < 5; i++) {
                if (parent) {
                    // Look for containers that likely contain the actual ad content
                    if (parent.querySelector('img') || 
                        parent.querySelector('h1, h2, h3') ||
                        parent.querySelector('[class*="title"]') ||
                        parent.querySelector('[class*="price"]') ||
                        parent.querySelector('[class*="description"]')) {
                        adContainer = parent;
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
        }
        
        // Use the same method as the original extension to extract complete ad data
        const link = adContainer.querySelector('a[href*="adId="]') || adContainer.querySelector('a[href*="/p-edit-ad.html?adId="]') || adContainer.querySelector('a[href*="/v-"]') || adContainer.querySelector('a[href*="itemId="]');
        let id = null;
        if (link) {
            const href = link.getAttribute('href') || '';
            const m = /adId=(\d+)/.exec(href);
            if (m && m[1]) id = parseInt(m[1], 10);
        }
        
        if (!id) {
            return null;
        }
        
        // Try multiple selectors for title - look in the actual ad container
        const titleSelectors = [
            'h3', 'h2', 'h1',
            '[data-testid="title"]', 
            '.title', 
            '[role="heading"]',
            '[class*="title"]',
            '[class*="heading"]',
            '[class*="name"]',
            '[class*="ad-title"]',
            '[class*="listing-title"]'
        ];
        
        let title = '';
        for (const selector of titleSelectors) {
            const titleEl = adContainer.querySelector(selector);
            if (titleEl && titleEl.textContent.trim() && !titleEl.textContent.includes('Edit ad')) {
                title = titleEl.textContent.trim();
                break;
            }
        }
        
        // Try multiple selectors for price
        const priceSelectors = [
            '[data-testid="price"]', 
            '.price',
            '[class*="price"]',
            '[class*="amount"]',
            '[class*="cost"]',
            '[class*="value"]'
        ];
        
        let priceText = '';
        for (const selector of priceSelectors) {
            const priceEl = adContainer.querySelector(selector);
            if (priceEl && priceEl.textContent.trim()) {
                priceText = priceEl.textContent.trim();
                break;
            }
        }
        
        const priceAmount = parseFloat((priceText || '').replace(/[^0-9.]/g, '')) || 0;
        
        // Try multiple selectors for category
        const categorySelectors = [
            '[data-testid="category"]',
            '[class*="category"]',
            '[class*="type"]',
            '[class*="section"]',
            '[class*="breadcrumb"]'
        ];
        
        let categoryName = '';
        for (const selector of categorySelectors) {
            const categoryEl = adContainer.querySelector(selector);
            if (categoryEl && categoryEl.textContent.trim()) {
                categoryName = categoryEl.textContent.trim();
                break;
            }
        }
        
        const img = adContainer.querySelector('img');
        const thumbnailUrl = img ? img.src : '';
        
        const result = { id, title, priceAmount, categoryName, thumbnailUrl };
        
        return result;
    }

    extractAdIdFromUrl() {
        const match = window.location.pathname.match(/\/v-([^\/\?]+)/);
        return match ? match[1] : null;
    }

    async repostSingleAd(adDetails) {
        if (this.isProcessing) {
            this.showNotification('⚠️ Already processing an ad', 'warning');
            return;
        }
        
        this.isProcessing = true;
        
        try {
            this.showNotification('🔄 Starting repost process...', 'info');
            
            // Send full ad data to background script (it will handle history saving)
            const response = await chrome.runtime.sendMessage({
                type: 'REPOST_AD',
                payload: adDetails
            });
            
            if (!response.ok) {
                throw new Error(response.error || 'Failed to start repost process');
            }
            
            this.showNotification('✅ Edit page opened, repost process started', 'success');
            
        } catch (error) {
            console.error('Error in repost process:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    async saveAdToHistory(adId) {
        // This function is no longer used - simplified version is in repostSingleAd
        return null;
    }

    extractAdTitle(doc) {
        // This function is no longer used
        return 'Unknown Title';
    }

    extractAdPrice(doc) {
        // This function is no longer used
        return 'Price not available';
    }

    extractAdDescription(doc) {
        // This function is no longer used
        return 'No description available';
    }

    extractAdImages(doc) {
        // This function is no longer used
        return [];
    }

    extractAdCategory(doc) {
        // This function is no longer used
        return 'Unknown Category';
    }

    extractAdLocation(doc) {
        // This function is no longer used
        return 'Unknown Location';
    }

    async deleteAd(adId) {
        // This function is no longer used - deletion is handled in the edit page script
                    return true;
    }

    async openEditPageAndAutoRepost(adDetails) {
        // This function is no longer used - replaced by openEditPageAndRepost
        return null;
    }

    async checkForPendingRepost() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['pendingRepost', 'repostTimestamp', 'isPostSimilar'], resolve);
            });
            
            // Fallback to localStorage if chrome.storage fails
            if (!result || !result.pendingRepost) {
                const stored = localStorage.getItem('kijijiReposterPendingRepost');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    localStorage.removeItem('kijijiReposterPendingRepost');
                    
                    if (parsed && parsed.pendingRepost && parsed.repostTimestamp) {
                        const timeDiff = Date.now() - parsed.repostTimestamp;
                        if (timeDiff < 600000) { // 10 minutes
                            console.log('Found pending repost:', parsed.pendingRepost);
                            console.log('Is Post Similar:', parsed.isPostSimilar);
                            
                            // Show status notification
                            this.showNotification('🔄 Auto-filling edit form...', 'info');
                            
                            // Auto-fill the edit form with ad details
                            await this.autoFillEditFormOnly(parsed.pendingRepost);
                            
                            // Check if this is a "Post Similar" request
                            if (parsed.isPostSimilar || parsed.pendingRepost.isPostSimilar) {
                                console.log('This is a Post Similar request, modifying page...');
                                
                                // Don't clear the pending repost immediately - let the modification complete first
                                // Store a flag to clear it after successful modification
                                this.pendingPostSimilarModification = true;
                                
                                await this.modifyEditPageForPostSimilar(parsed.pendingRepost);
                                
                                // Clear the pending repost after a delay to ensure modification is complete
                                setTimeout(async () => {
                                    try {
                                        chrome.storage.local.remove(['pendingRepost', 'repostTimestamp', 'isPostSimilar']);
                                        this.pendingPostSimilarModification = false;
            } catch (error) {
                                        console.error('Error clearing pending repost from chrome.storage:', error);
                                    }
                                }, 5000); // Wait 5 seconds before clearing
                            } else {
                                // Clear the pending repost immediately for non-Post Similar requests
                                try {
                                    chrome.storage.local.remove(['pendingRepost', 'repostTimestamp', 'isPostSimilar']);
                                } catch (error) {
                                    console.error('Error clearing pending repost from chrome.storage:', error);
                                }
                            }
                        }
                    }
                }
                    return;
            }
            
            if (result && result.pendingRepost && result.repostTimestamp) {
                // Check if the repost is recent (within last 10 minutes)
                const timeDiff = Date.now() - result.repostTimestamp;
                if (timeDiff < 600000) { // 10 minutes
                    console.log('Found pending repost:', result.pendingRepost);
                    console.log('Is Post Similar:', result.isPostSimilar);
                    
                    // Show status notification
                    this.showNotification('🔄 Auto-filling edit form...', 'info');
                    
                    // Auto-fill the edit form with ad details
                    await this.autoFillEditFormOnly(result.pendingRepost);
                    
                    // Check if this is a "Post Similar" request
                    if (result.isPostSimilar || result.pendingRepost.isPostSimilar) {
                        console.log('This is a Post Similar request, modifying page...');
                        
                        // Don't clear the pending repost immediately - let the modification complete first
                        // Store a flag to clear it after successful modification
                        this.pendingPostSimilarModification = true;
                        
                        await this.modifyEditPageForPostSimilar(result.pendingRepost);
                        
                        // Clear the pending repost after a delay to ensure modification is complete
                        setTimeout(async () => {
                            try {
                                chrome.storage.local.remove(['pendingRepost', 'repostTimestamp', 'isPostSimilar']);
                                this.pendingPostSimilarModification = false;
                            } catch (error) {
                                console.error('Error clearing pending repost from chrome.storage:', error);
                            }
                        }, 5000); // Wait 5 seconds before clearing
                    } else {
                        // Clear the pending repost immediately for non-Post Similar requests
                        try {
                            chrome.storage.local.remove(['pendingRepost', 'repostTimestamp', 'isPostSimilar']);
                        } catch (error) {
                            console.error('Error clearing pending repost from chrome.storage:', error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error checking for pending repost:', error);
        }
    }

    async autoFillEditFormOnly(adDetails) {
        try {
            console.log('Auto-filling edit form with:', adDetails);
            
            // Wait for form to load
            await this.delay(2000);
            
            // Fill title
            const titleField = document.getElementById('postad-title') || document.querySelector('[name="title"]') || document.querySelector('[data-testid="title"]');
            if (titleField) {
                titleField.value = adDetails.title;
                titleField.dispatchEvent(new Event('input', { bubbles: true }));
                titleField.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('✅ Title filled');
            }
            
            // Fill price
            const priceField = document.getElementById('postad-price') || document.querySelector('[name="price"]') || document.querySelector('[data-testid="price"]');
            if (priceField) {
                const priceValue = adDetails.price.replace(/[^\d.]/g, '');
                priceField.value = priceValue;
                priceField.dispatchEvent(new Event('input', { bubbles: true }));
                priceField.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('✅ Price filled');
            }
            
            // Fill description
            const descField = document.getElementById('postad-description') || document.querySelector('[name="description"]') || document.querySelector('[data-testid="description"]');
            if (descField) {
                descField.value = adDetails.description;
                descField.dispatchEvent(new Event('input', { bubbles: true }));
                descField.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('✅ Description filled');
            }
            
            // Select category
            if (adDetails.category && adDetails.category !== 'Unknown Category') {
                await this.selectCategoryInEditForm(adDetails.category);
            }
            
            // Set location
            if (adDetails.location && adDetails.location !== 'Unknown Location') {
                await this.setLocationInEditForm(adDetails.location);
            }
            
            // Upload images (placeholder for now)
            if (adDetails.images && adDetails.images.length > 0) {
                await this.uploadImagesToEditForm(adDetails.images);
            }
            
            this.showNotification('✅ Form auto-filled successfully!', 'success');
            
        } catch (error) {
            console.error('Error auto-filling edit form:', error);
            this.showNotification('⚠️ Error auto-filling form', 'warning');
        }
    }

    async selectCategoryInEditForm(categoryName) {
        try {
            const categorySelectors = [
                'select[name="category"]',
                '[data-testid="category-select"]',
                'select[class*="category"]'
            ];
            
            for (const selector of categorySelectors) {
                const categorySelect = document.querySelector(selector);
                if (categorySelect) {
                    // Try to find an option that matches the category
                    const options = categorySelect.querySelectorAll('option');
                    for (const option of options) {
                        if (option.textContent.toLowerCase().includes(categoryName.toLowerCase()) ||
                            categoryName.toLowerCase().includes(option.textContent.toLowerCase())) {
                            categorySelect.value = option.value;
                            categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
                            console.log('✅ Category selected:', option.textContent);
                            return true;
                        }
                    }
                }
            }
            
            console.log('⚠️ Could not auto-select category:', categoryName);
            return false;
        } catch (error) {
            console.error('Error selecting category:', error);
            return false;
        }
    }

    async setLocationInEditForm(location) {
        try {
            const locationField = document.querySelector('[name="location"]') || document.querySelector('[data-testid="location"]') || document.querySelector('[class*="location"]');
            if (locationField) {
                locationField.value = location;
                locationField.dispatchEvent(new Event('input', { bubbles: true }));
                locationField.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('✅ Location set:', location);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error setting location:', error);
            return false;
        }
    }

    async uploadImagesToEditForm(imageUrls) {
        // This is a placeholder - in practice, you'd need to convert URLs to files
        console.log('Would upload images:', imageUrls);
        this.showNotification(`Found ${imageUrls.length} images to upload`, 'info');
    }

    addManualPostSimilarButton() {
        // Add a manual "Post Similar" button for testing
        const manualButton = document.createElement('button');
        manualButton.textContent = '🔧 MANUAL Post Similar';
        manualButton.className = 'manual-post-similar-btn';
        manualButton.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            z-index: 100000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
        `;
        
        manualButton.addEventListener('mouseenter', () => {
            manualButton.style.transform = 'translateY(-2px)';
            manualButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
        });
        
        manualButton.addEventListener('mouseleave', () => {
            manualButton.style.transform = 'translateY(0)';
            manualButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        });
        
        manualButton.addEventListener('click', async () => {
            console.log('Manual Post Similar button clicked!');
            
            // Create dummy ad details for testing
            const dummyAdDetails = {
                id: 'test',
                title: 'Test Ad',
                price: '100',
                description: 'Test description',
                category: 'Test Category',
                location: 'Test Location',
                images: []
            };
            
            // Call the modify function directly
            await this.modifyEditPageForPostSimilar(dummyAdDetails);
        });
        
        document.body.appendChild(manualButton);
    }

    async modifyEditPageForPostSimilar(adDetails) {
        try {
            console.log('Modifying edit page for "Post Similar" with:', adDetails);
            
            // Wait for the page to fully load first
            await this.delay(2000);
            
            // COMPLETELY DIFFERENT APPROACH - Use MutationObserver to catch button changes
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                this.checkAndModifyButton(node);
                            }
                        });
                    }
                });
            });
            
            // Start observing
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // Also check immediately and repeatedly
            let attempts = 0;
            const maxAttempts = 200; // Even more attempts
            let success = false;
            
            const checkAndModifyButton = (element = document.body) => {
                attempts++;
                console.log(`Attempt ${attempts} to find and modify button`);
                
                // Try EVERY possible selector for submit buttons
                const selectors = [
                    '[data-fes-id="postAdSubmitButtons"] button',
                    'button[type="submit"]',
                    'input[type="submit"]',
                    'button:contains("Save Changes")',
                    'button:contains("Post")',
                    'button:contains("Submit")',
                    '[class*="submit"] button',
                    '[class*="post"] button',
                    '[class*="save"] button',
                    'form button[type="submit"]',
                    'form input[type="submit"]',
                    '.submit-button',
                    '.post-button',
                    '.save-button'
                ];
                
                let submitButton = null;
                
                for (const selector of selectors) {
                    try {
                        const found = element.querySelector ? element.querySelector(selector) : document.querySelector(selector);
                        if (found && (found.textContent.includes('Save') || found.textContent.includes('Post') || found.textContent.includes('Submit'))) {
                            submitButton = found;
                            break;
                        }
                    } catch (e) {
                        // Ignore invalid selectors
                    }
                }
                
                if (submitButton) {
                    console.log('Found submit button, FORCING change to Post Similar');
                    
                    // STOP OBSERVING to prevent infinite loops
                    observer.disconnect();
                    
                    // Force change the button text using multiple methods
                    submitButton.textContent = 'Post Similar';
                    submitButton.innerText = 'Post Similar';
                    submitButton.innerHTML = 'Post Similar';
                    
                    // Also try to change any child elements
                    const buttonTexts = submitButton.querySelectorAll('span, div, p, strong, b');
                    buttonTexts.forEach(text => {
                        text.textContent = 'Post Similar';
                        text.innerText = 'Post Similar';
                    });
                    
                    // Remove the ad ID field immediately and repeatedly
                    const removeAdIdField = () => {
                        const adIdField = document.getElementById('postad-id');
                        if (adIdField) {
                            console.log('Removing ad ID field');
                            adIdField.remove();
                            adIdField.style.display = 'none';
                            adIdField.value = '';
                            adIdField.type = 'hidden';
                        }
                    };
                    
                    // Remove immediately
                    removeAdIdField();
                    
                    // Remove on any button interaction
                    const events = ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
                    events.forEach(event => {
                        submitButton.addEventListener(event, removeAdIdField, true);
                    });
                    
                    // Also remove periodically
                    const removeInterval = setInterval(removeAdIdField, 100);
                    
                    // Add warning message
                    if (!document.querySelector('.post-similar-warning')) {
                        const titleField = document.getElementById('postad-title');
                        if (titleField) {
                            const warningMessage = document.createElement('p');
                            warningMessage.className = 'post-similar-warning';
                            warningMessage.innerHTML = '⚠️ Repost: You have to change the title to not be removed as duplicate';
                            warningMessage.style.cssText = `
                                padding: 12px;
                                font-size: 16px;
                                font-weight: 600;
                                color: #e74c3c;
                                background: #fdf2f2;
                                border: 2px solid #e74c3c;
                                border-radius: 8px;
                                margin: 15px 0;
                                text-align: center;
                            `;
                            
                            const titleContainer = titleField.closest('div');
                            if (titleContainer && titleContainer.parentElement) {
                                titleContainer.parentElement.insertBefore(warningMessage, titleContainer);
                            }
                        }
                    }
                    
                    this.showNotification('✅ "Post Similar" ready! Change the title and click "Post Similar" to submit.', 'success');
                    success = true;
                    return true;
                }
                
                return false;
            };
            
            // Bind the function to this instance
            this.checkAndModifyButton = checkAndModifyButton;
            
            // Try immediately
            if (checkAndModifyButton()) {
                return;
            }
            
            // Then keep trying with intervals
            const interval = setInterval(() => {
                if (checkAndModifyButton() || attempts >= maxAttempts) {
                    clearInterval(interval);
                    observer.disconnect();
                    
                    if (!success) {
                        console.log('Failed to modify button automatically, will keep trying...');
                        // Keep trying even after max attempts
                        setTimeout(() => checkAndModifyButton(), 1000);
                    }
                }
            }, 25); // Check every 25ms - extremely aggressive
            
            // Also try on page load events
            document.addEventListener('DOMContentLoaded', () => checkAndModifyButton());
            window.addEventListener('load', () => checkAndModifyButton());
            
            // Pre-fill the form
            await this.delay(500);
            await this.autoFillEditFormOnly(adDetails);
            
        } catch (error) {
            console.error('Error modifying edit page for Post Similar:', error);
            this.showNotification('⚠️ Error modifying page for Post Similar', 'warning');
        }
    }

    async getHistory() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['adHistory'], resolve);
            });
            return result.adHistory || [];
        } catch (error) {
            console.error('Error getting history from chrome.storage:', error);
            // Fallback to localStorage
            try {
                const stored = localStorage.getItem('kijijiReposterHistory');
                return stored ? JSON.parse(stored) : [];
            } catch (localError) {
                console.error('Error getting history from localStorage:', localError);
                return [];
            }
        }
    }

    async saveHistory(history) {
        try {
            await new Promise((resolve) => {
                chrome.storage.local.set({ adHistory: history }, resolve);
            });
        } catch (error) {
            console.error('Error saving history to chrome.storage:', error);
            // Fallback to localStorage
            try {
                localStorage.setItem('kijijiReposterHistory', JSON.stringify(history));
            } catch (localError) {
                console.error('Error saving history to localStorage:', localError);
            }
        }
    }

    async showHistory() {
        try {
            const history = await this.getHistory();
            
            // Remove any existing history modal
            const existingModal = document.querySelector('.history-modal, .ad-history-modal-custom');
            if (existingModal) existingModal.remove();

            // Find the batch repost modal to position relative to it
            const batchModal = document.querySelector('.batch-repost-section');
            if (!batchModal) {
                console.error('Batch repost modal not found');
                return;
            }

            const batchRect = batchModal.getBoundingClientRect();
            
            const modal = document.createElement('div');
            modal.className = 'ad-history-modal-custom';
            modal.style.cssText = `
                position: fixed !important;
                top: ${batchRect.bottom + 20}px !important;
                right: 20px !important;
                left: auto !important;
                width: 320px !important;
                max-height: 60vh !important;
                z-index: 10000 !important;
                background: white !important;
                border-radius: 16px !important;
                padding: 0 !important;
                overflow: hidden !important;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                transform: none !important;
                margin: 0 !important;
                border: 2px solid #3498db !important;
            `;
            
            // Create header
            const header = document.createElement('div');
            header.style.cssText = `
                background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
                color: white;
                padding: 20px;
                border-radius: 14px 14px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            
            const title = document.createElement('h2');
            title.textContent = `📋 Ad History (${history.length})`;
            title.style.cssText = `
                margin: 0;
                color: white;
                font-size: 20px;
                font-weight: 700;
            `;
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.id = 'close-history';
            closeBtn.style.cssText = `
                padding: 8px 12px;
                background: rgba(255,255,255,0.3);
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                font-size: 16px;
                min-width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            
            header.appendChild(title);
            header.appendChild(closeBtn);
            modal.appendChild(header);
            
            // Create content area
            const content = document.createElement('div');
            content.style.cssText = `
                padding: 20px;
                max-height: 45vh;
                overflow-y: auto;
            `;
            
            if (history.length === 0) {
                const emptyMsg = document.createElement('p');
                emptyMsg.textContent = 'No ads saved in history yet.';
                emptyMsg.style.cssText = `
                    color: #7f8c8d;
                    font-size: 16px;
                    text-align: center;
                    margin: 40px 0;
                `;
                content.appendChild(emptyMsg);
            } else {
                history.forEach((ad, index) => {
                    const adDiv = document.createElement('div');
                    adDiv.style.cssText = `
                        border: 1px solid #e9ecef;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 12px;
                        background: #f8f9fa;
                    `;
                    
                    const adTitle = document.createElement('div');
                    adTitle.textContent = ad.title;
                    adTitle.style.cssText = `
                        font-size: 14px;
                        color: #2c3e50;
                        font-weight: 600;
                        line-height: 1.3;
                        margin-bottom: 6px;
                    `;
                    
                    const adDetails = document.createElement('div');
                    adDetails.textContent = `💰 ${ad.price} • 📂 ${ad.category}`;
                    adDetails.style.cssText = `
                        color: #7f8c8d;
                        font-size: 12px;
                        font-weight: 500;
                        margin-bottom: 6px;
                    `;
                    
                    const adDate = document.createElement('div');
                    adDate.textContent = `🕒 ${new Date(ad.savedAt).toLocaleDateString()}`;
                    adDate.style.cssText = `
                        font-size: 11px;
                        color: #95a5a6;
                        margin-bottom: 12px;
                    `;
                    
                    const buttonDiv = document.createElement('div');
                    buttonDiv.style.cssText = `
                        display: flex;
                        gap: 8px;
                    `;
                    
                    const postBtn = document.createElement('button');
                    postBtn.textContent = '🚀 Post';
                    postBtn.className = 'post-similar-btn';
                    postBtn.dataset.index = index;
                    postBtn.style.cssText = `
                        flex: 1;
                        padding: 8px 12px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 12px;
                    `;
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.textContent = '🗑️';
                    deleteBtn.className = 'delete-btn';
                    deleteBtn.dataset.index = index;
                    deleteBtn.style.cssText = `
                        padding: 8px 12px;
                        background: #e74c3c;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 12px;
                    `;
                    
                    buttonDiv.appendChild(postBtn);
                    buttonDiv.appendChild(deleteBtn);
                    
                    adDiv.appendChild(adTitle);
                    adDiv.appendChild(adDetails);
                    adDiv.appendChild(adDate);
                    adDiv.appendChild(buttonDiv);
                    content.appendChild(adDiv);
                });
            }
            
            modal.appendChild(content);
            document.body.appendChild(modal);
            
            // Add event listeners
            closeBtn.addEventListener('click', () => {
                modal.remove();
            });
            
            // Add click outside to close
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
            
            // Add escape key to close
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                modal.remove();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
            
            const postButtons = modal.querySelectorAll('.post-similar-btn');
            const deleteButtons = modal.querySelectorAll('.delete-btn');
            
            postButtons.forEach(button => {
                button.addEventListener('click', async () => {
                    const index = parseInt(button.dataset.index);
                    const ad = history[index];
                    await this.postSimilarFromHistory(ad);
                    modal.remove();
                });
            });
            
            deleteButtons.forEach(button => {
                button.addEventListener('click', async () => {
                    const index = parseInt(button.dataset.index);
                    history.splice(index, 1);
                    await this.saveHistory(history);
                    this.updateHistoryCount();
                    modal.remove();
                    this.showHistory();
                });
            });
            
        } catch (error) {
            console.error('Error showing history:', error);
            this.showNotification('Error loading history', 'error');
        }
    }

    async postSimilar(adId) {
        try {
            // First save the ad to history (like original extension)
            const adDetails = await this.saveAdToHistory(adId);
            if (!adDetails) {
                throw new Error('Failed to save ad details');
            }
            
            this.showNotification('✅ Ad saved to history', 'success');
            
            // Open the EDIT page but modify it to act like "Post Similar" - like original extension
            const editUrl = `https://www.kijiji.ca/p-edit-ad.html?adId=${adId}`;
            window.open(editUrl, '_blank');
            
            // Store the ad details for auto-filling
            try {
                chrome.storage.local.set({ 
                    pendingRepost: adDetails,
                    repostTimestamp: Date.now(),
                    isPostSimilar: true // Flag to indicate this is a "Post Similar" operation
                });
            } catch (error) {
                console.error('Error saving pending repost to chrome.storage:', error);
                // Fallback to localStorage
                try {
                    localStorage.setItem('kijijiReposterPendingRepost', JSON.stringify({
                        pendingRepost: adDetails,
                        repostTimestamp: Date.now(),
                        isPostSimilar: true
                    }));
                } catch (localError) {
                    console.error('Error saving pending repost to localStorage:', localError);
                }
            }
            
            this.showNotification('📝 Edit page opened! Will be modified for "Post Similar".', 'success');
            
        } catch (error) {
            console.error('Error in post similar:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        }
    }

    async postSimilarFromHistory(adDetails) {
        try {
            this.showNotification('📝 Opening edit page for "Post Similar"...', 'info');
            
            // Open the EDIT page but modify it to act like "Post Similar" - like original extension
            const editUrl = `https://www.kijiji.ca/p-edit-ad.html?adId=${adDetails.id}`;
            window.open(editUrl, '_blank');
            
            // Store the ad details for auto-filling
            try {
                chrome.storage.local.set({ 
                    pendingRepost: adDetails,
                    repostTimestamp: Date.now(),
                    isPostSimilar: true // Flag to indicate this is a "Post Similar" operation
                });
            } catch (error) {
                console.error('Error saving pending repost to chrome.storage:', error);
                // Fallback to localStorage
                try {
                    localStorage.setItem('kijijiReposterPendingRepost', JSON.stringify({
                        pendingRepost: adDetails,
                        repostTimestamp: Date.now(),
                        isPostSimilar: true
                    }));
                } catch (localError) {
                    console.error('Error saving pending repost to localStorage:', localError);
                }
            }
            
            this.showNotification('✅ Edit page opened! Will be modified for "Post Similar".', 'success');
            
        } catch (error) {
            console.error('Error in post similar from history:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        }
    }

    selectAllAds() {
        const checkboxes = document.querySelectorAll('.repost-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
        });
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        const selected = document.querySelectorAll('.repost-checkbox:checked').length;
        const repostSelectedBtn = document.getElementById('repost-selected');
        if (repostSelectedBtn) {
            repostSelectedBtn.textContent = `Repost Selected (${selected})`;
            repostSelectedBtn.disabled = selected === 0;
        }
    }

    async repostSelectedAds() {
        const selectedCheckboxes = document.querySelectorAll('.repost-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            this.showNotification('⚠️ No ads selected for repost', 'warning');
            return;
        }
        
        const selectedAds = [];
        for (const checkbox of selectedCheckboxes) {
            const adId = checkbox.dataset.adId;
            
            // Find the action container that contains this checkbox
            const actionContainer = checkbox.closest('.repost-controls')?.parentElement;
            if (actionContainer && actionContainer.className && actionContainer.className.includes('actionsContainer-')) {
                // Extract ad data directly from the action container
                const adData = this.extractAdDataFromElement(actionContainer);
                if (adData && adData.id) {
                    selectedAds.push(adData);
                }
            }
        }

        if (selectedAds.length === 0) {
            this.showNotification('⚠️ No valid ads found to repost', 'warning');
            return;
        }
        
        this.showNotification(`🔄 Starting batch repost for ${selectedAds.length} ads...`, 'info');
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'REPOST_BATCH',
                payload: selectedAds
            });
            
            if (response.ok) {
                this.showNotification(`✅ ${response.message}`, 'success');
                // Uncheck all checkboxes
                selectedCheckboxes.forEach(cb => cb.checked = false);
                this.updateSelectedCount();
            } else {
                throw new Error(response.error || 'Failed to start batch repost');
            }
        } catch (error) {
            console.error('Error in batch repost:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        }
    }

    async repostAllAds() {
        const allCheckboxes = document.querySelectorAll('.repost-checkbox');
        if (allCheckboxes.length === 0) {
            this.showNotification('⚠️ No ads found to repost', 'warning');
            return;
        }

        const allAds = [];
        for (const checkbox of allCheckboxes) {
            const adId = checkbox.dataset.adId;
            
            // Find the action container that contains this checkbox
            const actionContainer = checkbox.closest('.repost-controls')?.parentElement;
            if (actionContainer && actionContainer.className && actionContainer.className.includes('actionsContainer-')) {
                // Extract ad data directly from the action container
                const adData = this.extractAdDataFromElement(actionContainer);
                if (adData && adData.id) {
                    allAds.push(adData);
                }
            }
        }

        if (allAds.length === 0) {
            this.showNotification('⚠️ No valid ads found to repost', 'warning');
            return;
        }
        
        this.showNotification(`🔄 Starting batch repost for all ${allAds.length} ads...`, 'info');
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'REPOST_BATCH',
                payload: allAds
            });
            
            if (response.ok) {
                this.showNotification(`✅ ${response.message}`, 'success');
                // Uncheck all checkboxes
                allCheckboxes.forEach(cb => cb.checked = false);
                this.updateSelectedCount();
            } else {
                throw new Error(response.error || 'Failed to start batch repost');
            }
        } catch (error) {
            console.error('Error in batch repost:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        }
    }

    async repostBatch(adIds) {
        if (this.isProcessing) {
            this.showNotification('Already processing reposts', 'warning');
            return;
        }
        
        this.isProcessing = true;
        
        try {
            this.showNotification(`🔄 Starting batch repost of ${adIds.length} ads...`, 'info');
            
            for (let i = 0; i < adIds.length; i++) {
                const adId = adIds[i];
                
                this.showNotification(`📝 Processing ad ${i + 1} of ${adIds.length}...`, 'info');
                
                // Save ad to history
                const adDetails = await this.saveAdToHistory(adId);
                if (!adDetails) {
                    console.error(`Failed to save ad ${adId} to history`);
                    continue;
                }
                
                // Delete the ad
                await this.deleteAd(adId);
                
                // Wait before processing next ad
                if (i < adIds.length - 1) {
                    this.showNotification(`⏰ Waiting ${this.BATCH_DELAY / 1000} seconds before next ad...`, 'info');
                    await this.showCountdownTimer(this.BATCH_DELAY, 'Next ad in');
                }
            }
            
            this.showNotification('✅ Batch repost completed!', 'success');
            
        } catch (error) {
            console.error('Error in batch repost:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    async updateHistoryCount() {
        try {
            const history = await this.getHistory();
            const historyBtn = document.getElementById('view-history');
            if (historyBtn) {
                historyBtn.textContent = `View History (${history.length})`;
            }
        } catch (error) {
            console.error('Error updating history count:', error);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `repost-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    async showCountdownTimer(duration, message) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const endTime = startTime + duration;
            
            // Create countdown notification
            const countdownNotification = document.createElement('div');
            countdownNotification.className = 'repost-notification countdown-timer';
            countdownNotification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #2c3e50;
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                min-width: 200px;
                text-align: center;
            `;
            
            const updateTimer = () => {
                const now = Date.now();
                const remaining = Math.max(0, endTime - now);
                
                if (remaining <= 0) {
                    countdownNotification.remove();
                    resolve();
                    return;
                }
                
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                
                countdownNotification.innerHTML = `
                    <div style="margin-bottom: 5px;">⏰ ${message}</div>
                    <div style="font-size: 24px; color: #3498db;">${timeString}</div>
                    <div style="font-size: 12px; margin-top: 5px; opacity: 0.8;">Please don't close this page</div>
                `;
                
                requestAnimationFrame(updateTimer);
            };
            
            document.body.appendChild(countdownNotification);
            updateTimer();
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize the reposter
const reposter = new KijijiReposter();