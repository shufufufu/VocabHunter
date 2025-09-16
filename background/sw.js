// background/sw.js
console.log('VocabHunter service worker loaded');

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'saveWord',
    title: '保存单词到词汇本',
    contexts: ['selection']
  });
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'saveWord' && info.selectionText) {
    const word = info.selectionText.trim().toLowerCase();
    
    // 只保存单个英文单词（简单验证）
    if (word && /^[a-zA-Z]+$/.test(word)) {
      await saveWord(word, tab.url);
      
      // 通知content script更新高亮
      chrome.tabs.sendMessage(tab.id, {
        action: 'wordSaved',
        word: word
      });
      
      // 显示通知
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'VocabHunter',
        message: `单词 "${word}" 已保存到词汇本`
      });
    }
  }
});

// 保存单词到存储
async function saveWord(word, url) {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    if (!vocabList[word]) {
      vocabList[word] = {
        word: word,
        savedAt: new Date().toISOString(),
        fromUrl: url,
        reviewCount: 0,
        lastReview: null
      };
      
      await chrome.storage.local.set({ vocabList });
      console.log('Word saved:', word);
    } else {
      console.log('Word already exists:', word);
    }
  } catch (error) {
    console.error('Error saving word:', error);
  }
}

// 处理来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVocabList') {
    chrome.storage.local.get(['vocabList']).then(result => {
      sendResponse({ vocabList: result.vocabList || {} });
    });
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'deleteWord') {
    deleteWord(request.word).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'exportWords') {
    exportWordsToTxt().then(result => {
      sendResponse(result);
    });
    return true;
  }
});

// 删除单词
async function deleteWord(word) {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    if (vocabList[word]) {
      delete vocabList[word];
      await chrome.storage.local.set({ vocabList });
      console.log('Word deleted:', word);
    }
  } catch (error) {
    console.error('Error deleting word:', error);
  }
}

// 导出单词到文本格式
async function exportWordsToTxt() {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    let txtContent = '# VocabHunter 词汇本\n\n';
    txtContent += `导出时间: ${new Date().toLocaleString()}\n`;
    txtContent += `总单词数: ${Object.keys(vocabList).length}\n\n`;
    txtContent += '---\n\n';
    
    for (const [word, data] of Object.entries(vocabList)) {
      txtContent += `单词: ${word}\n`;
      txtContent += `保存时间: ${new Date(data.savedAt).toLocaleString()}\n`;
      txtContent += `来源网页: ${data.fromUrl}\n`;
      txtContent += `复习次数: ${data.reviewCount}\n`;
      if (data.lastReview) {
        txtContent += `最后复习: ${new Date(data.lastReview).toLocaleString()}\n`;
      }
      txtContent += '\n';
    }
    
    return { content: txtContent, filename: `vocab_${Date.now()}.txt` };
  } catch (error) {
    console.error('Error exporting words:', error);
    return { error: 'Export failed' };
  }
}
