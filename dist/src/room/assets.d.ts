export { ROOM_PHOTO_ENDPOINTS } from '../presentation/room-transport.js';
export declare const roomPrefix = "/chatpet-room";
/** Preserve the shipped scene; missing expression assets use accurate text. */
export declare function adaptRoomApp(source: string): string;
/** Reuse the scene's poll/apply functions, with native change wakeups. */
export declare function adaptRoomRefresh(source: string): string;
/** The public route serves only shipped artwork and code. Personal state uses DSH's owner Connection. */
export declare function roomAsset(request: Request): Promise<Response>;
