import { Dispatcher } from "./dispatcher";
import { File, FileUtils } from "./file";
import * as $ from "jquery";
import { Service } from "typedi";
import { Utils } from "./utils";

@Service()
export class Slext extends Dispatcher {
    private _files: Array<File> = [];
    private _currentlySelectedFile: File | null = null;
    private _currentlySelectedFileId: string | null = null;
    private static id = 0;
    private loaded = false;

    id = -1;

    constructor() {
        super();
        this.id = Slext.id++;
        const loadingTimer = setInterval(() => {
            // Then check if the SL loading screen has finished
            if (document.getElementsByClassName("loading-screen").length) return;

            clearInterval(loadingTimer);
            document.body.classList.add(Utils.isShareLatex(window.location.href) ? "sharelatex" : "overleaf");
            document.body.classList.add("slext-loaded");
            this.loadingFinished();
            this.loaded = true;
        }, 200);
    }

    public isLoaded(): boolean {
        return this.loaded;
    }

    public getId(): number {
        return this.id;
    }

    public focusEditor() {
        document.dispatchEvent(new Event("slext:focusEditor"));
    }

    private isModernLayout(): boolean {
        return $(".ide-redesign-main").length > 0;
    }

    private clickModernLayoutOption(icon: string): boolean {
        const toggle = $("#layout-dropdown-btn").first();
        if (!toggle.length) {
            return false;
        }

        document.body.classList.add("slext-automating-layout-menu");
        (toggle[0] as HTMLElement).click();
        window.setTimeout(() => {
            const items = $(".layout-dropdown .dropdown-menu .dropdown-item, .dropdown-menu.show .dropdown-item");
            const option = items.toArray().find((item) => {
                return $(item).find(".dropdown-item-leading-icon").text().trim() === icon;
            }) as HTMLElement | undefined;

            if (option) {
                option.click();
                this.dispatch("layoutChanged");
            } else {
                (toggle[0] as HTMLElement).click();
            }
            window.setTimeout(() => document.body.classList.remove("slext-automating-layout-menu"), 150);
        }, 50);

        return true;
    }

    private panelHasWidth(selector: string): boolean {
        const panel = document.querySelector(selector);
        if (!(panel instanceof HTMLElement)) {
            return false;
        }
        return panel.getBoundingClientRect().width > 1;
    }

    public isFullScreenPDF(): boolean {
        if (this.isModernLayout()) {
            return (
                $("#ide-redesign-editor-panel.hidden").length > 0 &&
                $("#ide-redesign-pdf-panel:not(.hidden)").length > 0 &&
                this.panelHasWidth("#ide-redesign-pdf-panel")
            );
        }
        return $(".full-size.ng-scope:not(.ng-hide)[ng-show=\"ui.view == 'pdf'\"],.pdf.full-size").length > 0;
    }

    public isFullScreenEditor(): boolean {
        return !this.isFullScreenPDF() && !this.isSplitScreen();
    }

    public isHistoryOpen(): boolean {
        return $("#ide-body.ide-history-open,.history-react").length > 0;
    }

    private _toggleFullScreenPDFEditor(): void {
        if (this.isModernLayout()) {
            if (this.isFullScreenPDF()) {
                this.goToFullScreenEditor();
            } else {
                this.goToFullScreenPDF();
            }
            return;
        }

        // There's no good way to select the togglePdf button anymore.
        // So we're using a very specific selector to hopefully avoid false hits.
        const button_icon = $("header.toolbar-header .toolbar-left + a.btn-full-height-no-border i.fa-file-pdf-o");

        if (button_icon.length) {
            (button_icon.parent()[0] as HTMLElement).click();
        }
    }

    public toggleFullScreenPDFEditor(): void {
        if (this.isSplitScreen()) this.goToFullScreenPDF();
        else this._toggleFullScreenPDFEditor();
    }

    public goToFullScreenEditor(): void {
        if (this.isModernLayout() && this.clickModernLayoutOption("edit")) {
            return;
        }

        if (this.isSplitScreen()) {
            const button = $("[ng-click=\"switchToFlatLayout('pdf')\"]");
            if (button.length) {
                (button[0] as HTMLElement).click();
            }
        } else if (!this.isFullScreenEditor()) {
            this.toggleFullScreenPDFEditor();
        }
    }

    public goToFullScreenPDF(): void {
        if (this.isModernLayout() && this.clickModernLayoutOption("picture_as_pdf")) {
            return;
        }

        if (this.isSplitScreen()) {
            let button = $("[ng-click=\"switchToFlatLayout('pdf')\"]");
            if (!button.length) {
                // Try to use the beta-feature button
                button = $(".toolbar-pdf-expand-btn");
            }
            if (button.length) {
                (button[0] as HTMLElement).click();
            }
        } else if (!this.isFullScreenPDF()) {
            this._toggleFullScreenPDFEditor();
        }
    }

    public goToSplitScreen(): void {
        if (this.isModernLayout() && this.clickModernLayoutOption("splitscreen_right")) {
            return;
        }

        if (!this.isSplitScreen()) {
            const button = $("[ng-click=\"switchToSideBySideLayout('editor')\"]");
            if (button.length) {
                (button[0] as HTMLElement).click();
            }
        }
    }

    public isSplitScreen(): boolean {
        if (this.isModernLayout()) {
            return (
                $("#ide-redesign-editor-panel:not(.hidden)").length > 0 &&
                $("#ide-redesign-pdf-panel:not(.hidden)").length > 0 &&
                this.panelHasWidth("#ide-redesign-editor-panel") &&
                this.panelHasWidth("#ide-redesign-pdf-panel")
            );
        }
        return $("[ng-click=\"switchToFlatLayout('editor')\"]:not(.ng-hide)").length > 0;
    }

    private loadingFinished(): void {
        this.setupListeners();
    }

    private parseEventDetail(detail: any): any {
        if (typeof detail !== "string") {
            return detail;
        }
        try {
            return JSON.parse(detail);
        } catch (_error) {
            return detail;
        }
    }

    private setCurrentlySelectedFileById(file_id: string | null): void {
        this._currentlySelectedFileId = file_id;
        const matches = this._files.filter((f, _i) => f.id == file_id);
        const file = matches.length ? matches[0] : null;
        this._currentlySelectedFile = file;
        this.dispatch("FileSelected", file);
    }

    private setupListeners(): void {
        document.addEventListener("slext:fileChanged", (e: CustomEvent) => {
            const file_id = this.parseEventDetail(e.detail);
            this.setCurrentlySelectedFileById(file_id);
        });

        document.addEventListener("slext:setProject", (e: CustomEvent) => {
            this.updateFiles(this.parseEventDetail(e.detail));
        });

        $(document).on(
            "click",
            "[ng-click=\"switchToSideBySideLayout('editor')\"], " +
                "[ng-click=\"switchToFlatLayout('pdf')\"], " +
                "[ng-click=\"switchToFlatLayout('editor')\"] ",
            () => {
                this.dispatch("layoutChanged");
            }
        );
    }

    public updateFiles(project: any): Promise<File[]> {
        function getDocsFromFolder(folder, path) {
            const docs = folder.docs || [];
            const folders = folder.folders || [];
            const files = docs.map((d) => FileUtils.newFile(d.name, path + "/" + d.name, d._id, "doc"));
            for (const subFolder of folders) {
                files.push(...getDocsFromFolder(subFolder, path + "/" + subFolder.name));
            }
            return files;
        }
        return new Promise((resolve) => {
            const rootFolder = Array.isArray(project?.rootFolder) ? project.rootFolder[0] : project?.rootFolder;
            if (!rootFolder) {
                resolve(this._files);
                return;
            }
            const files = getDocsFromFolder(rootFolder, "");
            this._files = files;
            if (this._currentlySelectedFileId) {
                this.setCurrentlySelectedFileById(this._currentlySelectedFileId);
            }
            this.dispatch("FilesChanged");
            resolve(this._files);
        });
    }

    public getFiles(): Array<File> {
        return this._files;
    }

    public currentFile(): Promise<File> {
        return new Promise((resolve, reject) => {
            if (this._currentlySelectedFile) {
                resolve(this._currentlySelectedFile);
            } else {
                reject();
            }
        });
    }

    public selectFile(file: File): void {
        if (this._files.filter((f) => f.id == file.id && f.path == file.path).length > 0) {
            document.dispatchEvent(new CustomEvent("slext:doFileChange", { detail: file.id }));
        }
    }
}
