// Mock implementation of `@tauri-apps/api/event`'s `listen`, swapped in via
// a Vite alias ONLY when E2E_MOCK=1 (see vite.config.ts).
//
// The app's realtime handlers (presence/typing/message-upsert/etc.) are
// nice-to-have UI reactions, not the primary data path: message send/receive
// and conversation/contact loading all flow through invoke()'s return value
// (see src/App.tsx), so a no-op listener is sufficient for the e2e flows
// this suite covers. No test in this suite depends on a mocked event firing.
export type UnlistenFn = () => void;

export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return () => {};
}
