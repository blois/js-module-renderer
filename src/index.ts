import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';
import {
  CommChannel,
  CommMessage,
  DataEvent,
  MimeData,
  NodeEvent,
  RenderModule
} from './extensibleRenderer';
import dynamicImportPolyfill from 'dynamic-import-polyfill';
import { INotebookModel, INotebookTracker } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Kernel, KernelMessage } from '@jupyterlab/services';

const mimeType = 'application/vnd.jupyter.extensible.alpha+json';
let initializedDynamicImport = false;

/**
 * Initialization data for the js-module-renderer extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: 'js-module-renderer',
  autoStart: true,
  requires: [IRenderMimeRegistry],
  optional: [INotebookTracker],

  activate: (
    app: JupyterFrontEnd,
    rendermimeRegistry: IRenderMimeRegistry,
    tracker: INotebookTracker | null
  ) => {
    rendermimeRegistry.addFactory(new RendererFactory(null));

    if (tracker !== null) {
      tracker.forEach(panel => {
        panel.content.rendermime.addFactory(new RendererFactory(panel.context));
      });
      tracker.widgetAdded.connect((sender, panel) => {
        panel.content.rendermime.addFactory(new RendererFactory(panel.context));
      });
    }
  }
};

class RendererFactory implements IRenderMime.IRendererFactory {
  readonly safe = false;
  readonly mimeTypes = [mimeType];
  private kernel: Kernel.IKernelConnection;

  constructor(
    private readonly context: DocumentRegistry.IContext<INotebookModel> | null
  ) {
    if (this.context) {
      context.sessionContext.kernelChanged.connect((sender, args) => {
        this.handleKernelChanged(args.oldValue, args.newValue);
      });

      context.sessionContext.statusChanged.connect((sender, args) => {
        // this._handleKernelStatusChange(args);
      });

      context.sessionContext.connectionStatusChanged.connect((sender, args) => {
        // this._handleKernelConnectionStatusChange(args);
      });

      if (
        context.sessionContext.session &&
        context.sessionContext.session.kernel
      ) {
        this.handleKernelChanged(null, context.sessionContext.session.kernel);
      }
    }
  }

  private handleKernelChanged(
    oldValue: Kernel.IKernelConnection,
    newValue: Kernel.IKernelConnection
  ): void {
    this.kernel = newValue;
  }

  createRenderer(options: IRenderMime.IRendererOptions): IRenderMime.IRenderer {
    return new OutputWidget(options, this.kernel);
  }
}

class OutputWidget extends Widget implements IRenderMime.IRenderer {
  /**
   * Construct a new output widget.
   */
  constructor(
    options: IRenderMime.IRendererOptions,
    private readonly kernel: Kernel.IKernelConnection | null
  ) {
    super();
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    if (!initializedDynamicImport) {
      initializedDynamicImport = true;
      dynamicImportPolyfill.initialize({});
    }

    const args = (model.data[mimeType] as unknown) as MimeData;
    const data = model.data as { [key: string]: any };
    const metadata = model.data as { [key: string]: any };

    const options = new RenderOptionsImpl(data, metadata, this.kernel);
    try {
      const result = (await __import__(args.url)) as RenderModule;
      result.renderFunction({
        node: this.node,
        data: options.data,
        createComm: options.createComm.bind(options),
        dataUpdates: options.dataUpdates,
        get nodeUpdates() {
          return options.nodeUpdates;
        }
      });
    } catch (error) {
      console.error('Render error:', error);
    }

    return options.renderData.waitPromises;
  }
}

class RenderDataEvent {
  waitPromises = Promise.resolve<void>(undefined);

  constructor(
    readonly data: { [key: string]: any },
    readonly metadata: { [key: string]: any }
  ) {}

  waitUntil(promise: Promise<void>): void {
    this.waitPromises = this.waitPromises.then(() => promise);
  }
}

class RenderOptionsImpl {
  readonly renderData: RenderDataEvent;

  constructor(
    data: { [key: string]: any },
    metadata: { [key: string]: any },
    private readonly kernel: Kernel.IKernelConnection | null
  ) {
    this.renderData = new RenderDataEvent(data, metadata);
  }

  async createComm(targetName: string): Promise<CommChannel> {
    if (!this.kernel) {
      throw new Error('not supported');
    }
    const comm = this.kernel.createComm(targetName);

    const commImpl = new CommImpl(comm);
    await comm.open().done;

    return {
      send: (data: CommMessage): Promise<void> => commImpl.send(data),
      close: (): void => {
        commImpl.close();
      },
      get messages(): AsyncIterable<CommMessage> {
        return commImpl.messages;
      }
    };
  }

  get data(): DataEvent {
    return {
      data: this.renderData.data,
      metadata: this.renderData.metadata,
      waitUntil: (promise: Promise<void>): void => {
        this.renderData.waitUntil(promise);
      }
    };
  }

  get dataUpdates(): AsyncIterable<DataEvent> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<DataEvent> {
        return {
          next(): Promise<IteratorResult<DataEvent>> {
            return Promise.resolve({ done: true } as IteratorResult<DataEvent>);
          }
        };
      }
    };
  }

  get nodeUpdates(): AsyncIterable<NodeEvent> {
    throw new Error('not supported');
  }
}

class CommImpl {
  private readonly listeners = new AsyncListeners<CommMessage>();
  private readonly bufferedMessages: CommMessage[] = [];
  private isOpen = false;

  constructor(private readonly comm: Kernel.IComm) {
    this.comm.onMsg = (message: KernelMessage.ICommMsgMsg): void => {
      const buffers: ArrayBuffer[] = [];
      if (message.buffers) {
        for (const buffer of message.buffers) {
          if (ArrayBuffer.isView(buffer)) {
            buffers.push(
              new Uint8Array(
                buffer.buffer,
                buffer.byteOffset,
                buffer.byteLength
              )
            );
          } else {
            buffers.push(new Uint8Array(buffer));
          }
        }
      }

      // Comm messages may arrive before any listeners have been able
      // to be added to this, so buffer up all messages until the
      // first listener is added.
      if (this.isOpen) {
        this.listeners.push({
          data: message.content.data,
          buffers
        });
      } else {
        this.bufferedMessages.push({
          data: message.content.data,
          buffers
        });
      }
    };

    this.comm.onClose = (): void => {
      this.listeners.close();
    };
  }

  private opened(): void {
    this.isOpen = true;
    Promise.resolve().then(() => {
      for (const message of this.bufferedMessages) {
        this.listeners.push(message);
      }
      this.bufferedMessages.length = 0;
    });
  }

  async send(data: CommMessage): Promise<void> {
    await this.comm.send(data.data, null, data.buffers).done;
  }

  async close(): Promise<void> {
    await this.comm.close().done;
    this.listeners.close();
  }

  get messages(): AsyncIterable<CommMessage> {
    const listener = this.listeners.listen();
    if (!this.isOpen) {
      this.opened();
    }
    return listener;
  }
}

class AsyncListeners<T> {
  private readonly listeners: AsyncListener<T>[] = [];

  push(value: T): void {
    for (const listener of this.listeners) {
      listener.push(value);
    }
  }
  close(): void {
    for (const listener of this.listeners) {
      listener.close();
    }
  }
  listen(): AsyncIterable<T> {
    const listener = new AsyncListener<T>(() => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    });
    this.listeners.push(listener);
    return listener;
  }
}

type IteratorResult<T> = {
  value: T;
  done: boolean;
};

class AsyncListener<T> implements AsyncIterable<T> {
  private readonly queued: IteratorResult<T>[] = [];
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private readonly finalResult: IteratorResult<T> = {
    value: (undefined as unknown) as T,
    done: true
  };

  constructor(private readonly remover: () => void) {}

  push(value: T): void {
    if (this.closed) {
      return;
    }
    if (this.waiting.length) {
      const next = this.waiting.shift();
      if (next) {
        next({ value, done: false });
        return;
      }
    }
    this.queued.push({ value, done: false });
  }

  close(): void {
    for (const waiting of this.waiting) {
      waiting(this.finalResult);
    }
    this.waiting.length = 0;
    this.closed = true;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.closed) {
          return Promise.resolve<IteratorResult<T>>(this.finalResult);
        }
        if (this.queued.length) {
          const next = this.queued.shift();
          if (next) {
            return Promise.resolve<IteratorResult<T>>(next);
          }
        }
        return new Promise<IteratorResult<T>>(resolve => {
          this.waiting.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.remover();
        this.closed = true;
        return Promise.resolve(this.finalResult);
      }
    };
  }
}

export default extension;
