import type { PetCoreHost } from '../core/index.js';
import type { HomeBinding } from '../core/workspace.js';
import { PortableImages, type NativeAttachments } from '../presentation/images.js';
export declare class RoomImages extends PortableImages<HomeBinding> {
    constructor(host: PetCoreHost, attachments: () => NativeAttachments | undefined);
}
export declare function televisionImage(input: unknown): {
    mediaType: string;
    data: string;
};
