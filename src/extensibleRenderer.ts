export interface CommMessage {
  readonly data: any;
  readonly buffers?: ArrayBuffer[];
}

export interface CommChannel {
  send(data: CommMessage): Promise<void>;
  close(): void;
  // Iterator ends on close
  readonly messages: AsyncIterable<CommMessage>;
}

export interface DataEvent {
  readonly data: { [key: string]: any };
  readonly metadata: { [key: string]: any };
  // optionally call this with a promise if
  // you won't finished processing the data syncronously
  // to let the outer process know when you are done
  waitUntil(promise: Promise<void>): void;
}

export interface NodeEvent {
  readonly node: HTMLElement;
  readonly type: 'add' | 'remove';
  // optionally call this with a promise if
  // you won't finished processing the node update syncronously
  // to let the outer process know when you are done
  // like in https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent
  waitUntil(promise: Promise<void>): void;
}

export interface RenderOptions {
  // the actual mime data
  readonly data: DataEvent;
  /// any updates of the data from update display
  readonly dataUpdates: AsyncIterable<DataEvent>;
  // The initial node for rendering
  readonly node: HTMLElement;
  // Any changes of the node
  readonly nodeUpdates: AsyncIterable<NodeEvent>;
  // Promise will reject if not connected to kernel.
  createComm(targetName: string): Promise<CommChannel>;
}

/** Interface representing the expected structure exported by the JS module. */
export interface RenderModule {
  renderFunction(object: RenderOptions): void;
}

/** The structure of the data in the display data object. */
export interface MimeData {
  readonly url: string;
}
