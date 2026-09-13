import { io } from "socket.io-client";
// Keep the transport outside hot-reloaded UI modules. UI refreshes reuse one socket.
export const socket = io({ autoConnect: false });
