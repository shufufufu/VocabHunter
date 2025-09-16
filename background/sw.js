// background/sw.js
console.log('VocabHunter service worker loaded');

// 翻译服务配置
const TRANSLATION_CONFIG = {
  apiUrl: 'http://localhost:3001/api/translate',
  enabled: true, // 可以通过设置页面控制
  timeout: 10000
};

// 调用翻译API（带缓存检查）
async function translateWord(word) {
  if (!TRANSLATION_CONFIG.enabled) {
    console.log('Translation disabled');
    return null;
  }

  // 首先检查是否已经有翻译缓存
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    if (vocabList[word] && vocabList[word].translation && vocabList[word].translation !== '') {
      console.log('Using cached translation for:', word, '->', vocabList[word].translation);
      return vocabList[word].translation;
    }
  } catch (error) {
    console.error('Error checking translation cache:', error);
  }

  // 没有缓存，调用API翻译
  try {
    console.log('Calling translation API for:', word);
    
    const response = await fetch(TRANSLATION_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        word: word,
        from: 'en',
        to: 'zh'
      }),
      signal: AbortSignal.timeout(TRANSLATION_CONFIG.timeout)
    });

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.data && data.data.translation) {
      console.log('Translation API successful:', word, '->', data.data.translation);
      return data.data.translation;
    } else {
      console.error('Translation API failed:', data.error);
      return null;
    }
  } catch (error) {
    console.error('Translation API error:', error);
    return null;
  }
}

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
      const wordData = await saveWord(word, tab.url);
      
      // 通知content script更新高亮，传递完整的单词数据
      chrome.tabs.sendMessage(tab.id, {
        action: 'wordSaved',
        word: word,
        wordData: wordData
      });
      
      // 显示通知
      const notificationMessage = wordData && wordData.translation 
        ? `单词 "${word}" (${wordData.translation}) 已保存到词汇本`
        : `单词 "${word}" 已保存到词汇本`;
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'VocabHunter',
        message: notificationMessage
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
      // 尝试获取翻译
      const translation = await translateWord(word);
      
      vocabList[word] = {
        word: word,
        translation: translation || '', // 保存翻译结果，如果失败则为空字符串
        savedAt: new Date().toISOString(),
        fromUrl: url,
        reviewCount: 0,
        lastReview: null,
        translatedAt: translation ? new Date().toISOString() : null
      };
      
      await chrome.storage.local.set({ vocabList });
      console.log('Word saved:', word, translation ? `with translation: ${translation}` : 'without translation');
      
      // 返回保存的单词数据
      return vocabList[word];
    } else {
      console.log('Word already exists:', word);
      
      // 如果单词已存在但没有翻译，尝试添加翻译
      if ((!vocabList[word].translation || vocabList[word].translation === '') && TRANSLATION_CONFIG.enabled) {
        console.log('Word exists but has no translation, attempting to translate:', word);
        const translation = await translateWord(word);
        if (translation) {
          vocabList[word].translation = translation;
          vocabList[word].translatedAt = new Date().toISOString();
          await chrome.storage.local.set({ vocabList });
          console.log('Added translation to existing word:', word, '->', translation);
        }
      } else if (vocabList[word].translation) {
        console.log('Word already has translation:', word, '->', vocabList[word].translation);
      }
      
      // 返回现有的单词数据
      return vocabList[word];
    }
  } catch (error) {
    console.error('Error saving word:', error);
    return null;
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
    exportWordsToTxt(request.format || 'words-only').then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'translateWord') {
    translateWord(request.word).then(translation => {
      sendResponse({ success: true, translation: translation });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'retranslateWord') {
    // 重新翻译并更新存储中的单词
    retranslateAndUpdate(request.word).then(result => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'batchTranslate') {
    // 批量翻译所有没有翻译的单词
    batchTranslateWords().then(result => {
      sendResponse(result);
    });
    return true;
  }
});

// 重新翻译并更新单词
async function retranslateAndUpdate(word) {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    if (vocabList[word]) {
      const translation = await translateWord(word);
      if (translation) {
        vocabList[word].translation = translation;
        vocabList[word].translatedAt = new Date().toISOString();
        await chrome.storage.local.set({ vocabList });
        console.log('Word retranslated:', word, '->', translation);
        return { success: true, translation: translation };
      } else {
        return { success: false, error: 'Translation failed' };
      }
    } else {
      return { success: false, error: 'Word not found' };
    }
  } catch (error) {
    console.error('Error retranslating word:', error);
    return { success: false, error: error.message };
  }
}

// 批量翻译所有没有翻译的单词
async function batchTranslateWords() {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    // 找出所有没有翻译的单词
    const wordsToTranslate = Object.keys(vocabList).filter(word => 
      !vocabList[word].translation || vocabList[word].translation === ''
    );
    
    if (wordsToTranslate.length === 0) {
      return { success: true, message: '所有单词都已有翻译', count: 0 };
    }
    
    console.log(`Found ${wordsToTranslate.length} words without translation, starting batch translation...`);
    
    let successCount = 0;
    let failCount = 0;
    
    // 逐个翻译（避免API限制）
    for (const word of wordsToTranslate) {
      try {
        // 调用API翻译（不使用缓存，因为我们知道没有翻译）
        const response = await fetch(TRANSLATION_CONFIG.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            word: word,
            from: 'en',
            to: 'zh'
          }),
          signal: AbortSignal.timeout(TRANSLATION_CONFIG.timeout)
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && data.data.translation) {
            vocabList[word].translation = data.data.translation;
            vocabList[word].translatedAt = new Date().toISOString();
            successCount++;
            console.log(`Batch translated: ${word} -> ${data.data.translation}`);
          } else {
            failCount++;
            console.error(`Batch translation failed for ${word}:`, data.error);
          }
        } else {
          failCount++;
          console.error(`API request failed for ${word}:`, response.status);
        }
        
        // 添加延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        failCount++;
        console.error(`Error translating ${word}:`, error);
      }
    }
    
    // 保存更新的词汇列表
    if (successCount > 0) {
      await chrome.storage.local.set({ vocabList });
    }
    
    const message = `批量翻译完成：成功 ${successCount} 个，失败 ${failCount} 个`;
    console.log(message);
    
    return {
      success: true,
      message: message,
      count: successCount,
      total: wordsToTranslate.length,
      failed: failCount
    };
    
  } catch (error) {
    console.error('Batch translation error:', error);
    return { success: false, error: error.message };
  }
}

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
async function exportWordsToTxt(format = 'words-only') {
  try {
    const result = await chrome.storage.local.get(['vocabList']);
    const vocabList = result.vocabList || {};
    
    const words = Object.keys(vocabList).sort();
    let txtContent = '';
    let filename = '';
    
    switch (format) {
      case 'words-only':
        // 只输出单词，每行一个
        txtContent = words.join('\n');
        filename = `vocab_words_${Date.now()}.txt`;
        break;
        
      case 'with-translation':
        // 输出单词和翻译，格式：word - translation
        txtContent = words.map(word => {
          const data = vocabList[word];
          const translation = data.translation || '暂无翻译';
          return `${word} - ${translation}`;
        }).join('\n');
        filename = `vocab_with_translation_${Date.now()}.txt`;
        break;
        
      case 'detailed':
        // 详细信息导出
        txtContent = '# VocabHunter 词汇本详细导出\n\n';
        txtContent += `导出时间: ${new Date().toLocaleString()}\n`;
        txtContent += `总单词数: ${words.length}\n\n`;
        txtContent += '---\n\n';
        
        words.forEach(word => {
          const data = vocabList[word];
          txtContent += `单词: ${word}\n`;
          if (data.translation) {
            txtContent += `翻译: ${data.translation}\n`;
          }
          txtContent += `保存时间: ${new Date(data.savedAt).toLocaleString()}\n`;
          txtContent += `来源网页: ${data.fromUrl}\n`;
          txtContent += `复习次数: ${data.reviewCount}\n`;
          if (data.lastReview) {
            txtContent += `最后复习: ${new Date(data.lastReview).toLocaleString()}\n`;
          }
          if (data.translatedAt) {
            txtContent += `翻译时间: ${new Date(data.translatedAt).toLocaleString()}\n`;
          }
          txtContent += '\n';
        });
        
        filename = `vocab_detailed_${Date.now()}.txt`;
        break;
        
      default:
        txtContent = words.join('\n');
        filename = `vocab_${Date.now()}.txt`;
    }
    
    return { content: txtContent, filename: filename };
  } catch (error) {
    console.error('Error exporting words:', error);
    return { error: 'Export failed' };
  }
}
