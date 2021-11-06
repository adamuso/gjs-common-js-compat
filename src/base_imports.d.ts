declare class FileInfo {
    get_file_type(): FileType;
    unref(): void;
}

declare class File {
    static new_for_path(path: string): File;
    get_parent(): File;
    get_basename(): string;
    get_path(): string;
    get_relative_path(descendant: File): string;
    resolve_relative_path(path: string): File;
    query_info(type: "standard::", flags: FileQueryInfoFlags, cancellable: null): FileInfo | null;
    query_file_type(flags: FileQueryInfoFlags, cancellable: null): FileType;
    query_exists(cancellable: null): boolean;
    load_contents(cancellable: null): [ok: boolean, contents: Uint8Array, etag_out: string];
    unref(): void;
}

declare enum FileType {
    UNKNOWN,
    REGULAR,
    DIRECTORY,
    SYMBOLIC_LINK,
    SPECIAL,
    SHORTCUT,
    MOUNTABLE,
}

declare enum FileQueryInfoFlags {
    NONE,
    NOFOLLOW_SYMLINKS
}

type Importer = { searchPath: string[] } & { [key: string]: Importer };

declare const imports: {
    searchPath: string[],
    gi: {
        GLib: {
            get_current_dir(): string;
        },
        Gio: {
            File: typeof File
            FileQueryInfoFlags: typeof FileQueryInfoFlags
            FileType: typeof FileType
        }
    },
    byteArray: {
        toString(array: Uint8Array, encoding?: string): string;
        fromString(str: string, encoding?: string): Uint8Array
    }
} & {
    [key: string]: Importer
}

declare function log(v: string): void;
declare function logError(v: string): void;
declare function print(v: string): void;
declare function printError(v: string): void;
