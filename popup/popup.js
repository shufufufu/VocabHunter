// popup/popup.js
console.log('VocabHunter popup loaded');

let vocabList = {};
let filteredWords = [];
let isHighlightEnabled = true;

// DOM元素
const elements = {
  wordCount: document.getElementById('wordCount'),
  toggleHighlight: document.getElementById('toggleHighlight'),
  highlightText: document.getElementById('highlightText'),
  exportBtn: document.getElementById('exportBtn'),
  exportMenu: document.getElementById('exportMenu'),
  batchTranslateBtn: document.getElementById('batchTranslateBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  wordList: document.getElementById('wordList'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('emptyState')
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadVocabList();
  setupEventListeners();
});

// 加载词汇列表
async function loadVocabList() {
  try {
    elements.loading.style.display = 'block';
    elements.emptyState.style.display = 'none';
    
    const response = await chrome.runtime.sendMessage({ action: 'getVocabList' });
    vocabList = response.vocabList || {};
    
    updateUI();
  } catch (error) {
    console.error('Error loading vocab list:', error);
    showError('加载词汇列表失败');
  } finally {
    elements.loading.style.display = 'none';
  }
}

// 更新UI
function updateUI() {
  const words = Object.keys(vocabList);
  elements.wordCount.textContent = words.length;
  
  // 应用搜索过滤
  const searchTerm = elements.searchInput.value.toLowerCase().trim();
  filteredWords = words.filter(word => 
    word.toLowerCase().includes(searchTerm)
  );
  
  if (filteredWords.length === 0) {
    if (words.length === 0) {
      elements.emptyState.style.display = 'block';
      elements.wordList.innerHTML = '';
    } else {
      elements.wordList.innerHTML = '<div class="loading">没有找到匹配的单词</div>';
      elements.emptyState.style.display = 'none';
    }
    return;
  }
  
  elements.emptyState.style.display = 'none';
  renderWordList();
}

// 渲染单词列表
function renderWordList() {
  const sortedWords = filteredWords.sort((a, b) => {
    const aData = vocabList[a];
    const bData = vocabList[b];
    return new Date(bData.savedAt) - new Date(aData.savedAt);
  });
  
  const html = sortedWords.map(word => {
    const data = vocabList[word];
    const savedDate = new Date(data.savedAt).toLocaleDateString();
    const domain = extractDomain(data.fromUrl);
    
    // 处理翻译显示
    const translationHtml = data.translation 
      ? `<div class="word-translation">${data.translation}</div>`
      : '<div class="word-translation no-translation">暂无翻译</div>';
    
    return `
      <div class="word-item" data-word="${word}">
        <div class="word-info">
          <div class="word-text">${word}</div>
          ${translationHtml}
          <div class="word-meta">
            ${savedDate} • 来自 ${domain}<br>
            复习 ${data.reviewCount} 次
            ${data.lastReview ? `• 最后复习 ${new Date(data.lastReview).toLocaleDateString()}` : ''}
            ${data.translatedAt ? `<br>翻译时间: ${new Date(data.translatedAt).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div class="word-actions">
          <button class="action-btn review-btn" data-word="${word}" data-action="review" title="标记为已复习">
            ✓
          </button>
          ${!data.translation ? 
            `<button class="action-btn translate-btn" data-word="${word}" data-action="translate" title="获取翻译">
              🔄
            </button>` : 
            `<button class="action-btn retranslate-btn" data-word="${word}" data-action="retranslate" title="重新翻译">
              🔄
            </button>`
          }
          <button class="action-btn delete-btn" data-word="${word}" data-action="delete" title="删除单词">
            ×
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  elements.wordList.innerHTML = html;
}

// 设置事件监听器
function setupEventListeners() {
  // 切换高亮
  elements.toggleHighlight.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tabs[0].id, { 
        action: 'toggleHighlight' 
      });
      
      isHighlightEnabled = response.enabled;
      elements.highlightText.textContent = isHighlightEnabled ? '关闭高亮' : '开启高亮';
    } catch (error) {
      console.error('Error toggling highlight:', error);
    }
  });
  
  // 导出词汇 - 切换菜单显示
  elements.exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = elements.exportMenu.style.display === 'block';
    elements.exportMenu.style.display = isVisible ? 'none' : 'block';
  });
  
  // 点击其他地方关闭导出菜单
  document.addEventListener('click', () => {
    elements.exportMenu.style.display = 'none';
  });
  
  // 导出选项点击事件
  elements.exportMenu.addEventListener('click', async (e) => {
    if (e.target.classList.contains('export-option')) {
      const format = e.target.getAttribute('data-format');
      elements.exportMenu.style.display = 'none';
      await exportWords(format);
    }
  });
  
  // 批量翻译
  elements.batchTranslateBtn.addEventListener('click', async () => {
    await batchTranslateWords();
  });
  
  // 刷新
  elements.refreshBtn.addEventListener('click', async () => {
    await loadVocabList();
    
    // 刷新当前页面的高亮
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshHighlights' });
    } catch (error) {
      console.error('Error refreshing highlights:', error);
    }
  });
  
  // 搜索
  elements.searchInput.addEventListener('input', () => {
    updateUI();
  });
  
  // 清除搜索
  elements.clearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    updateUI();
  });
  
  // 搜索框快捷键
  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      elements.searchInput.value = '';
      updateUI();
    }
  });
  
  // 事件委托处理单词操作按钮
  elements.wordList.addEventListener('click', (e) => {
    if (e.target.classList.contains('action-btn')) {
      const word = e.target.getAttribute('data-word');
      const action = e.target.getAttribute('data-action');
      
      if (word && action) {
        if (action === 'review') {
          reviewWord(word);
        } else if (action === 'delete') {
          deleteWord(word);
        } else if (action === 'translate') {
          translateWord(word);
        } else if (action === 'retranslate') {
          retranslateWord(word);
        }
      }
    }
  });
}

// 复习单词
async function reviewWord(word) {
  try {
    console.log('Reviewing word:', word);
    
    // 从存储中获取最新数据
    const result = await chrome.storage.local.get(['vocabList']);
    const currentVocabList = result.vocabList || {};
    
    if (currentVocabList[word]) {
      currentVocabList[word].reviewCount = (currentVocabList[word].reviewCount || 0) + 1;
      currentVocabList[word].lastReview = new Date().toISOString();
      
      // 保存到存储
      await chrome.storage.local.set({ vocabList: currentVocabList });
      
      // 更新本地副本
      vocabList = currentVocabList;
      
      updateUI();
      showSuccess(`单词 "${word}" 已标记为复习！`);
      
      console.log('Word reviewed successfully:', word, currentVocabList[word]);
    } else {
      console.error('Word not found in vocab list:', word);
      showError('单词未找到');
    }
  } catch (error) {
    console.error('Error reviewing word:', error);
    showError('操作失败');
  }
}

// 删除单词
async function deleteWord(word) {
  try {
    console.log('Deleting word:', word);
    
    // 直接操作存储，不通过background
    const result = await chrome.storage.local.get(['vocabList']);
    const currentVocabList = result.vocabList || {};
    
    if (currentVocabList[word]) {
      delete currentVocabList[word];
      
      // 保存到存储
      await chrome.storage.local.set({ vocabList: currentVocabList });
      
      // 更新本地副本
      vocabList = currentVocabList;
      
      updateUI();
      showSuccess(`单词 "${word}" 已删除！`);
      
      console.log('Word deleted successfully:', word);
      
      // 通知所有标签页刷新高亮
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'refreshHighlights' });
          } catch (error) {
            // 忽略无法发送消息的标签页（如chrome://页面）
            console.log('Could not send message to tab:', tab.id);
          }
        }
      } catch (error) {
        console.error('Error refreshing highlights:', error);
      }
    } else {
      console.error('Word not found in vocab list:', word);
      showError('单词未找到');
    }
  } catch (error) {
    console.error('Error deleting word:', error);
    showError('删除失败');
  }
}

// 翻译单词
async function translateWord(word) {
  try {
    console.log('Translating word:', word);
    
    // 找到对应的按钮并显示加载状态
    const button = document.querySelector(`[data-word="${word}"][data-action="translate"]`);
    if (button) {
      button.textContent = '...';
      button.disabled = true;
    }
    
    const response = await chrome.runtime.sendMessage({
      action: 'translateWord',
      word: word
    });
    
    if (response.success && response.translation) {
      // 更新本地数据
      if (vocabList[word]) {
        vocabList[word].translation = response.translation;
        vocabList[word].translatedAt = new Date().toISOString();
      }
      
      updateUI();
      showSuccess(`单词 "${word}" 翻译成功！`);
    } else {
      showError('翻译失败，请检查翻译服务');
    }
  } catch (error) {
    console.error('Error translating word:', error);
    showError('翻译失败');
  }
}

// 重新翻译单词
async function retranslateWord(word) {
  try {
    console.log('Retranslating word:', word);
    
    // 找到对应的按钮并显示加载状态
    const button = document.querySelector(`[data-word="${word}"][data-action="retranslate"]`);
    if (button) {
      button.textContent = '...';
      button.disabled = true;
    }
    
    const response = await chrome.runtime.sendMessage({
      action: 'retranslateWord',
      word: word
    });
    
    if (response.success && response.translation) {
      // 更新本地数据
      if (vocabList[word]) {
        vocabList[word].translation = response.translation;
        vocabList[word].translatedAt = new Date().toISOString();
      }
      
      updateUI();
      showSuccess(`单词 "${word}" 重新翻译成功！`);
    } else {
      showError('重新翻译失败，请检查翻译服务');
    }
  } catch (error) {
    console.error('Error retranslating word:', error);
    showError('重新翻译失败');
  }
}

// 导出词汇函数
async function exportWords(format) {
  try {
    console.log('Exporting words with format:', format);
    
    const formatNames = {
      'words-only': '仅单词',
      'with-translation': '单词+翻译',
      'detailed': '详细信息'
    };
    
    // 显示导出状态
    const originalText = elements.exportBtn.textContent;
    elements.exportBtn.textContent = `导出${formatNames[format]}中...`;
    elements.exportBtn.disabled = true;
    
    const response = await chrome.runtime.sendMessage({ 
      action: 'exportWords',
      format: format 
    });
    
    if (response.error) {
      showError('导出失败');
      return;
    }
    
    // 下载文件
    const blob = new Blob([response.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showSuccess(`${formatNames[format]}导出成功！`);
  } catch (error) {
    console.error('Error exporting words:', error);
    showError('导出失败');
  } finally {
    elements.exportBtn.textContent = '导出词汇 ▼';
    elements.exportBtn.disabled = false;
  }
}

// 批量翻译所有没有翻译的单词
async function batchTranslateWords() {
  try {
    console.log('Starting batch translation...');
    
    // 显示加载状态
    const originalText = elements.batchTranslateBtn.textContent;
    elements.batchTranslateBtn.textContent = '批量翻译中...';
    elements.batchTranslateBtn.disabled = true;
    
    // 统计需要翻译的单词数量
    const wordsWithoutTranslation = Object.keys(vocabList).filter(word => 
      !vocabList[word].translation || vocabList[word].translation === ''
    );
    
    if (wordsWithoutTranslation.length === 0) {
      showSuccess('所有单词都已有翻译！');
      return;
    }
    
    elements.batchTranslateBtn.textContent = `翻译中... (0/${wordsWithoutTranslation.length})`;
    
    const response = await chrome.runtime.sendMessage({
      action: 'batchTranslate'
    });
    
    if (response.success) {
      // 重新加载词汇列表以显示新的翻译
      await loadVocabList();
      
      if (response.count > 0) {
        showSuccess(`批量翻译完成！成功翻译 ${response.count} 个单词`);
      } else {
        showSuccess(response.message);
      }
      
      // 通知所有标签页刷新高亮（如果有新翻译的话）
      if (response.count > 0) {
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            try {
              await chrome.tabs.sendMessage(tab.id, { action: 'refreshHighlights' });
            } catch (error) {
              // 忽略无法发送消息的标签页
            }
          }
        } catch (error) {
          console.error('Error refreshing highlights after batch translation:', error);
        }
      }
    } else {
      showError(`批量翻译失败：${response.error}`);
    }
  } catch (error) {
    console.error('Error in batch translation:', error);
    showError('批量翻译失败');
  } finally {
    elements.batchTranslateBtn.textContent = '批量翻译';
    elements.batchTranslateBtn.disabled = false;
  }
}

// 工具函数
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '未知来源';
  }
}

function showSuccess(message) {
  // 简单的成功提示
  const originalText = elements.wordCount.textContent;
  elements.wordCount.textContent = '✓';
  elements.wordCount.parentElement.style.background = '#4CAF50';
  
  setTimeout(() => {
    elements.wordCount.textContent = originalText;
    elements.wordCount.parentElement.style.background = '#4CAF50';
  }, 1500);
}

function showError(message) {
  // 简单的错误提示
  const originalText = elements.wordCount.textContent;
  elements.wordCount.textContent = '✗';
  elements.wordCount.parentElement.style.background = '#f44336';
  
  setTimeout(() => {
    elements.wordCount.textContent = originalText;
    elements.wordCount.parentElement.style.background = '#4CAF50';
  }, 1500);
}
