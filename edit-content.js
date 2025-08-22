// Content script for edit page - handles repost process
// Runs on https://www.kijiji.ca/p-edit-ad.html*
// Only activates when specifically triggered by the extension

const DELETE_ENDPOINT = 'https://www.kijiji.ca/anvil/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Create timer overlay
function createTimerOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'repost-timer-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        z-index: 999999;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const timerContent = document.createElement('div');
    timerContent.style.cssText = `
        background: white;
        border-radius: 16px;
        padding: 40px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        max-width: 400px;
    `;
    
    timerContent.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 20px;">⏰</div>
        <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Reposting Ad</h2>
        <div id="timer-display" style="font-size: 32px; font-weight: bold; color: #3498db; margin-bottom: 20px;">3:00</div>
        <p style="color: #7f8c8d; font-size: 16px; margin-bottom: 20px;">Please do not close this window until the process is complete.</p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #2c3e50; font-size: 14px; font-weight: 600;">What's happening:</p>
            <p style="margin: 5px 0 0 0; color: #7f8c8d; font-size: 12px;">1. Deleting original ad</p>
            <p style="margin: 0; color: #7f8c8d; font-size: 12px;">2. Waiting to avoid detection</p>
            <p style="margin: 0; color: #7f8c8d; font-size: 12px;">3. Posting new ad</p>
        </div>
    `;
    
    overlay.appendChild(timerContent);
    document.body.appendChild(overlay);
    return overlay;
}

// Update timer display
function updateTimerDisplay(seconds, message = '') {
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerDisplay.textContent = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        
        if (message) {
            const statusEl = document.querySelector('#timer-status');
            if (statusEl) {
                statusEl.textContent = message;
            }
        }
    }
}

async function deleteAdByPostId(postId) {
    const body = JSON.stringify([
        {
            operationName: 'DeleteAd',
            variables: { input: { adId: postId } },
            query: 'mutation DeleteAd($input: DeleteAdInputArgs) {\n  deleteAd(input: $input)\n}\n'
        }
    ]);
    
    const res = await fetch(DELETE_ENDPOINT, {
        method: 'POST',
        headers: {
            accept: '*/*',
            'accept-language': 'en',
            'apollo-require-preflight': 'true',
            'content-type': 'application/json',
            lang: 'en'
        },
        referrer: 'https://www.kijiji.ca/m-my-ads/active/1',
        referrerPolicy: 'strict-origin-when-cross-origin',
        mode: 'cors',
        credentials: 'include',
        body
    });
    
    if (!res.ok) throw new Error('Delete request failed');
}

function getPostIdFromPage() {
    console.log('Looking for post ID...');
    
    // Try multiple selectors for the post ID
    const selectors = [
        '#postad-id',
        'input[name="postad-id"]',
        'input[value*=""]',
        '[data-post-id]',
        '[data-ad-id]'
    ];
    
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
            console.log('Found element with selector:', selector, el);
            const value = el.getAttribute('value') || el.value || el.getAttribute('data-post-id') || el.getAttribute('data-ad-id');
            if (value) {
                console.log('Found post ID:', value);
                return value;
            }
        }
    }
    
    // Also check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const adIdFromUrl = urlParams.get('adId');
    if (adIdFromUrl) {
        console.log('Found adId from URL:', adIdFromUrl);
        return adIdFromUrl;
    }
    
    console.log('No post ID found. Page content:', document.body.innerHTML.substring(0, 500));
    return null;
}

function clickPostButton() {
    // Try multiple selectors for the post button
    const buttonSelectors = [
        "[data-fes-id='postAdSubmitButtons'] > div > button",
        "[data-fes-id='postAdSubmitButtons'] button",
        "button[type='submit']",
        "button:contains('Post Similar')",
        "button:contains('Post Ad')",
        "button:contains('Submit')"
    ];
    
    for (const selector of buttonSelectors) {
        const btn = document.querySelector(selector);
        if (btn) {
            console.log('Found post button with selector:', selector);
            btn.click();
            return true;
        }
    }
    
    // Also try to find by text content
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('post similar') || text.includes('post ad') || text.includes('submit')) {
            console.log('Found post button by text:', btn.textContent);
            btn.click();
            return true;
        }
    }
    
    console.log('No post button found');
    return false;
}

async function waitForPageLoad() {
    // Wait for the page to be fully loaded
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
        // Check if we're on the right page
        if (document.title.includes('Edit') || document.title.includes('Ad') || document.body.textContent.includes('Edit')) {
            console.log('Page appears to be loaded');
            break;
        }
        
        console.log(`Waiting for page to load... attempt ${attempts + 1}`);
        await sleep(1000);
        attempts++;
    }
    
    if (attempts >= maxAttempts) {
        throw new Error('Page failed to load properly');
    }
}

async function handleRepost({ adId, waitSeconds = 180, verifySeconds = 15 }) {
    // Only proceed if this is a repost operation
    if (!isRepostMode) {
        return;
    }
    
    try {
        // Create timer overlay
        const overlay = createTimerOverlay();
        
        // Wait for page to load
        await waitForPageLoad();
        
        const postId = getPostIdFromPage();
        if (!postId) {
            throw new Error('Failed to get post id - page may not be loaded correctly');
        }

        updateTimerDisplay(waitSeconds, 'Deleting original ad...');
        await deleteAdByPostId(postId);

        // Use time-based counting instead of loop iterations
        const waitStartTime = Date.now();
        const waitEndTime = waitStartTime + (waitSeconds * 1000);
        
        while (Date.now() < waitEndTime) {
            const remainingSeconds = Math.ceil((waitEndTime - Date.now()) / 1000);
            updateTimerDisplay(remainingSeconds, 'Waiting to avoid detection...');
            await sleep(1000);
        }

        updateTimerDisplay(verifySeconds, 'Posting new ad...');
        
        // Remove the post ID element to make it a new ad
        const idEl = document.getElementById('postad-id');
        if (idEl) idEl.remove();
        
        // Try to click the post button
        const clicked = clickPostButton();
        if (!clicked) {
            throw new Error('Failed to find and click post button');
        }

        // Use time-based counting for verification too
        const verifyStartTime = Date.now();
        const verifyEndTime = verifyStartTime + (verifySeconds * 1000);
        
        while (Date.now() < verifyEndTime) {
            const remainingSeconds = Math.ceil((verifyEndTime - Date.now()) / 1000);
            updateTimerDisplay(remainingSeconds, 'Verifying new ad...');
            await sleep(1000);
        }

        overlay.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <div style="font-size: 48px; margin-bottom: 20px;">✅</div>
                <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 24px;">Repost Complete!</h2>
                <p style="color: #7f8c8d; font-size: 16px; margin-bottom: 20px;">Your ad has been successfully reposted.</p>
                <button onclick="window.close()" style="padding: 12px 24px; background: #3498db; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Close Window</button>
            </div>
        `;
        
        // Auto-close after 5 seconds
        setTimeout(() => {
            window.close();
        }, 5000);
        
    } catch (err) {
        const overlay = document.getElementById('repost-timer-overlay');
        if (overlay) {
            overlay.innerHTML = `
                <div style="background: white; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
                    <h2 style="margin: 0 0 20px 0; color: #e74c3c; font-size: 24px;">Repost Failed</h2>
                    <p style="color: #7f8c8d; font-size: 16px; margin-bottom: 20px;">${err.message}</p>
                    <button onclick="window.close()" style="padding: 12px 24px; background: #e74c3c; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Close Window</button>
                </div>
            `;
        }
    }
}

// Check if this page was opened by the extension for reposting
let isRepostMode = false;

// Listen for start commands from background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'START_REPOST' && msg.payload) {
        isRepostMode = true;
        handleRepost(msg.payload);
    }
});

// Only run repost logic if explicitly triggered
// This prevents interference with normal ad editing
