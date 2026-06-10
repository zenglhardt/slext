import { EditorBackend, EditorLine } from "./editorcommands";

export class AceEditorBackend implements EditorBackend {
    backslash(): string {
        return "\\\\";
    }
    wrapSelection(prefix: string, suffix: string) {
        document.dispatchEvent(
            new CustomEvent("slext:ace:wrapInCommand", {
                detail: JSON.stringify({ prefix, suffix }),
            })
        );
    }
    getSelectionLength(): Promise<number> {
        return new Promise((resolve, _reject) => {
            const listener = (evt: CustomEvent) => {
                document.removeEventListener("slext:ace:provideSelectionLength", listener);
                resolve(parseInt(evt.detail, 10));
            };
            document.addEventListener("slext:ace:provideSelectionLength", listener);
            document.dispatchEvent(new Event("slext:ace:requestSelectionLength"));
        });
    }

    getCurrentLine(): Promise<EditorLine> {
        return new Promise((resolve, _reject) => {
            const listener = (evt: CustomEvent) => {
                document.removeEventListener("slext:ace:provideLineInfo", listener);
                resolve(JSON.parse(evt.detail));
            };
            document.addEventListener("slext:ace:provideLineInfo", listener);
            document.dispatchEvent(new Event("slext:ace:requestLineInfo"));
        });
    }
}
