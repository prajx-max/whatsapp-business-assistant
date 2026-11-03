const list = document.querySelector(
  '[data-testid="conversation-panel-messages"]',
);
let sequence = 0;
let switchedChats = 0;
let lastIncoming = null;
let lastOutgoing = null;
const publicIds = new URL(location.href).searchParams.has('publicIds');
const themeRows = new URL(location.href).searchParams.has('themeRows');
const remountTail = new URL(location.href).searchParams.has('remountTail');
const rewriteComposer = new URL(location.href).searchParams.has(
  'rewriteComposer',
);
document.getElementById('hold-send').onchange = (event) => {
  document.getElementById('send').disabled = event.target.checked;
};
if (rewriteComposer)
  document.getElementById('main').addEventListener('input', (event) => {
    const editor = event.target.closest('[contenteditable="true"]');
    if (!editor) return;
    globalThis.queueMicrotask(() => {
      if (!editor.isConnected) return;
      const replacement = editor.cloneNode(true);
      const textNodes = document.createTreeWalker(replacement, 4);
      while (textNodes.nextNode())
        textNodes.currentNode.textContent =
          textNodes.currentNode.textContent.replaceAll(' ', '\u00a0');
      editor.replaceWith(replacement);
    });
  });
if (themeRows)
  document
    .querySelector('#main header [data-chat-id]')
    .removeAttribute('data-chat-id');
function themeWrap(node, direction, id) {
  if (!themeRows) return;
  const main = document.getElementById('main');
  main.style.setProperty('--incoming-background', '#242626');
  main.style.setProperty('--outgoing-background', '#144d37');
  node.className = 'opaque-message-row';
  node.dataset.id = id.toString(16).padStart(32, '0');
  node.dataset.testid = `conv-msg-${id}`;
  const container = document.createElement('div');
  container.dataset.testid = 'msg-container';
  const bubble = document.createElement('div');
  bubble.style.backgroundColor = `var(--${direction === 'out' ? 'outgoing' : 'incoming'}-background)`;
  bubble.append(...node.childNodes);
  container.append(bubble);
  node.append(container);
}
function directionId(direction, id) {
  return `${direction === 'out' ? 'true' : 'false'}_fixture@lid_${id}`;
}
if (publicIds || themeRows) {
  for (const node of list.children) {
    node.setAttribute('data-id', directionId('in', 'baseline'));
    node.className = 'opaque-message-row';
    themeWrap(node, 'in', ++sequence);
  }
}
function add(direction, text) {
  const node = document.createElement('div');
  node.className = publicIds ? 'opaque-message-row' : `message-${direction}`;
  node.dataset.id = publicIds
    ? directionId(direction, ++sequence)
    : `fixture-${++sequence}`;
  const span = document.createElement('span');
  span.className = 'selectable-text copyable-text';
  span.textContent = text;
  node.append(span);
  themeWrap(node, direction, sequence);
  list.append(node);
  if (direction === 'in') lastIncoming = node;
  else lastOutgoing = node;
}
document.getElementById('incoming').onclick = () => {
  if (remountTail && lastOutgoing && lastOutgoing === list.lastElementChild) {
    const replacement = lastOutgoing.cloneNode(true);
    lastOutgoing.replaceWith(replacement);
    lastOutgoing = replacement;
  }
  add('in', document.getElementById('question').value);
};
document.getElementById('outgoing').onclick = () =>
  add('out', 'This is an outgoing message.');
document.getElementById('duplicate').onclick = () => {
  const node =
    lastIncoming && list.contains(lastIncoming)
      ? lastIncoming
      : list.querySelector(
          themeRows
            ? '[data-testid^="conv-msg-"]:last-child'
            : publicIds
              ? '[data-id^="false_"]:last-child'
              : '.message-in:last-child',
        );
  if (node) list.append(node.cloneNode(true));
};
document.getElementById('history').onclick = () => {
  const node = document.createElement('div');
  node.className = publicIds ? 'opaque-message-row' : 'message-in';
  node.dataset.id = publicIds
    ? directionId('in', `older-${++sequence}`)
    : `older-${++sequence}`;
  node.textContent = 'Historical content, not a new message.';
  themeWrap(node, 'in', sequence);
  list.prepend(node);
};
document.getElementById('switch').onclick = () => {
  const title = document.querySelector('#main header [title]');
  const suffix = String.fromCharCode(66 + switchedChats++);
  if (!themeRows)
    title.setAttribute('data-chat-id', `fixture-chat-${suffix.toLowerCase()}`);
  title.setAttribute('title', `Fixture customer ${suffix}`);
  title.textContent = `Fixture customer ${suffix}`;
  document.querySelector('[contenteditable="true"]').textContent = '';
  list.replaceChildren();
  add('in', 'History in the second chat.');
};
document.getElementById('send').onclick = () => {
  const composer = document.querySelector('[contenteditable="true"]');
  if (!composer.innerText.trim()) return;
  add('out', composer.innerText);
  composer.textContent = '';
  composer.dispatchEvent(
    new globalThis.InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
    }),
  );
  const output = document.getElementById('sent');
  output.textContent = String(Number(output.textContent) + 1);
};
