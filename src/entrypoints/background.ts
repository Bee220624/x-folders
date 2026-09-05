import { createHandlers } from '@/background/rpc/handlers';
import { registerRpcServer } from '@/background/rpc/RpcServer';
import { applyStoredLogLevel } from '@/utils/logger';

export default defineBackground({
  type: 'module',
  main() {
    // Registered synchronously during module evaluation. A listener attached
    // after an await would not exist when the worker is woken *by* a message,
    // and that message would be dropped.
    registerRpcServer(createHandlers());

    // Deliberately after the listener and deliberately not awaited: the log
    // level is not worth delaying message registration for.
    void applyStoredLogLevel();
  },
});
