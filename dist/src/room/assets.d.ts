export { ROOM_PHOTO_ENDPOINTS } from '../presentation/room-transport.js';
export declare const roomPrefix = "/chatpet-room";
/** Preserve the shipped scene; missing expression assets use accurate text. */
export declare function adaptRoomApp(source: string): string;
/** Adapt shipped template labels, never user text or stable action identifiers. */
export declare function adaptRoomIdentityScript(source: string): string;
/** Reuse the scene's poll/apply functions, with native change wakeups. */
export declare function adaptRoomRefresh(source: string): string;
/** Extend the existing owner RPC transport; no public audio/state HTTP route. */
export declare function adaptRoomTransport(source: string): string;
/** The saved garden preference never claims a second autonomous planner. */
export declare function adaptRoomGarden(source: string): string;
/** The public route serves only shipped artwork and code. Personal state uses DSH's owner Connection. */
export declare function roomAsset(request: Request): Promise<Response>;
