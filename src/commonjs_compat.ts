(function () {
    const { GLib, Gio } = imports.gi;
    const ByteArray = imports.byteArray;

    const pathToImporterMap = new Map<string, Importer>();
    const pathToModuleMap = new Map<string, object>();

    function getImporter(path: string, name: string) {
        const existingImporter = pathToImporterMap.get(path);

        if (existingImporter) {
            return existingImporter;
        }

        const oldSearchPath = imports.searchPath;
        imports.searchPath = [path];
        const importer = imports[name];
        imports.searchPath = oldSearchPath;
        pathToImporterMap.set(path + "/" + name, importer);
        return importer;
    }

    function loadJson(file: File) {
        const [ok, contents] = file.load_contents(null);

        if (!ok) {
            throw new Error(`Cannot load JSON file '${file.get_path()}'`)
        }

        return JSON.parse(ByteArray.toString(contents));
    }

    function isObjectEmpty(obj: object) {
        for (const _ in obj) {
            return false;
        }

        return true;
    }

    function requireModuleFromImporter(importer: Importer, module: string): object {
        const prevModule = (globalThis as any).module;
        const commonJSModule = (globalThis as any).module = { exports: {} } as any;
        (globalThis as any).exports = commonJSModule.exports;
        const result = importer[module];
        (globalThis as any).exports = prevModule ? prevModule.exports : undefined;
        (globalThis as any).module = prevModule;

        if (!isObjectEmpty(commonJSModule.exports)) {
            return commonJSModule.exports;
        }

        return result;
    }

    function requireJsFile(file: File): object {
        const parentDir = file.get_parent();
        const containerDir = parentDir.get_parent();
        const importer = getImporter(containerDir.get_path(), parentDir.get_basename());
        let module = file.get_basename();

        if (module.endsWith(".js")) {
            module = module.substr(0, module.length - 3);
        }

        return requireModuleFromImporter(importer, module);
    }

    function requireLoadIndex(dir: File): object | null {
        // LOAD_INDEX(X)
        // 1. If X/index.js is a file, load X/index.js as JavaScript text. STOP
        // 2. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
        // 3. If X/index.node is a file, load X/index.node as binary addon. STOP

        if (dir.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.DIRECTORY) {
            return null;
        }

       // Case 1.
       const fileJs = dir.resolve_relative_path("index.js");

       if (fileJs.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
           return requireJsFile(fileJs);
       }

       // Case 2.
       const fileJson = dir.resolve_relative_path("index.json");

       if (fileJson.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
           return loadJson(fileJson);
       }

       // Case 3.
       const fileNode = dir.resolve_relative_path("index.node");

       if (fileNode.query_exists(null)) {
           throw new Error(`.node files are not supported '${fileNode.get_path()}'`);
       }   

       return null;
    }

    function reuqireLoadAsFile(path: string): object | null {
        // LOAD_AS_FILE(X)
        // 1. If X is a file, load X as its file extension format. STOP
        // 2. If X.js is a file, load X.js as JavaScript text. STOP
        // 3. If X.json is a file, parse X.json to a JavaScript Object. STOP
        // 4. If X.node is a file, load X.node as binary addon. STOP

        // Case 1.
        const file = Gio.File.new_for_path(path);
        const fileType = file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    
        if (fileType === Gio.FileType.REGULAR) {
            if (path.endsWith(".js")) {
               return requireJsFile(file);
            }
            else if (path.endsWith(".json")) {
                return loadJson(file);

            }
            else if (path.endsWith(".node")) {
                throw new Error(`.node files are not supported '${path}'`);
            }

            return null;
        }

        // Case 2.
        const fileJs = Gio.File.new_for_path(path + ".js");

        if (fileJs.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
            return requireJsFile(fileJs);
        }

        // Case 3.
        const fileJson = Gio.File.new_for_path(path + ".json");

        if (fileJson.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
            return loadJson(fileJson);
        }

        // Case 4.
        const fileNode = Gio.File.new_for_path(path + ".node");

        if (fileNode.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
            throw new Error(`.node files are not supported '${fileNode.get_path()}'`);
        }

        return null;
    }

    function requireLoadAsDirectory(file: File): object | null {
        // LOAD_AS_DIRECTORY(X)
        // 1. If X/package.json is a file,
        //    a. Parse X/package.json, and look for "main" field.
        //    b. If "main" is a falsy value, GOTO 2.
        //    c. let M = X + (json main field)
        //    d. LOAD_AS_FILE(M)
        //    e. LOAD_INDEX(M)
        //    f. LOAD_INDEX(X) DEPRECATED
        //    g. THROW "not found"
        // 2. LOAD_INDEX(X)
        

        if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.DIRECTORY) {
            return null;
        }

        // Case 1.
        const packageJson = file.resolve_relative_path("./package.json");

        packageJson: if (packageJson.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.REGULAR) {
            const packageJsonContents = loadJson(packageJson);

            if (!packageJsonContents.main) {
                break packageJson;
            }

            const mainFile = file.resolve_relative_path(packageJsonContents.main);
            
            let result = reuqireLoadAsFile(mainFile.get_path());
            
            if (result) {
                return result;
            }

            result = requireLoadIndex(mainFile);

            if (result) {
                return result;
            }

            throw new Error(`Main file not found '${mainFile.get_path()}'`);
        }
        
        // Case 2.
        return requireLoadIndex(file);
    }

    function requireLoadNodeModules(module: string, scriptDir: string) {
        // LOAD_NODE_MODULES(X, START)
        // 1. let DIRS = NODE_MODULES_PATHS(START)
        // 2. for each DIR in DIRS:
        //    a. LOAD_PACKAGE_EXPORTS(X, DIR)
        //    b. LOAD_AS_FILE(DIR/X)
        //    c. LOAD_AS_DIRECTORY(DIR/X)

        // NODE_MODULES_PATHS(START)
        // 1. let PARTS = path split(START)
        // 2. let I = count of PARTS - 1
        // 3. let DIRS = [GLOBAL_FOLDERS]
        // 4. while I >= 0,
        //     a. if PARTS[I] = "node_modules" CONTINUE
        //     b. DIR = path join(PARTS[0 .. I] + "node_modules")
        //     c. DIRS = DIRS + DIR
        //     d. let I = I - 1
        // 5. return DIRS

        // Case NODE_MODULES_PATHS 1.
        const destinationParts = scriptDir.split("/");

        // Case LOAD_NODE_MODULES 1., 2.
        while (destinationParts.length > 1) {
            // Case NODE_MODULES_PATHS 3.

            // TODO: not implemented

            // Case NODE_MODULES_PATHS 4.a
            if (destinationParts[destinationParts.length - 1] === "node_modules") {
                continue;
            }

            // Case NODE_MODULES_PATHS 4.b
            destinationParts.push("node_modules");

            const file = Gio.File.new_for_path(destinationParts.join("/"));

            if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
                // Case LOAD_NODE_MODULES 2.a

                // TODO: not implemented

                // Case LOAD_NODE_MODULES 2.b
                let result = reuqireLoadAsFile(file.resolve_relative_path("./" + module).get_path());

                if (result) {
                    return result;
                }

                // Case LOAD_NODE_MODULES 2.c
                result = requireLoadAsDirectory(file.resolve_relative_path("./" + module));

                if (result) {
                    return result;
                }
            }

            destinationParts.pop();
            destinationParts.pop();
            // file.unref();
        }
        
        return null;
    }
        
    function require(path: string) {
        path = path.trim();
        let dir: File | null = null;

        // X = path
        // y = dir

        // 1. If X is a core module,
        //     a. return the core module
        //     b. STOP

        // TODO: Skip or add core module loading ?
        // ...

        // 2. If X begins with '/'
        //     a. set Y to be the filesystem root

        if (path.startsWith("/")) {
            dir = Gio.File.new_for_path("/");
        }

        if (path.endsWith(".js")) {
            path = path.substr(0, path.length - 3);
        }

        if (!dir) {
            const stackPath = new Error().stack!.split("\n");
            const stackPathParts = stackPath[2].split(":");
            const fullPath = stackPathParts.slice(0, stackPathParts.length - 2).join("").split("@").slice(1).join("@");
            const currentDir = GLib.get_current_dir();

            // log("Program name: " + imports.system.programInvocationName);
            log("Stack path: " + fullPath);
            log("Current dir: " + currentDir);
            log("Full path: " + fullPath.startsWith("/") ? fullPath : currentDir + "/" + fullPath);

            const currentScript = Gio.File.new_for_path(fullPath.startsWith("/") ? fullPath : currentDir + "/" + fullPath);
            dir = currentScript.get_parent();
        }

        // 3. If X begins with './' or '/' or '../'
        //     a. LOAD_AS_FILE(Y + X)
        //     b. LOAD_AS_DIRECTORY(Y + X)
        //     c. THROW "not found"

        if (path.startsWith("./") || path.startsWith("/") || path.startsWith("../")) {
            let result = reuqireLoadAsFile(dir.resolve_relative_path(path).get_path());

            if (result) {
                return result;
            }

            result = requireLoadAsDirectory(dir.resolve_relative_path(path));

            if (result) {
                return result;
            }

            throw new Error(`Module not found '${path}'`);
        }


        // 4. If X begins with '#'
        //     a. LOAD_PACKAGE_IMPORTS(X, dirname(Y))

        // TODO: not implemented

        // 5. LOAD_PACKAGE_SELF(X, dirname(Y))

        // TODO: not implemented

        // 6. LOAD_NODE_MODULES(X, dirname(Y))

        let result = requireLoadNodeModules(path, dir.get_path());

        if (result) {
            return result;
        }

        // CUSTOM:
        
        let innerError: Error | null = null;

        try {
            result = path.split("/").reduce((importer, curr) => importer[curr], imports as Importer);

            if (result) {
                return result;
            }
        }
        catch(ex: unknown) {
            result = null;
            innerError = ex as Error;
        }

        // 7. THROW "not found"
        throw new Error(`Module not found ${path}.` + (innerError ? `\n${innerError.stack ?? innerError.toString()}` : ""));
    }

    (globalThis as any).require = function(path: string) {
        const existingExports = pathToModuleMap.get(path);
        if (existingExports) {
            return existingExports;
        }

        const exports = require(path);
        pathToModuleMap.set(path, exports);
        return exports;
    }
})();
