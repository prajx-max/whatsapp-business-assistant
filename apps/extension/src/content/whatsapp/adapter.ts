import { z } from 'zod';
import {
  AdapterConfigSchema,
  InsertCommandSchema,
  AutoSendCommandSchema,
  AdapterAckSchema,
} from '@assistant/contracts';
import type {
  AdapterConfig,
  AdapterContext,
  AdapterRequest,
  AdapterStatus,
  AutoSendResult,
} from '@assistant/contracts';
import {
  hash,
  labelFor,
  readChatTitle,
  chatIdentity,
} from './chat-metadata.js';
import { select } from './selector-registry.js';
import { diagnostics } from './diagnostics.js';
import { incomingText, messageNodes, messageDomId } from './reader.js';
import { Deduplicator } from './deduplicator.js';
import { insertDraft, ComposerInsertion, composerText } from './composer.js';
import { inspectStructure } from './structure.js';

export class WhatsAppAdapter {
  private observer: MutationObserver | null = null;
  private context: AdapterContext | null = null;
  private list: HTMLElement | null = null;
  private title = '';
  private identity = '';
  private armAfter = 0;
  private hydrationTimer: ReturnType<typeof setTimeout> | null = null;
  private seen = new WeakSet<HTMLElement>();
  private readonly seenIds = new Set<string>();
  private eligible = new WeakSet<HTMLElement>();
  private tail: HTMLElement | null = null;
  private tailId: string | null = null;
  private generation = 0;
  private chain = Promise.resolve();
  private deduplicator: Deduplicator;
  private lastStatus = '';
  private lastInsertedContext = '';
  private latestIncoming: {
    eventKey: string;
    node: HTMLElement;
    domId: string | null;
    receivedAt: number;
    observedText: string;
  } | null = null;
  private autoSending = false;
  private readonly attempted = new Set<string>();
  constructor(
    private readonly document: Document,
    private config: AdapterConfig,
    private readonly emit: (request: AdapterRequest) => Promise<unknown>,
  ) {
    this.deduplicator = new Deduplicator(config.duplicateWindowSeconds * 1000);
  }
  async start() {
    await this.scan();
    this.observer = new MutationObserver((records) => {
      // Purely append-only processing; text in baseline nodes is never extracted.
      this.chain = this.chain
        .then(() => this.scan(records))
        .catch(() => undefined);
    });
    this.observer.observe(this.document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'title',
        'data-id',
        'data-chat-id',
        'role',
        'contenteditable',
        'data-testid',
        'class',
      ],
    });
  }
  private arm() {
    this.armAfter = Date.now() + 600;
    if (this.hydrationTimer) clearTimeout(this.hydrationTimer);
    this.hydrationTimer = setTimeout(() => {
      this.chain = this.chain.then(() => this.scan()).catch(() => undefined);
    }, 650);
  }
  private baseline(nodes: HTMLElement[], list: HTMLElement | null) {
    for (const node of nodes) {
      this.seen.add(node);
      const id = list ? messageDomId(node, list) : null;
      if (id) this.seenIds.add(id);
    }
    while (this.seenIds.size > 2000)
      this.seenIds.delete(this.seenIds.values().next().value ?? '');
  }
  async configure(config: unknown) {
    this.config = AdapterConfigSchema.parse(config);
    this.generation++;
    this.title = '';
    this.list = null;
    this.context = null;
    this.latestIncoming = null;
    this.identity = '';
    this.seen = new WeakSet();
    this.seenIds.clear();
    this.eligible = new WeakSet();
    this.tail = null;
    this.tailId = null;
    this.deduplicator = new Deduplicator(
      this.config.duplicateWindowSeconds * 1000,
    );
    await this.scan();
  }
  async resume(config: unknown) {
    const next = AdapterConfigSchema.parse(config);
    if (
      JSON.stringify(next) !==
      JSON.stringify(AdapterConfigSchema.parse(this.config))
    ) {
      await this.configure(next);
      return;
    }
    // Keep the active observer's baseline and deduplication state; no text is
    // extracted by scan() without mutation records. Serialize with live scans.
    const result = this.chain.then(async () => {
      await this.scan();
      await this.report(true);
    });
    this.chain = result.catch(() => undefined);
    await result;
  }
  private setTail(node: HTMLElement | null, list: HTMLElement | null) {
    this.tail = node;
    this.tailId = node && list ? messageDomId(node, list) : null;
  }
  private async scan(records: MutationRecord[] = []) {
    const list = select(
      this.document,
      this.config.selectors.messageList,
    ).element;
    const title = readChatTitle(this.document, this.config);
    const identity = chatIdentity(this.document, this.config).value;
    if (
      list !== this.list ||
      title !== this.title ||
      identity !== this.identity
    ) {
      const generation = ++this.generation;
      this.list = list;
      this.title = title;
      this.identity = identity;
      this.arm();
      this.seen = new WeakSet();
      this.seenIds.clear();
      this.eligible = new WeakSet();
      const nodes = list ? messageNodes(list, this.config.selectors) : [];
      this.baseline(nodes, list);
      this.setTail(nodes.at(-1) ?? null, list);
      this.context = null;
      this.latestIncoming = null;
      if (list && title) {
        const chatKey = await hash(
          `${this.config.salt}:${this.config.profileId}:${identity}`,
        );
        if (generation !== this.generation) return;
        this.context = {
          profileId: this.config.profileId,
          chatKey,
          chatLabel: labelFor(title),
          contextId: crypto.randomUUID(),
        };
      }
      await this.report();
      return;
    }
    await this.report();
    if (!list || !this.context || records.length === 0) return;
    const nodes = messageNodes(list, this.config.selectors);
    if (Date.now() < this.armAfter) {
      this.baseline(nodes, list);
      this.setTail(nodes.at(-1) ?? null, list);
      // Sidebar counters, typing indicators and unrelated UI must not keep
      // restarting the active message list's hydration window.
      if (
        records.some(
          (record) => record.target === list || list.contains(record.target),
        )
      )
        this.arm();
      return;
    }
    if (this.tail && !list.contains(this.tail)) {
      const anchors = this.tailId
        ? nodes.filter((node) => messageDomId(node, list) === this.tailId)
        : [];
      const anchor = anchors.length === 1 ? anchors[0] : undefined;
      if (anchor) {
        // A row remount with the same observed public ID preserves continuity.
        // Baseline through that anchor; only new appended rows after it qualify.
        this.baseline(nodes.slice(0, nodes.indexOf(anchor) + 1), list);
        this.setTail(anchor, list);
      } else {
        // No unique known anchor: retain conservative history/list baselining.
        this.baseline(nodes, list);
        this.setTail(nodes.at(-1) ?? null, list);
        this.context = { ...this.context, contextId: crypto.randomUUID() };
        this.latestIncoming = null;
        this.arm();
        await this.report();
        return;
      }
    }
    if (this.tail) this.tailId = messageDomId(this.tail, list);
    for (const node of nodes) {
      if (!this.seen.has(node)) {
        const appended = records.some((record) =>
          [...record.addedNodes].some(
            (added) =>
              added === node ||
              (added instanceof Element && added.contains(node)),
          ),
        );
        // scan() awaits worker diagnostics above. A later DOM mutation can
        // already be visible here even though its record is still queued.
        // Leave it untouched until the scan for its own addition runs.
        if (!appended) continue;
        this.seen.add(node);
        const domId = messageDomId(node, list);
        const knownId = domId ? this.seenIds.has(domId) : false;
        if (domId) {
          this.seenIds.add(domId);
          if (this.seenIds.size > 2000)
            this.seenIds.delete(this.seenIds.values().next().value ?? '');
        }
        const afterTail =
          !this.tail || Boolean(this.tail.compareDocumentPosition(node) & 4);
        if (afterTail && appended && !knownId && this.config.enabled)
          this.eligible.add(node);
        if (afterTail) this.setTail(node, list);
      }
      if (!this.eligible.has(node) || !this.config.enabled) continue;
      const text = incomingText(node, this.config.selectors);
      if (!text) continue;
      this.eligible.delete(node);
      const current: AdapterContext = this.context;
      const generation = this.generation;
      const id = messageDomId(node, list);
      const textHash = await hash(text.normalize('NFKC'));
      const eventKey = await hash(
        `${current.profileId}:${current.chatKey}:${id ?? textHash}`,
      );
      if (
        generation !== this.generation ||
        readChatTitle(this.document, this.config) !== this.title ||
        chatIdentity(this.document, this.config).value !== this.identity
      )
        return;
      if (!this.deduplicator.accept(eventKey)) continue;
      // Every new event first registers context, even when the diagnostics did
      // not change. A restarted worker otherwise has no tab state to accept it.
      if (!(await this.report(true))) continue;
      if (
        generation !== this.generation ||
        this.context !== current ||
        !list.contains(node) ||
        readChatTitle(this.document, this.config) !== this.title ||
        chatIdentity(this.document, this.config).value !== this.identity
      )
        return;
      this.latestIncoming = {
        eventKey,
        node,
        domId: id,
        receivedAt: Date.now(),
        observedText: text,
      };
      await this.emit({
        type: 'ADAPTER_MESSAGE',
        version: 1,
        context: current,
        eventKey,
        text,
      });
    }
  }
  private async report(force = false): Promise<boolean> {
    const matches = diagnostics(this.document, this.config.selectors);
    const status: AdapterStatus = {
      ready: Boolean(
        this.context && matches.composer >= 0 && Date.now() >= this.armAfter,
      ),
      context: this.context,
      matches,
      structure: inspectStructure(this.document, this.config),
    };
    const serialized = JSON.stringify(status);
    if (!force && serialized === this.lastStatus) return true;
    this.lastStatus = serialized;
    const response = AdapterAckSchema.safeParse(
      await this.emit({ type: 'ADAPTER_STATUS', version: 1, status }),
    );
    return response.success && response.data.ok;
  }
  async insert(input: unknown): Promise<boolean> {
    const command = InsertCommandSchema.safeParse(input);
    const current = this.context;
    if (!command.success || !current || !this.config.enabled) return false;
    const expected = command.data.context;
    if (
      expected.profileId !== current.profileId ||
      expected.contextId !== current.contextId ||
      expected.chatKey !== current.chatKey ||
      this.lastInsertedContext === `${current.contextId}:${command.data.text}`
    )
      return false;
    const title = readChatTitle(this.document, this.config);
    const identity = chatIdentity(this.document, this.config);
    if (
      (!identity.strong &&
        !this.sourceMatches(
          command.data.context,
          command.data.sourceEventKey,
        )) ||
      identity.value !== this.identity ||
      Date.now() < this.armAfter ||
      select(this.document, this.config.selectors.messageList).element !==
        this.list ||
      (this.tail && !this.list?.contains(this.tail))
    )
      return false;
    if (
      title !== this.title ||
      (await hash(
        `${this.config.salt}:${this.config.profileId}:${identity.value}`,
      )) !== expected.chatKey ||
      readChatTitle(this.document, this.config) !== title ||
      chatIdentity(this.document, this.config).value !== identity.value
    )
      return false;
    if (
      !this.contextMatches(expected) ||
      (!identity.strong &&
        !this.sourceMatches(expected, command.data.sourceEventKey))
    )
      return false;
    const result = insertDraft(this.document, this.config, command.data.text);
    if (result)
      this.lastInsertedContext = `${current.contextId}:${command.data.text}`;
    return result;
  }
  private contextMatches(expected: AdapterContext) {
    return Boolean(
      this.config.enabled &&
      this.context &&
      this.list?.isConnected &&
      this.context.profileId === expected.profileId &&
      this.context.contextId === expected.contextId &&
      this.context.chatKey === expected.chatKey &&
      Date.now() >= this.armAfter &&
      readChatTitle(this.document, this.config) === this.title &&
      chatIdentity(this.document, this.config).value === this.identity &&
      select(this.document, this.config.selectors.messageList).element ===
        this.list,
    );
  }
  private sourceMatches(expected: AdapterContext, eventKey?: string) {
    const source = this.latestIncoming;
    if (
      !source ||
      !eventKey ||
      source.eventKey !== eventKey ||
      !source.domId ||
      !this.list ||
      !this.contextMatches(expected) ||
      !this.list.contains(source.node) ||
      messageDomId(source.node, this.list) !== source.domId ||
      incomingText(source.node, this.config.selectors) !==
        source.observedText ||
      Date.now() - source.receivedAt >
        Math.min(this.config.duplicateWindowSeconds, 300) * 1000
    )
      return false;
    // Any later row (including an operator reply or an unprocessed incoming row)
    // invalidates this source. No outgoing message text is extracted.
    const nodes = messageNodes(this.list, this.config.selectors);
    return nodes.at(-1) === source.node;
  }
  async autoSend(input: unknown): Promise<AutoSendResult> {
    const parsed = AutoSendCommandSchema.safeParse(input);
    const blocked = (
      reason:
        | 'CONTEXT_CHANGED'
        | 'COMPOSER_BUSY'
        | 'SEND_UNAVAILABLE'
        | 'AUTHORIZATION_REVOKED',
    ): AutoSendResult => ({ state: 'BLOCKED', reason });
    if (!parsed.success || this.autoSending || !this.config.autoSendEnabled)
      return blocked('AUTHORIZATION_REVOKED');
    const command = parsed.data;
    const permitted = () =>
      this.config.autoSendEnabled &&
      this.document.visibilityState === 'visible' &&
      !this.attempted.has(command.sourceEventKey) &&
      this.sourceMatches(command.context, command.sourceEventKey);
    if (!permitted()) return blocked('CONTEXT_CHANGED');
    const composer = select(
      this.document,
      this.config.selectors.composer,
    ).element;
    if (!composer || composerText(composer) !== '')
      return blocked('COMPOSER_BUSY');
    const insertion = new ComposerInsertion(
      this.document,
      this.config,
      command.text,
    );
    this.autoSending = true;
    let clicked = false;
    try {
      if (!insertion.insert()) return blocked('COMPOSER_BUSY');
      const deadline = Date.now() + 1500;
      let button: HTMLElement | null = null;
      while (Date.now() < deadline) {
        if (!permitted()) return blocked('CONTEXT_CHANGED');
        if (insertion.interrupted) return blocked('COMPOSER_BUSY');
        if (!insertion.matches()) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          continue;
        }
        button =
          select(
            this.document,
            this.config.selectors.sendButton,
          ).element?.closest<HTMLElement>('button, [role="button"]') ?? null;
        if (
          button &&
          insertion.element?.closest('footer')?.contains(button) &&
          !button.matches(':disabled, [aria-disabled="true"]')
        )
          break;
        button = null;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      if (!button) return blocked('SEND_UNAVAILABLE');
      const replyHash = await hash(command.text);
      const authorization = z.strictObject({ ok: z.boolean() }).safeParse(
        await this.emit({
          type: 'ADAPTER_AUTHORIZE_SEND',
          version: 1,
          context: command.context,
          deliveryId: command.deliveryId,
          sourceEventKey: command.sourceEventKey,
          replyHash,
        }),
      );
      if (!authorization.success || !authorization.data.ok)
        return blocked('AUTHORIZATION_REVOKED');
      // No asynchronous gap between final identity/composer checks and the click.
      if (!permitted()) return blocked('CONTEXT_CHANGED');
      if (!insertion.matches()) return blocked('COMPOSER_BUSY');
      const currentButton = select(
        this.document,
        this.config.selectors.sendButton,
      ).element?.closest<HTMLElement>('button, [role="button"]');
      if (
        currentButton !== button ||
        !button.isConnected ||
        !insertion.element?.closest('footer')?.contains(button) ||
        button.matches(':disabled, [aria-disabled="true"]')
      )
        return blocked('SEND_UNAVAILABLE');
      this.attempted.add(command.sourceEventKey);
      if (this.attempted.size > 512)
        this.attempted.delete(this.attempted.values().next().value ?? '');
      clicked = true;
      button.click();
      const acknowledgeBy = Date.now() + 1500;
      while (Date.now() < acknowledgeBy) {
        if (!this.contextMatches(command.context) || !insertion.attached) break;
        if (insertion.cleared())
          return { state: 'SENT', reason: 'ACCEPTED_BY_WHATSAPP' };
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      return { state: 'UNCERTAIN', reason: 'SEND_UNCONFIRMED' };
    } catch {
      return clicked
        ? { state: 'UNCERTAIN', reason: 'SEND_UNCONFIRMED' }
        : blocked('SEND_UNAVAILABLE');
    } finally {
      insertion.dispose();
      this.autoSending = false;
    }
  }
  async settled() {
    await this.chain;
  }
  stop() {
    this.generation++;
    this.latestIncoming = null;
    this.observer?.disconnect();
    if (this.hydrationTimer) clearTimeout(this.hydrationTimer);
  }
}
