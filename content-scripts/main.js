// content-scripts/main.js
console.log('VocabHunter content script loaded');

let vocabList = {};
let isHighlightEnabled = true;

// 初始化：获取已保存的单词列表
async function initVocabHighlight() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getVocabList' });
    vocabList = response.vocabList || {};
    if (isHighlightEnabled) {
      highlightSavedWords();
    }
  } catch (error) {
    console.error('Error loading vocab list:', error);
  }
}

// 高亮已保存的单词
function highlightSavedWords() {
  if (Object.keys(vocabList).length === 0) return;
  
  // 创建正则表达式匹配所有已保存的单词
  const words = Object.keys(vocabList);
  const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
  
  // 获取所有文本节点
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // 跳过script、style等标签
        const parent = node.parentElement;
        if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        // 跳过已经高亮的节点
        if (parent && parent.classList.contains('vocab-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  // 处理每个文本节点
  textNodes.forEach(textNode => {
    const text = textNode.textContent;
    if (pattern.test(text)) {
      const parent = textNode.parentElement;
      const highlightedHTML = text.replace(pattern, '<span class="vocab-highlight" title="已保存的单词">$1</span>');
      
      // 创建临时容器来解析HTML
      const temp = document.createElement('div');
      temp.innerHTML = highlightedHTML;
      
      // 替换原文本节点
      const fragment = document.createDocumentFragment();
      while (temp.firstChild) {
        fragment.appendChild(temp.firstChild);
      }
      parent.replaceChild(fragment, textNode);
    }
  });
}

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'wordSaved') {
    // 更新词汇列表并重新高亮
    vocabList[request.word] = true;
    if (isHighlightEnabled) {
      // 延迟一下再高亮，确保DOM更新完成
      setTimeout(highlightSavedWords, 100);
    }
    sendResponse({ success: true });
  }
  
  if (request.action === 'toggleHighlight') {
    isHighlightEnabled = !isHighlightEnabled;
    if (isHighlightEnabled) {
      highlightSavedWords();
    } else {
      removeHighlights();
    }
    sendResponse({ enabled: isHighlightEnabled });
  }
  
  if (request.action === 'refreshHighlights') {
    // 先移除所有现有高亮，然后重新初始化
    removeHighlights();
    initVocabHighlight();
    sendResponse({ success: true });
  }
});

// 移除所有高亮
function removeHighlights() {
  const highlights = document.querySelectorAll('.vocab-highlight');
  highlights.forEach(highlight => {
    const parent = highlight.parentNode;
    parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    parent.normalize(); // 合并相邻的文本节点
  });
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVocabHighlight);
} else {
  initVocabHighlight();
}

// 监听动态内容变化（适用于SPA应用）
const observer = new MutationObserver((mutations) => {
  let shouldUpdate = false;
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // 检查是否有新的文本内容
      for (let node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE || 
            (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim())) {
          shouldUpdate = true;
          break;
        }
      }
    }
  });
  
  if (shouldUpdate && isHighlightEnabled) {
    // 防抖：延迟执行高亮
    clearTimeout(observer.timeoutId);
    observer.timeoutId = setTimeout(highlightSavedWords, 500);
  }
});

// 开始观察DOM变化
observer.observe(document.body, {
  childList: true,
  subtree: true
});