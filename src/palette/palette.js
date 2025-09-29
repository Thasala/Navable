
const STORAGE_KEY = 'navable_recent_jumps';
const MAX_RECENT_JUMPS = 5; 

function getQuickJumpTargets() {
    const targets = [];
    
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el, index) => {
        const level = parseInt(el.tagName.substring(1)); 
        targets.push({
            id: 'heading-' + index, 
            role: 'Heading',
            level: level,
            title: el.textContent.trim().substring(0, 100),
            element: el 
        });
    });

   
    const landmarkSelectors = 'main, nav, header, footer, [role="banner"], [role="contentinfo"], [role="navigation"], [role="main"], [role="complementary"]';
    document.querySelectorAll(landmarkSelectors).forEach((el, index) => {
        if (!el.textContent.trim()) return; 
        
        let role = el.tagName.toLowerCase();
        if (el.hasAttribute('role')) role = el.getAttribute('role');
        else if (el.tagName === 'NAV') role = 'Navigation';
        
        targets.push({
            id: 'landmark-' + index,
            role: role.charAt(0).toUpperCase() + role.slice(1),
            level: null,
            title:' Landmark: $ {el.textContent.trim().substring(0, 50)}...',
            element: el
        });
    });
    
    
    const actionSelectors = 'button:not([disabled]), a[href]:not([disabled]):not([href="#"]), [role="button"]';
    document.querySelectorAll(actionSelectors).forEach((el, index) => {
        if (!el.textContent.trim() && !el.getAttribute('aria-label')) return; 

        

        targets.push({
            id: 'action-' + index,
            role: 'Actionable',
            level: null,
            title: 'Action: ${title.substring(0, 50)}...',
            element: el
        });
    });

    return targets;
}

function saveRecentJump(jumpItem) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.local.get(STORAGE_KEY, (result) => {
        let recentJumps = result[STORAGE_KEY] || [];
        recentJumps = recentJumps.filter(item => item.id !== jumpItem.id);
        recentJumps.unshift(jumpItem);
        if (recentJumps.length > MAX_RECENT_JUMPS) {
            recentJumps = recentJumps.slice(0, MAX_RECENT_JUMPS);
        }
        chrome.storage.local.set({ [STORAGE_KEY]: recentJumps });
    });
}

function getRecentJumps() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage) {
            resolve([]); 
            return;
        }

        chrome.storage.local.get(STORAGE_KEY, (result) => {
            resolve(result[STORAGE_KEY] || []);
        });
    });
}


function announceSelection(message) {
    const announcer = document.getElementById('palette-announcer');
    if (announcer) {
        
        announcer.textContent = '';
        setTimeout(() => {
            announcer.textContent = message;
        }, 100);
    }
}

function performQuickJump(jumpItem) {
    if (!jumpItem || !jumpItem.element) return;

    const targetElement = jumpItem.element;

   
    if (!targetElement.getAttribute('tabindex')) {
        targetElement.setAttribute('tabindex', '-1');
    }
    targetElement.focus();
    targetElement.removeAttribute('tabindex');
    
   
    let announcementText = '';
    if (jumpItem.role === 'Heading' && jumpItem.level) {
        announcementText = 'Heading level ${jumpItem.level} — ${jumpItem.title}';
    } else {
        announcementText = '${jumpItem.role} — ${jumpItem.title}';
    }

    
    announceSelection(announcementText); 

    
    const itemToStore = { id: jumpItem.id, role: jumpItem.role, level: jumpItem.level, title: jumpItem.title };
    saveRecentJump(itemToStore);
    
    
    hidePalette(); 
}

let currentTargets = []; 
let filteredTargets = []; 
let selectedIndex = -1; 

async function loadAndRenderPalette() {
    const pageTargets = getQuickJumpTargets(); 
    const recentJumps = await getRecentJumps();
    
    const combinedTargetsMap = new Map();
    
    recentJumps.forEach(recentItem => {
        const matchingPageTarget = pageTargets.find(p => p.id === recentItem.id);
        if (matchingPageTarget) {
            combinedTargetsMap.set(recentItem.id, { ...matchingPageTarget, isRecent: true });
        }
    });

    pageTargets.forEach(target => {
        if (!combinedTargetsMap.has(target.id)) {
            combinedTargetsMap.set(target.id, target);
        }
    });
    
    currentTargets = Array.from(combinedTargetsMap.values());
    filterList(document.getElementById('palette-search')?.value || '');
}

function renderList() {
    const listElement = document.getElementById('palette-list');
    if (!listElement) return;

    listElement.innerHTML = ''; 

    if (filteredTargets.length === 0) {
        listElement.innerHTML = <li class="palette-fallback" role="alert">No matching items found.</li>;
        return;
    }

    filteredTargets.forEach((item, index) => {
        const listItem = document.createElement('li');
        listItem.setAttribute('role', 'option');
        listItem.setAttribute('data-index', index);
        listItem.classList.add('palette-item');
        
        if (index === selectedIndex) {
            listItem.classList.add('selected');
            listItem.setAttribute('aria-selected', 'true'); 
        }

        let label = '';
        if (item.isRecent) label += <span class="recent-tag">[Recent]</span> ;
        
        if (item.role === 'Heading' && item.level) {
            label += '<strong>H${item.level}</strong>: ${item.title}';
        } else {
            label += '<strong>${item.role}</strong>: ${item.title}';
        }
        
        listItem.innerHTML = label;

        listItem.addEventListener('click', () => {
            performQuickJump(item);
        });

        listElement.appendChild(listItem);
    });
}

function filterList(searchText) {
    if (!searchText) {
        filteredTargets = currentTargets;
    } else {
        const lowerSearch = searchText.toLowerCase();
        filteredTargets = currentTargets.filter(item => 
            item.title.toLowerCase().includes(lowerSearch) || 
            item.role.toLowerCase().includes(lowerSearch)
        );
    }
    
    selectedIndex = filteredTargets.length > 0 ? 0 : -1;
    renderList();
}

function handleSearchInput() {
    const searchInput = document.getElementById('palette-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', (event) => {
        filterList(event.target.value);
    });
}

function handleKeyboardNavigation() {
    const searchInput = document.getElementById('palette-search');
    if (!searchInput) return;

    searchInput.addEventListener('keydown', (event) => {
        if (filteredTargets.length === 0) return;

        let shouldRender = false;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();selectedIndex = (selectedIndex + 1) % filteredTargets.length;
                shouldRender = true;
                break;

            case 'ArrowUp':
                event.preventDefault(); 
                selectedIndex = (selectedIndex - 1 + filteredTargets.length) % filteredTargets.length;
                shouldRender = true;
                break;

            case 'Enter':
                event.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < filteredTargets.length) {
                    performQuickJump(filteredTargets[selectedIndex]);
                }
                break;
                
            case 'Escape':
                hidePalette(); 
                break;
        }

        if (shouldRender) {
            renderList();
            document.getElementById('palette-list').children[selectedIndex]?.scrollIntoView({ block: "nearest" });
        }
    });
}



const paletteElement = document.getElementById('navable-palette'); 
const searchInput = document.getElementById('palette-search');

function showPalette() {
    if (!paletteElement) return;
    paletteElement.classList.remove('palette-hidden');
    paletteElement.classList.add('palette-visible');
    
    loadAndRenderPalette();     
    handleSearchInput();        
    handleKeyboardNavigation(); 
    
    searchInput?.focus();
}

function hidePalette() {
    if (!paletteElement) return;
    paletteElement.classList.remove('palette-visible');
    paletteElement.classList.add('palette-hidden');
    searchInput.value = '';
    filterList('');
}

function togglePalette() {
    if (paletteElement?.classList.contains('palette-visible')) {
        hidePalette();
    } else {
        showPalette();
    }
}
