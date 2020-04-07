declare module 'dynamic-import-polyfill' {
  export function initialize({
    modulePath,
    importFunctionName
  }: {
    modulePath?: string;
    importFunctionName?: string;
  }): void;
}
