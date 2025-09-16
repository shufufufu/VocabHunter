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
    
    return `
      <div class="word-item" data-word="${word}">
        <div class="word-info">
          <div class="word-text">${word}</div>
          <div class="word-meta">
            ${savedDate} • 来自 ${domain}<br>
            复习 ${data.reviewCount} 次
            ${data.lastReview ? `• 最后复习 ${new Date(data.lastReview).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div class="word-actions">
          <button class="action-btn review-btn" data-word="${word}" data-action="review" title="标记为已复习">
            ✓
          </button>
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
  
  // 导出词汇
  elements.exportBtn.addEventListener('click', async () => {
    try {
      elements.exportBtn.textContent = '导出中...';
      elements.exportBtn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({ action: 'exportWords' });
      
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
      
      showSuccess('导出成功！');
    } catch (error) {
      console.error('Error exporting words:', error);
      showError('导出失败');
    } finally {
      elements.exportBtn.textContent = '导出词汇';
      elements.exportBtn.disabled = false;
    }
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
