import { Service } from "typedi";

@Service()
export class PageHook {
    public static inject(): void {
        // The page bridge is declared as a main-world content script in the manifest.
    }

    public static initialize(): void {
        document.dispatchEvent(new Event("slext:initializeStoreWatchers"));
    }
}
