// 只渲染虚构数据；外部链接为惰性引用，不抓取真实页面。
async function initialize() {
  const runId = location.pathname.split('/').at(-1);
  const config = await (await fetch(`/scenario/${runId}`)).json();
  const find = name => document.querySelector(`[data-testid="${name}"]`);
  const chat = find('chat');
  const panel = find('answer-panel');
  const answer = find('answer-text');
  const loading = find('loading');
  const citations = find('citations');
  const mode = config.mode;
  const reveal = name => { chat.hidden = true; find(name).hidden = false; };
  if (mode === 'challenge') reveal('challenge');
  else if (mode === 'expired-login' || (mode === 'authenticated' && !document.cookie.includes('fixture-session=active'))) {
    reveal('login');
  } else chat.hidden = false;
  if (mode === 'sensitive-ui') {
    const sensitive = find('sensitive-ui');
    sensitive.hidden = false;
    for (const [index, label] of ['账号菜单', '支付信息', 'Cookie 调试'].entries()) {
      const section = document.createElement('section');
      section.dataset.sensitive = label;
      section.textContent = `${label}：${config.sensitiveValues[index]}`;
      sensitive.append(section);
    }
    localStorage.setItem('fixture-sensitive', config.sensitiveValues[0]);
  }
  if (mode === 'selector-changed') find('prompt').dataset.testid = 'prompt-v2';
  if (mode !== 'unknown-metadata') {
    panel.dataset.sourceProduct = '虚构 AI';
    panel.dataset.sourceModel = 'fixture-model';
    panel.dataset.sourceVersion = 'fixture-v1';
    panel.dataset.search = 'true';
  }
  if (mode === 'external-resource') {
    // 精确同源路由应在实际发包前拦截；CSP作为额外防线。
    fetch('https://outside.geo-fixture.invalid/probe').catch(() => {});
  }
  find('temporary-chat').onclick = () => {
    find('chat-mode').textContent = '临时聊天';
    chat.dataset.temporary = 'true';
    answer.textContent = '';
    citations.replaceChildren();
  };
  function addCitations() {
    for (const citation of config.citations) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = citation.url;
      link.textContent = citation.title;
      link.dataset.position = String(citation.position);
      link.rel = 'noopener noreferrer';
      item.append(link);
      citations.append(item);
    }
  }
  document.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const prompt = find(mode === 'selector-changed' ? 'prompt-v2' : 'prompt').value;
    const response = await fetch(`/submit/${runId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
    });
    if (!response.ok) return;
    panel.dataset.status = 'streaming';
    loading.hidden = false;
    find('submit').disabled = true;
    if (mode === 'challenge-after-send') return reveal('challenge');
    if (mode === 'login-after-send') return reveal('login');
    const first = config.answer.slice(0, 10);
    answer.textContent = first;
    if (mode === 'timeout') return;
    if (mode === 'early-complete') {
      panel.dataset.status = 'complete';
      loading.hidden = true;
    }
    // 调度器模拟真实延迟；适配器必须观察信号，不能据本fixture延迟固定sleep。
    setTimeout(() => {
      answer.textContent = mode === 'empty-answer' ? '  \n ' : config.answer;
      if (mode === 'answer-selector-changed') answer.dataset.testid = 'answer-v2';
      if (mode === 'duplicate-answer') panel.append(answer.cloneNode(true));
      panel.dataset.status = 'complete';
      loading.hidden = true;
      // 完成标志出现后，引用集合仍可能更新。
      setTimeout(addCitations, 60);
    }, mode === 'paused-stream' ? 350 : 50);
  };
  document.documentElement.dataset.fixtureReady = 'true';
}
initialize();
