import type { UserMessage } from '@deepseek-ai/dsh-llm';
export interface EncodedImage {
    data: string;
    mediaType: string;
}
export interface NativeAttachments {
    admitPromptContent(content: unknown[]): Promise<UserMessage['content']>;
}
export interface ImageFiles {
    prepare(): void;
    names(): string[];
    read(name: string, maxBytes: number): string | null | undefined;
    stage(name: string, value: string): void;
    publish(staged: string, name: string): void;
    discard(name: string): void;
}
/** Share the admission and atomic copy protocol. Each caller opens its own
 * bound directory and implements the filesystem operations. */
export declare class PortableImages<Binding> {
    private readonly binding;
    private readonly files;
    private readonly attachments;
    private readonly maxEncodedSize;
    private restored?;
    constructor(binding: () => Binding | undefined, files: (binding: Binding) => ImageFiles, attachments: () => NativeAttachments | undefined, maxEncodedSize?: number);
    private imageScope;
    private validateImage;
    admit(image: EncodedImage, caller?: () => void): Promise<UserMessage['content']>;
    restore(caller?: () => void): Promise<void>;
}
