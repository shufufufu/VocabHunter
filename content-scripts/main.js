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
      
      // 使用更复杂的替换逻辑来添加翻译信息
      const highlightedHTML = text.replace(pattern, (match, word) => {
        const wordData = vocabList[word.toLowerCase()];
        const translation = wordData && wordData.translation ? wordData.translation : '暂无翻译';
        return `<span class="vocab-highlight" data-word="${word.toLowerCase()}" data-translation="${translation}">${word}</span>`;
      });
      
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
    // 更新词汇列表，包含完整的单词数据
    if (request.wordData) {
      vocabList[request.word] = request.wordData;
      console.log('Word data updated:', request.word, request.wordData);
    } else {
      vocabList[request.word] = true; // 兜底处理
    }
    
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

// 气泡提示相关功能
let currentTooltip = null;

// 创建气泡提示
function createTooltip(word, translation) {
  // 移除现有的气泡
  removeTooltip();
  
  const tooltip = document.createElement('div');
  tooltip.className = 'vocab-tooltip';
  tooltip.innerHTML = `
    <div class="vocab-tooltip-translation">${translation}</div>
  `;
  
  document.body.appendChild(tooltip);
  currentTooltip = tooltip;
  
  return tooltip;
}

// 移除气泡提示
function removeTooltip() {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// 定位气泡提示
function positionTooltip(tooltip, targetElement) {
  const rect = targetElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  // 计算位置
  let top = rect.top - tooltipRect.height - 12; // 在单词上方12px（包含箭头空间）
  let left = rect.left + (rect.width - tooltipRect.width) / 2; // 居中对齐
  let isBelow = false;
  
  // 边界检查
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 水平边界检查
  if (left < 8) {
    left = 8;
  } else if (left + tooltipRect.width > viewportWidth - 8) {
    left = viewportWidth - tooltipRect.width - 8;
  }
  
  // 垂直边界检查 - 如果上方空间不够，显示在下方
  if (top < 8) {
    top = rect.bottom + 12; // 在单词下方12px（包含箭头空间）
    isBelow = true;
  }
  
  // 添加相应的CSS类
  if (isBelow) {
    tooltip.classList.add('below');
  } else {
    tooltip.classList.remove('below');
  }
  
  tooltip.style.left = left + window.scrollX + 'px';
  tooltip.style.top = top + window.scrollY + 'px';
}

// 设置高亮单词的事件监听器
function setupHighlightEvents() {
  let showTimeout = null;
  let hideTimeout = null;
  
  // 使用事件委托处理鼠标事件
  document.addEventListener('mouseenter', (e) => {
    if (e.target.classList.contains('vocab-highlight')) {
      // 清除之前的隐藏定时器
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      
      const word = e.target.getAttribute('data-word');
      const translation = e.target.getAttribute('data-translation');
      
      if (translation && translation !== '暂无翻译') {
        // 稍微延迟显示，避免鼠标快速滑过时频繁显示
        showTimeout = setTimeout(() => {
          const tooltip = createTooltip(word, translation);
          // 延迟定位，确保DOM更新完成
          setTimeout(() => positionTooltip(tooltip, e.target), 0);
        }, 300);
      }
    }
  }, true);
  
  document.addEventListener('mouseleave', (e) => {
    if (e.target.classList.contains('vocab-highlight')) {
      // 清除显示定时器
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      
      // 延迟移除，给用户时间移动到气泡上
      hideTimeout = setTimeout(() => {
        removeTooltip();
      }, 200);
    }
  }, true);
  
  // 鼠标移入气泡时保持显示
  document.addEventListener('mouseenter', (e) => {
    if (e.target.closest('.vocab-tooltip')) {
      // 清除隐藏定时器
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    }
  }, true);
  
  // 鼠标离开气泡时移除
  document.addEventListener('mouseleave', (e) => {
    if (e.target.closest('.vocab-tooltip')) {
      hideTimeout = setTimeout(() => {
        removeTooltip();
      }, 100);
    }
  }, true);
  
  // 页面滚动时隐藏气泡
  document.addEventListener('scroll', () => {
    removeTooltip();
  }, true);
  
  // 窗口大小改变时隐藏气泡
  window.addEventListener('resize', () => {
    removeTooltip();
  });
}

// 初始化事件监听器
setupHighlightEvents();