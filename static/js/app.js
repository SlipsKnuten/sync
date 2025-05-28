document.addEventListener('DOMContentLoaded', function() {
    const editor = document.getElementById('editor');
    const sessionBtn = document.getElementById('sessionBtn');
    const sessionCodeDisplay = document.getElementById('sessionCode');
    const usersBtn = document.getElementById('usersBtn');
    const wordCount = document.getElementById('wordCount');
    const connectionStatus = document.getElementById('connectionStatus');
    
    const sessionModal = document.getElementById('sessionModal');
    const closeSessionModal = document.getElementById('closeSessionModal');
    const joinSessionBtn = document.getElementById('joinSessionBtn');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const userNameInput = document.getElementById('userName');
    const sessionCodeInput = document.getElementById('sessionCodeInput');
    
    const usersModal = document.getElementById('usersModal');
    const closeUsersModal = document.getElementById('closeUsersModal');
    const usersListEl = document.getElementById('usersList');
    const copyInviteLinkBtn = document.getElementById('copyInviteLink');
        
    let currentSessionId = null;
    let currentUserId = localStorage.getItem('doccollab_userid') || generateId();
    localStorage.setItem('doccollab_userid', currentUserId);
    let currentUserName = localStorage.getItem('doccollab_username') || 'Anonymous';
    userNameInput.value = currentUserName;
    let currentUserColor = '#CCCCCC'; 

    let ws = null;
    let isConnected = false;
    let applyingRemoteUpdate = false; 

    const copyIconHTML = ' <i class="fas fa-copy ml-2 text-xs"></i>';

    const toolbar = document.getElementById('toolbar');
    const fontSizeSelect = document.getElementById('fontSizeSelect'); 

    let remoteUserCursors = {};
    
    // Local cursor elements and state
    let localCursorElement = null;
    let localCursorNameElement = null;
    let typingTimeout = null;
    let isTyping = false;

    // Create local cursor element
    function createLocalCursor() {
        if (!localCursorElement) {
            localCursorElement = document.createElement('div');
            localCursorElement.classList.add('remote-cursor', 'local-cursor');
            localCursorNameElement = document.createElement('span');
            localCursorNameElement.classList.add('remote-cursor-name');
            localCursorNameElement.textContent = currentUserName + ' (You)';
            localCursorElement.appendChild(localCursorNameElement);
            localCursorElement.style.opacity = '0'; // Start hidden
        }
    }

    // Update local cursor position
    function updateLocalCursor() {
        if (!localCursorElement || !currentUserColor || document.activeElement !== editor) {
            if (localCursorElement) {
                localCursorElement.style.opacity = '0';
            }
            return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);

        if (!editor.contains(range.startContainer)) return;

        // Position the cursor
        const tempRange = document.createRange();
        try {
            tempRange.setStart(range.startContainer, range.startOffset);
            tempRange.collapse(true);
            
            const rect = tempRange.getBoundingClientRect();
            const editorRect = editor.getBoundingClientRect();

            localCursorElement.style.left = `${rect.left - editorRect.left + editor.scrollLeft}px`;
            localCursorElement.style.top = `${rect.top - editorRect.top + editor.scrollTop}px`;
            
            let lineHeight = rect.height;
            if (!lineHeight || lineHeight < 5) {
                let parentForStyle = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
                if (!editor.contains(parentForStyle) || !parentForStyle) parentForStyle = editor;
                lineHeight = parseFloat(getComputedStyle(parentForStyle).lineHeight);
                if (isNaN(lineHeight) || lineHeight === 0) {
                    lineHeight = parseFloat(getComputedStyle(parentForStyle).fontSize) * 1.2 || 18;
                }
            }
            if (lineHeight < 10) lineHeight = 18;

            localCursorElement.style.height = `${lineHeight}px`;
            localCursorElement.style.backgroundColor = currentUserColor;
            localCursorNameElement.style.backgroundColor = currentUserColor;
            
            // Show cursor but control name visibility based on typing
            localCursorElement.style.opacity = '0.9';
            localCursorNameElement.style.opacity = isTyping ? '0' : '1';
            
            // Ensure cursor is in editor
            if (!editor.contains(localCursorElement)) {
                editor.appendChild(localCursorElement);
            }
        } catch(e) {
            localCursorElement.style.opacity = '0';
        }
    }

    // Handle typing state
    function handleTypingStart() {
        isTyping = true;
        if (localCursorNameElement) {
            localCursorNameElement.style.transition = 'opacity 0.2s';
            localCursorNameElement.style.opacity = '0';
        }
        
        // Clear existing timeout
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
        
        // Set new timeout to show name tag after stopping typing
        typingTimeout = setTimeout(() => {
            isTyping = false;
            if (localCursorNameElement && document.activeElement === editor) {
                localCursorNameElement.style.opacity = '1';
            }
        }, 1000); // Show name tag 1 second after stopping typing
    }

    // Update local cursor name
    function updateLocalCursorName() {
        if (localCursorNameElement) {
            localCursorNameElement.textContent = currentUserName + ' (You)';
        }
    }

    if (toolbar) {
        const toolbarButtons = toolbar.querySelectorAll('button[data-command]');
        toolbarButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const command = button.dataset.command;
                let value = button.dataset.value || null;
                if (command) {
                    document.execCommand(command, false, value);
                    editor.focus(); 
                    handleLocalContentChange(); 
                    updateAllToolbarStates();
                }
            });
        });

        const formatBlockSelect = toolbar.querySelector('select[data-command="formatBlock"]');
        if (formatBlockSelect) {
            formatBlockSelect.addEventListener('change', () => {
                const value = formatBlockSelect.value;
                if (value) {
                    document.execCommand('formatBlock', false, `<${value}>`);
                    editor.focus();
                    handleLocalContentChange();
                    updateAllToolbarStates(); 
                }
            });
        }

        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', () => {
                const size = fontSizeSelect.value;
                if (size) { 
                    document.execCommand('fontSize', false, size);
                    editor.focus();
                    handleLocalContentChange();
                    updateAllToolbarStates(); 
                }
            });
        }
    }

    function updateToolbarButtonStates() {
        if (!toolbar || document.activeElement !== editor) return;
        const toolbarButtons = toolbar.querySelectorAll('button[data-command]');
        toolbarButtons.forEach(button => {
            const command = button.dataset.command;
            if (command && (command !== 'formatBlock')) { 
                try {
                    if (document.queryCommandState(command)) {
                        button.classList.add('active');
                    } else {
                        button.classList.remove('active');
                    }
                } catch (e) {
                    button.classList.remove('active');
                }
            }
        });

        const formatBlockSelect = toolbar.querySelector('select[data-command="formatBlock"]');
        if (formatBlockSelect) {
            try {
                let currentBlock = document.queryCommandValue('formatBlock').toUpperCase();
                if (currentBlock === "NORMAL" || currentBlock === "" || currentBlock === "DIV") currentBlock = "P";
                
                let foundMatch = false;
                for (let i = 0; i < formatBlockSelect.options.length; i++) {
                    if (formatBlockSelect.options[i].value.toUpperCase() === currentBlock) {
                        formatBlockSelect.value = formatBlockSelect.options[i].value;
                        foundMatch = true;
                        break;
                    }
                }
                if (!foundMatch) {
                     formatBlockSelect.value = "P"; 
                }
            } catch (e) {
                formatBlockSelect.value = "P"; 
            }
        }
    }

    function updateFontSizeSelectState() { 
        if (!fontSizeSelect || document.activeElement !== editor) return;
        try {
            const currentValue = document.queryCommandValue('fontSize');
            if (currentValue && currentValue >= '1' && currentValue <= '7') {
                fontSizeSelect.value = currentValue;
            } else {
                fontSizeSelect.value = ""; 
            }
        } catch (e) {
            fontSizeSelect.value = ""; 
        }
    }

    function updateAllToolbarStates() { 
        updateToolbarButtonStates();
        updateFontSizeSelectState();
    }

    function connectWebSocket(sessionId, userName) {
        if (ws) {
            ws.close();
        }
        clearAllRemoteCursors();
        currentSessionId = sessionId.toUpperCase(); 
        currentUserName = userName;
        updateLocalCursorName(); // Update local cursor name when connecting

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?session=${currentSessionId}&name=${encodeURIComponent(currentUserName)}&userId=${currentUserId}`;
        
        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            isConnected = true;
            updateConnectionStatus(true, currentSessionId);
            sessionModal.classList.add('hidden');
            editor.focus();
            handleLocalSelectionChange();
        };

        ws.onmessage = function(event) {
            const message = JSON.parse(event.data);
            let savedLocalSelection = null;

            if (message.type === 'content_update' && message.UserID !== currentUserId && document.activeElement === editor) {
                savedLocalSelection = saveSelection(editor);
            }
            
            applyingRemoteUpdate = true;

            switch (message.type) {
                case 'initial_content':
                    if (message.payload && typeof message.payload.content === 'string') {
                        editor.innerHTML = message.payload.content;
                        updateWordCount();
                        placeCursorAfterUpdate(true, 0); 
                        updateAllToolbarStates();
                    }
                    break;
                case 'content_update':
                     if (message.payload && typeof message.payload.content === 'string') {
                        if (message.UserID !== currentUserId) { 
                            editor.innerHTML = message.payload.content;
                            updateWordCount();
                            if (savedLocalSelection) {
                                restoreSelection(editor, savedLocalSelection);
                            } else {
                                placeCursorAfterUpdate(true); 
                            }
                            updateAllToolbarStates();
                        }
                    }
                    break;
                case 'user_list_update':
                    if (Array.isArray(message.payload)) {
                        updateUsersList(message.payload);
                    }
                    break;
                case 'self_info':
                    if (message.payload && message.payload.color) {
                        currentUserColor = message.payload.color;
                        console.log('Received self info - color:', currentUserColor); // Debug log
                        createLocalCursor(); // Create local cursor when we get our color
                        updateLocalCursor(); // Update it immediately
                    }
                    break;
                case 'remote_cursor_update':
                    if (message.payload) {
                        const data = message.payload; 
                        if (data.userId === currentUserId) return; 
                        console.log('Received remote cursor update:', data); // Debug log
                        renderRemoteCursor(data);
                    }
                    break;
                case 'user_left':
                    if (message.payload && message.payload.id) {
                        removeRemoteCursor(message.payload.id);
                    }
                    break;
                case 'error':
                    alert(`Server error: ${message.payload.error || message.payload}`);
                    break;
                default:
            }
            applyingRemoteUpdate = false;
        };

        ws.onclose = function() {
            isConnected = false;
            updateConnectionStatus(false);
            currentSessionId = null;
            clearAllRemoteCursors();
            // Hide local cursor on disconnect
            if (localCursorElement) {
                localCursorElement.style.opacity = '0';
            }
            // Clear typing timeout
            if (typingTimeout) {
                clearTimeout(typingTimeout);
                isTyping = false;
            }
        };

        ws.onerror = function(error) {
            isConnected = false;
            updateConnectionStatus(false);
            currentSessionId = null;
            clearAllRemoteCursors();
            // Hide local cursor on error
            if (localCursorElement) {
                localCursorElement.style.opacity = '0';
            }
            // Clear typing timeout
            if (typingTimeout) {
                clearTimeout(typingTimeout);
                isTyping = false;
            }
            alert('WebSocket connection error. Please check console.');
        };
    }

    function sendWebSocketMessage(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = { type, payload, sessionId: currentSessionId, userId: currentUserId, userName: currentUserName };
            ws.send(JSON.stringify(message));
        }
    }

    sessionBtn.addEventListener('click', (e) => {
        const isButtonTarget = e.target.closest('button') && e.target.closest('button').id === 'sessionBtn';
        if (currentSessionId && isButtonTarget) { 
            navigator.clipboard.writeText(currentSessionId).then(() => {
                sessionCodeDisplay.innerHTML = 'Copied!' + copyIconHTML; 
                setTimeout(() => {
                    if (currentSessionId) {
                        sessionCodeDisplay.innerHTML = currentSessionId + copyIconHTML;
                    }
                }, 2000);
            }).catch(err => {
                if (currentSessionId) {
                    sessionCodeDisplay.innerHTML = currentSessionId + copyIconHTML;
                }
            });
        } else if (!currentSessionId && isButtonTarget) { 
            sessionModal.classList.remove('hidden');
        }
    });

    closeSessionModal.addEventListener('click', () => sessionModal.classList.add('hidden'));
    usersBtn.addEventListener('click', () => usersModal.classList.remove('hidden'));
    closeUsersModal.addEventListener('click', () => usersModal.classList.add('hidden'));

    joinSessionBtn.addEventListener('click', () => {
        const name = userNameInput.value.trim() || 'Anonymous';
        const code = sessionCodeInput.value.trim();
        if (!code || code.length !== 6) { 
            alert('Session code must be 6 characters.'); return;
        }
        localStorage.setItem('doccollab_username', name);
        connectWebSocket(code, name);
    });

    newSessionBtn.addEventListener('click', () => {
        const name = userNameInput.value.trim() || 'Anonymous';
        const newCode = generateFrontendSessionCode();
        localStorage.setItem('doccollab_username', name);
        connectWebSocket(newCode, name);
    });

    copyInviteLinkBtn.addEventListener('click', () => {
        if (currentSessionId) {
            const link = `${window.location.origin}/?session=${currentSessionId}`;
            navigator.clipboard.writeText(link).then(() => {
                copyInviteLinkBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Copied!';
                setTimeout(() => { copyInviteLinkBtn.innerHTML = '<i class="fas fa-link mr-2"></i> Copy Invite Link'; }, 2000);
            });
        }
    });
    
    function handleLocalContentChange() {
        if (applyingRemoteUpdate) return;
        updateWordCount();
        
        // Clone editor content and remove cursor elements before sending
        const editorClone = editor.cloneNode(true);
        const cursors = editorClone.querySelectorAll('.remote-cursor');
        cursors.forEach(cursor => cursor.remove());
        
        sendWebSocketMessage('content_update', { content: editorClone.innerHTML });
        handleLocalSelectionChange();
        handleTypingStart(); // Mark as typing
        updateLocalCursor(); // Update local cursor position
    }

    editor.addEventListener('input', handleLocalContentChange);
    
    let selectionTimeout;
    document.addEventListener('selectionchange', () => {
        if (document.activeElement === editor) {
            clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(() => {
                if (applyingRemoteUpdate) return;
                handleLocalSelectionChange();
                updateAllToolbarStates();
                updateLocalCursor(); // Update local cursor on selection change
            }, 150); 
        }
    });

    editor.addEventListener('focus', () => {
        if (applyingRemoteUpdate) return;
        handleLocalSelectionChange();
        updateAllToolbarStates();
        updateLocalCursor(); // Show local cursor on focus
    });

    editor.addEventListener('blur', () => {
         if (isConnected && currentSessionId && currentUserColor) {
             const payload = {
                userId: currentUserId,
                userName: currentUserName,
                color: currentUserColor,
                rangeData: { charOffset: -1, isCollapsed: true } 
            };
            sendWebSocketMessage('cursor_update', payload);
         }
         // Hide local cursor on blur
         if (localCursorElement) {
             localCursorElement.style.opacity = '0';
         }
    });
    
    function getCharOffsetFromNode(rootNode, targetNode, offsetInNode) {
        let charCount = 0;
        if (!rootNode.contains(targetNode) && rootNode !== targetNode) { // If targetNode is not in rootNode (e.g. after editor cleared)
             if (targetNode === rootNode && rootNode.childNodes.length === 0) return 0; // Empty editor, offset 0
             return -1; // Cannot find offset
        }

        const treeWalker = document.createTreeWalker(
            rootNode, 
            NodeFilter.SHOW_TEXT, 
            {
                acceptNode: function(node) {
                    // Skip text nodes inside cursor elements
                    let parent = node.parentNode;
                    while (parent && parent !== rootNode) {
                        if (parent.classList && (parent.classList.contains('remote-cursor') || parent.classList.contains('local-cursor'))) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentNode;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }, 
            false
        );
        
        let currentNode;
        while (currentNode = treeWalker.nextNode()) {
            if (currentNode === targetNode) {
                charCount += offsetInNode;
                return charCount;
            }
            charCount += currentNode.textContent.length;
        }

        if(rootNode === targetNode) { // Selection is on the editor div itself
            let tempOffset = 0;
            for(let i=0; i < offsetInNode; i++){
                const childNode = rootNode.childNodes[i];
                if (!childNode) continue;
                
                // Skip cursor elements
                if (childNode.nodeType === Node.ELEMENT_NODE && 
                    childNode.classList && 
                    (childNode.classList.contains('remote-cursor') || childNode.classList.contains('local-cursor'))) {
                    continue;
                }
                
                if(childNode.nodeType === Node.TEXT_NODE){
                    tempOffset += childNode.textContent.length;
                } else if (childNode.nodeType === Node.ELEMENT_NODE){
                    // This case needs full textContent length of the element.
                    const elWalker = document.createTreeWalker(
                        childNode, 
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                // Skip text nodes inside cursor elements
                                let parent = node.parentNode;
                                while (parent && parent !== childNode) {
                                    if (parent.classList && (parent.classList.contains('remote-cursor') || parent.classList.contains('local-cursor'))) {
                                        return NodeFilter.FILTER_REJECT;
                                    }
                                    parent = parent.parentNode;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        },
                        false
                    );
                    let elNode;
                    while(elNode = elWalker.nextNode()) {tempOffset += elNode.textContent.length;}
                }
            }
             return tempOffset;
        }
        return -1; 
    }

    function handleLocalSelectionChange() {
        if (!isConnected || !currentSessionId || !currentUserColor || document.activeElement !== editor || applyingRemoteUpdate) {
            return;
        }
        
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);

        if (!editor.contains(range.startContainer)) return;

        const charOffset = getCharOffsetFromNode(editor, range.startContainer, range.startOffset);

        if (charOffset !== -1) {
            const payload = {
                userId: currentUserId,
                userName: currentUserName,
                color: currentUserColor,
                rangeData: { 
                    charOffset: charOffset, 
                    isCollapsed: range.collapsed 
                }
            };
            console.log('Sending cursor update:', payload); // Debug log
            sendWebSocketMessage('cursor_update', payload);
        }
    }
    
    function findDomPositionFromCharOffset(rootNode, targetCharOffset) {
        let accumulatedCharCount = 0;
        const treeWalker = document.createTreeWalker(
            rootNode, 
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip text nodes inside cursor elements
                    let parent = node.parentNode;
                    while (parent && parent !== rootNode) {
                        if (parent.classList && (parent.classList.contains('remote-cursor') || parent.classList.contains('local-cursor'))) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentNode;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );
        let currentNode;

        while (currentNode = treeWalker.nextNode()) {
            const nodeLength = currentNode.textContent.length;
            if (accumulatedCharCount + nodeLength >= targetCharOffset) {
                return { node: currentNode, offset: targetCharOffset - accumulatedCharCount };
            }
            accumulatedCharCount += nodeLength;
        }
        
        // Reset walker to find last text node
        const lastTextWalker = document.createTreeWalker(
            rootNode, 
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip text nodes inside cursor elements
                    let parent = node.parentNode;
                    while (parent && parent !== rootNode) {
                        if (parent.classList && (parent.classList.contains('remote-cursor') || parent.classList.contains('local-cursor'))) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentNode;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );
        
        let lastTextNode = null;
        let tempNode;
        while(tempNode = lastTextWalker.nextNode()) { lastTextNode = tempNode; }

        if (lastTextNode) {
            return { node: lastTextNode, offset: lastTextNode.textContent.length };
        }
        return { node: rootNode, offset: 0 }; 
    }

    function renderRemoteCursor(data) {
        const { userId, userName, color, rangeData } = data;
        console.log('renderRemoteCursor called with:', { userId, userName, color, rangeData }); // Debug

        if (editor.style.position !== 'relative' && editor.style.position !== 'absolute' && editor.style.position !== 'fixed') {
            editor.style.position = 'relative';
        }

        let userState = remoteUserCursors[userId];
        if (!userState) {
            console.log('Creating new cursor for user:', userId); // Debug
            userState = {
                name: userName,
                color: color || '#888888',
                cursorElement: document.createElement('div'),
                nameLabelElement: document.createElement('span')
            };
            userState.cursorElement.classList.add('remote-cursor');
            userState.nameLabelElement.classList.add('remote-cursor-name');
            userState.nameLabelElement.textContent = userName;
            userState.cursorElement.appendChild(userState.nameLabelElement);
            // Ensure cursor has proper initial styles
            userState.cursorElement.style.position = 'absolute';
            userState.cursorElement.style.width = '2px';
            userState.cursorElement.style.opacity = '0.9';
            userState.cursorElement.style.pointerEvents = 'none';
            userState.cursorElement.style.zIndex = '5';
            editor.appendChild(userState.cursorElement);
            remoteUserCursors[userId] = userState;
            console.log('Created cursor element:', userState.cursorElement); // Debug
        } 
        
        userState.cursorElement.style.backgroundColor = userState.color; 
        userState.nameLabelElement.style.backgroundColor = userState.color;
        
        // Update color if it changed
        if (color && color !== userState.color) {
            userState.color = color;
            userState.cursorElement.style.backgroundColor = color;
            userState.nameLabelElement.style.backgroundColor = color;
        }
        
        if (userState.name !== userName) {
            userState.name = userName;
            userState.nameLabelElement.textContent = userName;
        }
        
        // Special case: user left the editor (sent -1 as charOffset)
        if (rangeData && typeof rangeData.charOffset === 'number' && rangeData.charOffset === -1) {
            console.log('Hiding cursor - user left editor'); // Debug
            userState.cursorElement.style.display = 'none'; 
            return;
        }

        // Always show cursor if we have valid position data
        if (rangeData && typeof rangeData.charOffset === 'number' && rangeData.charOffset >= 0) {
            console.log('Finding position for charOffset:', rangeData.charOffset); // Debug
            const { node, offset } = findDomPositionFromCharOffset(editor, rangeData.charOffset);

            if (node) {
                console.log('Found node:', node, 'offset:', offset); // Debug
                const tempRange = document.createRange();
                try {
                    const maxOffset = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
                    const validOffset = Math.min(offset, maxOffset);

                    tempRange.setStart(node, validOffset);
                    tempRange.collapse(true); 
                    
                    const rect = tempRange.getBoundingClientRect();
                    const editorRect = editor.getBoundingClientRect();

                    const left = rect.left - editorRect.left + editor.scrollLeft;
                    const top = rect.top - editorRect.top + editor.scrollTop;
                    console.log('Positioning cursor at:', { left, top }); // Debug

                    userState.cursorElement.style.left = `${left}px`;
                    userState.cursorElement.style.top = `${top}px`;
                    let lineHeight = rect.height; 
                    if (!lineHeight || lineHeight < 5) { 
                        let parentForStyle = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
                        if(!editor.contains(parentForStyle) || !parentForStyle) parentForStyle = editor;
                        lineHeight = parseFloat(getComputedStyle(parentForStyle).lineHeight);
                        if (isNaN(lineHeight) || lineHeight === 0) { 
                            lineHeight = parseFloat(getComputedStyle(parentForStyle).fontSize) * 1.2 || 18; 
                        }
                    }
                    if (lineHeight < 10) lineHeight = 18; 

                    userState.cursorElement.style.height = `${lineHeight}px`;
                    userState.cursorElement.style.display = 'block';
                    console.log('Cursor should be visible now'); // Debug
                } catch(e) {
                    console.error('Error positioning cursor:', e);
                    userState.cursorElement.style.display = 'none'; 
                }
            } else {
                console.log('Could not find node for position'); // Debug
                userState.cursorElement.style.display = 'none'; 
            }
        } else {
            console.log('No valid rangeData'); // Debug
        }
    }

    function removeRemoteCursor(userIdToRemove) {
        if (remoteUserCursors[userIdToRemove]) {
            if (remoteUserCursors[userIdToRemove].cursorElement) {
                remoteUserCursors[userIdToRemove].cursorElement.remove();
            }
            delete remoteUserCursors[userIdToRemove];
        }
    }

    function clearAllRemoteCursors() {
        for (const userId in remoteUserCursors) {
            removeRemoteCursor(userId);
        }
    }

    function updateConnectionStatus(connected, sessionId = null) {
        const connectionStatusElement = document.getElementById('connectionStatus');
        if (!connectionStatusElement) return;
        const statusDot = connectionStatusElement.querySelector('.status-dot');
        const statusText = connectionStatusElement.querySelector('.status-text');
        if (!statusDot || !statusText) return;

        if (connected && sessionId) {
            statusDot.className = 'status-dot w-2 h-2 rounded-full bg-green-500 mr-1';
            statusText.textContent = 'Connected';
            if (sessionCodeDisplay) sessionCodeDisplay.innerHTML = sessionId + copyIconHTML;
            document.title = `Sync - ${sessionId}`;
        } else {
            statusDot.className = 'status-dot w-2 h-2 rounded-full bg-red-500 mr-1'; 
            statusText.textContent = 'Offline'; 
            if (sessionCodeDisplay) sessionCodeDisplay.innerHTML = 'Not connected' + copyIconHTML;
            document.title = `Sync - Minimal Collaborative Editor`;
        }
    }

    function updateUsersList(users) {
        usersListEl.innerHTML = ''; 
        if (!users || users.length === 0) {
             usersListEl.innerHTML = '<p class="text-sm text-[#888]">No users currently in session.</p>';
            return;
        }
        users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'flex items-center justify-between bg-[#3a3a3a] p-3 rounded';
            userElement.innerHTML = `
                <div class="flex items-center">
                    <div class="w-3 h-3 rounded-full mr-2" style="background-color: ${user.color || '#e2b714'};"></div>
                    <span>${user.name} ${user.id === currentUserId ? '(You)' : ''}</span>
                </div>
            `;
            usersListEl.appendChild(userElement);
        });
    }

    function generateFrontendSessionCode() { 
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    function updateWordCount() {
        // Clone editor and remove cursor elements to get accurate word count
        const editorClone = editor.cloneNode(true);
        const cursors = editorClone.querySelectorAll('.remote-cursor');
        cursors.forEach(cursor => cursor.remove());
        
        const text = editorClone.innerText; 
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    }

    function saveSelection(containerEl) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (containerEl.contains(range.startContainer) && containerEl.contains(range.endContainer)) {
                return {
                    start: getCharOffsetFromNode(containerEl, range.startContainer, range.startOffset),
                    end: getCharOffsetFromNode(containerEl, range.endContainer, range.endOffset),
                    collapsed: range.collapsed
                };
            }
        }
        return null;
    }

    function restoreSelection(containerEl, savedSel) {
        if (!savedSel || savedSel.start === -1) { // Do not restore if offset is invalid
            editor.focus(); // Just focus if no valid selection to restore
            placeCursorAfterUpdate(true); // Place at end as a fallback
            return;
        }
        
        const selection = window.getSelection();
        const range = document.createRange();
        
        const startPos = findDomPositionFromCharOffset(containerEl, savedSel.start);
        
        if (!startPos.node) { // Could not find a node for the start position
            editor.focus();
            placeCursorAfterUpdate(true); // Fallback
            return;
        }

        const endPos = savedSel.collapsed ? startPos : findDomPositionFromCharOffset(containerEl, savedSel.end);

        if (!endPos.node && !savedSel.collapsed) { // Could not find end node for a non-collapsed selection
             editor.focus();
             placeCursorAfterUpdate(true); // Fallback
             return;
        }


        try {
            const maxStartOffset = startPos.node.nodeType === Node.TEXT_NODE ? startPos.node.textContent.length : startPos.node.childNodes.length;
            const validStartOffset = Math.min(startPos.offset, maxStartOffset);
            range.setStart(startPos.node, validStartOffset);

            if (savedSel.collapsed) {
                range.collapse(true);
            } else {
                if (endPos.node) { // Only set end if endPos.node is valid
                    const maxEndOffset = endPos.node.nodeType === Node.TEXT_NODE ? endPos.node.textContent.length : endPos.node.childNodes.length;
                    const validEndOffset = Math.min(endPos.offset, maxEndOffset);
                    range.setEnd(endPos.node, validEndOffset);
                } else { // if endPos.node is null for a non-collapsed selection, just collapse to start
                    range.collapse(true);
                }
            }
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {
            // Fallback: place cursor at end
            try {
                range.selectNodeContents(containerEl);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (finalError) {}
        }
        editor.focus();
    }
    
    function placeCursorAfterUpdate(isServerUpdate = false, charOffsetToRestore = null) {
        if (applyingRemoteUpdate && !isServerUpdate) return; // Don't interfere if a remote update is actively being applied

        if (document.activeElement !== editor && isServerUpdate) {
             editor.focus();
        } else if (!isServerUpdate && document.activeElement !== editor) {
             return; 
        }

        if (isServerUpdate && typeof charOffsetToRestore === 'number' && charOffsetToRestore !== -1) {
            restoreSelection(editor, {start: charOffsetToRestore, end: charOffsetToRestore, collapsed: true });
            return;
        }
        
        const selection = window.getSelection();
        if (!isServerUpdate && selection.rangeCount > 0 ) {
            if (!selection.isCollapsed) return; // User is selecting, don't move
            if (editor.contains(selection.anchorNode)) return; // Caret already in editor, don't move to end
        }

        const range = document.createRange();
        let lastMeaningfulNode = editor.lastChild;
        while(lastMeaningfulNode && (lastMeaningfulNode.nodeType !== Node.ELEMENT_NODE && lastMeaningfulNode.nodeType !== Node.TEXT_NODE || (lastMeaningfulNode.classList && (lastMeaningfulNode.classList.contains('remote-cursor') || lastMeaningfulNode.classList.contains('local-cursor'))))) {
            lastMeaningfulNode = lastMeaningfulNode.previousSibling;
        }

        if (lastMeaningfulNode) {
            if (lastMeaningfulNode.nodeType === Node.ELEMENT_NODE) {
                 range.selectNodeContents(lastMeaningfulNode);
                 range.collapse(false); 
            } else if (lastMeaningfulNode.nodeType === Node.TEXT_NODE) {
                 range.setStart(lastMeaningfulNode, lastMeaningfulNode.length);
                 range.collapse(true);
            } else { 
                range.selectNodeContents(editor);
                range.collapse(false);
            }
        } else { 
            range.selectNodeContents(editor);
            range.collapse(true);
        }
        
        try {
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {}
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');

    if (sessionParam) {
        sessionCodeInput.value = sessionParam.toUpperCase();
        sessionModal.classList.remove('hidden'); 
    } else {
        setTimeout(() => {
             if (!currentSessionId) sessionModal.classList.remove('hidden');
        }, 500);
    }
    updateWordCount();
    updateConnectionStatus(false);

    const downloadTxtBtn = document.createElement('button');
    downloadTxtBtn.innerHTML = '<i class="fas fa-file-alt mr-1"></i> TXT';
    downloadTxtBtn.className = 'btn-secondary px-3 py-1 rounded text-sm';
    downloadTxtBtn.onclick = () => {
        if (currentSessionId) window.location.href = `/download?session=${currentSessionId}&format=txt`;
        else alert('Not connected to a session to download.');
    };
    
    const downloadHtmlBtn = document.createElement('button');
    downloadHtmlBtn.innerHTML = '<i class="fas fa-file-code mr-1"></i> HTML';
    downloadHtmlBtn.className = 'btn-secondary px-3 py-1 rounded text-sm';
    downloadHtmlBtn.onclick = () => {
        if (currentSessionId) window.location.href = `/download?session=${currentSessionId}&format=html`;
        else alert('Not connected to a session to download.');
    };

    const downloadDocxBtn = document.createElement('button');
    downloadDocxBtn.innerHTML = '<i class="fas fa-file-word mr-1"></i> DOCX';
    downloadDocxBtn.className = 'btn-secondary px-3 py-1 rounded text-sm';
    downloadDocxBtn.onclick = () => {
        if (currentSessionId) window.location.href = `/download?session=${currentSessionId}&format=docx`;
        else alert('Not connected to a session to download.');
    };

    const downloadPdfBtn = document.createElement('button');
    downloadPdfBtn.innerHTML = '<i class="fas fa-file-pdf mr-1"></i> PDF';
    downloadPdfBtn.className = 'btn-secondary px-3 py-1 rounded text-sm';
    downloadPdfBtn.onclick = () => {
        if (currentSessionId) window.location.href = `/download?session=${currentSessionId}&format=pdf`;
        else alert('Not connected to a session to download.');
    };

    const sessionInfoDiv = document.querySelector('.session-info');
    if (sessionInfoDiv && usersBtn) {
        let downloadButtonsFlexContainer = sessionInfoDiv.querySelector('.download-buttons-flex-container');
        if (!downloadButtonsFlexContainer) {
            downloadButtonsFlexContainer = document.createElement('div');
            downloadButtonsFlexContainer.className = 'download-buttons-flex-container flex items-center space-x-2'; 
            sessionInfoDiv.insertBefore(downloadButtonsFlexContainer, usersBtn);
        }
        downloadButtonsFlexContainer.appendChild(downloadTxtBtn);
        downloadButtonsFlexContainer.appendChild(downloadHtmlBtn);
        downloadButtonsFlexContainer.appendChild(downloadDocxBtn);
        downloadButtonsFlexContainer.appendChild(downloadPdfBtn);
    }
});