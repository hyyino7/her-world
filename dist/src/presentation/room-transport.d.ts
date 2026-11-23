declare const routes: {
    readonly roomState: {
        readonly path: "/api/home/state";
        readonly photo: "home";
    };
    readonly roomAction: {
        readonly path: "/api/home/act";
    };
    readonly roomGarden: {
        readonly path: "/api/garden/state";
        readonly photo: "garden";
    };
    readonly roomPlant: {
        readonly path: "/api/garden/act";
    };
    readonly roomCare: {
        readonly path: "/api/garden/control";
    };
    readonly roomChat: {
        readonly path: "/api/room/chat";
        readonly roomLong: true;
        readonly consoleLong: true;
    };
    readonly roomTelevision: {
        readonly path: "/api/tv/opinion";
        readonly roomLong: true;
        readonly consoleLong: true;
    };
    readonly roomHistory: {
        readonly path: "/api/room/history";
        readonly photo: "history";
    };
    readonly roomVoice: {
        readonly path: "/api/room/voice";
        readonly roomLong: true;
    };
};
export type RoomEndpoint = keyof typeof routes;
export declare const ROOM_ENDPOINTS: readonly ("roomAction" | "roomState" | "roomGarden" | "roomPlant" | "roomCare" | "roomChat" | "roomTelevision" | "roomHistory" | "roomVoice")[];
export declare function isRoomEndpoint(value: unknown): value is RoomEndpoint;
export declare const ROOM_BROWSER_ROUTES: (readonly [string, {
    readonly endpoint: "roomAction" | "roomState" | "roomGarden" | "roomPlant" | "roomCare" | "roomChat" | "roomTelevision" | "roomHistory" | "roomVoice";
    readonly timeout: 20000 | 310000;
}])[];
export declare const ROOM_CONSOLE_TIMEOUTS: {
    defaultTimeout: number;
    endpoints: {
        [k: string]: number;
    };
};
export declare const ROOM_PHOTO_ENDPOINTS: {
    [k: string]: "garden" | "home" | "history";
};
export declare const ROOM_VOICE_PATH: "/api/room/voice";
export declare const ROOM_VOICE_OPERATIONS: string[];
export declare function roomVoiceRoute(operation: unknown): {
    rest: string;
    method: "POST" | "GET";
} | undefined;
export {};
