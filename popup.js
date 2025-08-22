// Kijiji Reposter Pro - Popup Script

document.addEventListener('DOMContentLoaded', function() {
    // Load settings
    loadSettings();
    
    // Check current tab status
    checkTabStatus();
    
    // Add event listeners
    setupEventListeners();
});

function loadSettings() {
    chrome.storage.local.get(['deleteDelay', 'batchDelay'], (result) => {
        document.getElementById('delete-delay').value = (result.deleteDelay || 180000) / 1000;
        document.getElementById('batch-delay').value = (result.batchDelay || 120000) / 1000;
    });
}

function checkTabStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        
        if (tab.url && tab.url.includes('kijiji.ca')) {
            statusIndicator.classList.remove('inactive');
            statusText.textContent = 'Ready on Kijiji';
            
            // Enable view history button
            document.getElementById('view-history').disabled = false;
        } else {
            statusIndicator.classList.add('inactive');
            statusText.textContent = 'Not on Kijiji';
            
            // Disable view history button (needs to be on Kijiji)
            document.getElementById('view-history').disabled = true;
        }
        
        // Go to My Ads always works
        document.getElementById('go-to-ads').disabled = false;
    });
}

function enableButtons() {
    // Only enable view history if on Kijiji
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0].url && tabs[0].url.includes('kijiji.ca')) {
            document.getElementById('view-history').disabled = false;
        }
    });
    document.getElementById('go-to-ads').disabled = false;
}

function disableButtons() {
    document.getElementById('view-history').disabled = true;
    // Don't disable go-to-ads as it works from any page
}

function setupEventListeners() {
    // View History
    document.getElementById('view-history').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'showHistory' });
        });
    });
    
    // Go to My Ads - works from any page
    document.getElementById('go-to-ads').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://www.kijiji.ca/m-my-ads/active/1' });
    });
    
    // Save settings
    document.getElementById('save-settings').addEventListener('click', () => {
        saveSettings();
    });
}

function saveSettings() {
    const deleteDelay = parseInt(document.getElementById('delete-delay').value) * 1000;
    const batchDelay = parseInt(document.getElementById('batch-delay').value) * 1000;
    
    chrome.storage.local.set({
        deleteDelay: deleteDelay,
        batchDelay: batchDelay
    }, () => {
        // Show success message
        const saveBtn = document.getElementById('save-settings');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = 'rgba(67, 233, 123, 0.3)';
        
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.background = 'rgba(255,255,255,0.2)';
        }, 2000);
        
        // Send settings to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0].url && tabs[0].url.includes('kijiji.ca')) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'updateSettings',
                    deleteDelay: deleteDelay,
                    batchDelay: batchDelay
                });
            }
        });
    });
}
