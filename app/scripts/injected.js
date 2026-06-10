/* global document, window */

(() => {
    if (window.__slextBridgeInitialized) {
        return;
    }
    window.__slextBridgeInitialized = true;

    let lastProject = null;
    let storeWatchersInitialized = false;
    const storeUnwatchers = [];

    function encodeDetail(detail) {
        try {
            return JSON.stringify(detail);
        } catch (_error) {
            return detail;
        }
    }

    function decodeDetail(detail) {
        if (typeof detail !== "string") {
            return detail;
        }
        try {
            return JSON.parse(detail);
        } catch (_error) {
            return detail;
        }
    }

    function dispatchToSlext(name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail: encodeDetail(detail) }));
    }

    function emitProject(project) {
        if (!project || !project.rootFolder) {
            return;
        }
        lastProject = project;
        dispatchToSlext("slext:setProject", project);
    }

    function projectFromJoinedEventDetail(detail) {
        const payload = Array.isArray(detail) ? detail[0] : detail;
        return payload?.project || null;
    }

    const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (event) {
        if (event?.type === "project:joined") {
            emitProject(projectFromJoinedEventDetail(event.detail));
        }
        return originalDispatchEvent.apply(this, arguments);
    };

    function getStore() {
        return window.overleaf?.unstable?.store || null;
    }

    function watchStorePath(store, path, callback) {
        if (typeof store?.watch !== "function") {
            return;
        }
        const unwatch = store.watch(path, callback);
        if (typeof unwatch === "function") {
            storeUnwatchers.push(unwatch);
        }
        try {
            const value = store.get(path);
            if (value !== undefined) {
                callback(value);
            }
        } catch (_error) {
            // Some unstable store keys are not registered until later.
        }
    }

    window.addEventListener("beforeunload", () => {
        while (storeUnwatchers.length) {
            storeUnwatchers.pop()();
        }
    });

    function initializeStoreWatchers() {
        const store = getStore();
        if (!store) {
            return false;
        }

        if (!storeWatchersInitialized) {
            storeWatchersInitialized = true;
            watchStorePath(store, "project", emitProject);
            watchStorePath(store, "editor.open_doc_id", (id) => dispatchToSlext("slext:fileChanged", id));
        }

        if (lastProject) {
            dispatchToSlext("slext:setProject", lastProject);
        }

        return true;
    }

    document.addEventListener("slext:initializeStoreWatchers", () => {
        if (initializeStoreWatchers()) {
            return;
        }

        let attempts = 50;
        const interval = window.setInterval(() => {
            if (initializeStoreWatchers() || --attempts <= 0) {
                window.clearInterval(interval);
            }
        }, 100);
    });

    document.addEventListener("slext:doFileChange", ({ detail: rawId }) => {
        const id = decodeDetail(rawId);
        window.dispatchEvent(new CustomEvent("entity:opened", { detail: id }));
    });

    function getAceEditor() {
        const editors = window._debug_editors;
        return editors?.[editors.length - 1] || null;
    }

    document.addEventListener("slext:ace:wrapInCommand", (event) => {
        const editor = getAceEditor();
        if (!editor) {
            return;
        }
        const { prefix, suffix } = decodeDetail(event.detail);
        const selection = editor.getSelection();
        const text = editor.getCopyText();
        const empty = selection.isEmpty();

        editor.insert(`${prefix}${text}${suffix}`);

        if (empty) {
            editor.navigateLeft(suffix.length);
        }
    });

    document.addEventListener("slext:ace:requestSelectionLength", () => {
        const editor = getAceEditor();
        if (!editor) {
            return;
        }
        const text = editor.getSession().getDocument().getTextRange(editor.getSelectionRange());
        dispatchToSlext("slext:ace:provideSelectionLength", text.length);
    });

    document.addEventListener("slext:ace:requestLineInfo", () => {
        const editor = getAceEditor();
        if (!editor) {
            return;
        }
        const cursor = editor.getCursorPosition();
        dispatchToSlext("slext:ace:provideLineInfo", {
            column: cursor.column,
            row: cursor.row,
            text: editor.getSession().getLine(cursor.row),
        });
    });

    window.addEventListener("UNSTABLE_editor:extensions", (event) => {
        const { CodeMirror, extensions } = event.detail;

        const { EditorSelection, ViewPlugin } = CodeMirror;

        const requestLineInfo = ViewPlugin.define((view) => {
            const provideCurrentLineInfo = () => {
                if (view.state.selection.ranges.length != 1) {
                    return;
                }
                const selection = view.state.selection.ranges[0];
                const line = view.state.doc.lineAt(selection.from);
                dispatchToSlext("slext:codemirror:provideLineInfo", {
                    row: line.number,
                    column: selection.from - line.from,
                    text: line.text,
                });
            };
            document.addEventListener("slext:codemirror:requestLineInfo", provideCurrentLineInfo);

            return {
                destroy: () => {
                    document.removeEventListener("slext:codemirror:requestLineInfo", provideCurrentLineInfo);
                },
            };
        });
        extensions.push(requestLineInfo);

        const requestSelectionLength = ViewPlugin.define((view) => {
            const provideSelectionLength = () => {
                if (view.state.selection.ranges.length != 1) {
                    return;
                }
                const selection = view.state.selection.ranges[0];
                dispatchToSlext("slext:codemirror:provideSelectionLength", selection.to - selection.from);
            };
            document.addEventListener("slext:codemirror:requestSelectionLength", provideSelectionLength);

            return {
                destroy: () => {
                    document.removeEventListener("slext:codemirror:requestSelectionLength", provideSelectionLength);
                },
            };
        });
        extensions.push(requestSelectionLength);

        const focusView = ViewPlugin.define((view) => {
            const focus = () => {
                view.focus();
            };
            document.addEventListener("slext:focusEditor", focus);
            return {
                destroy: () => {
                    document.removeEventListener("slext:focusEditor", focus);
                },
            };
        });
        extensions.push(focusView);

        const requestWrapInCommand = ViewPlugin.define((view) => {
            const wrapInCommand = (event) => {
                const { prefix, suffix } = decodeDetail(event.detail);

                if (view.state.selection.ranges.length != 1) {
                    return;
                }

                view.dispatch(
                    view.state.changeByRange((range) => {
                        const isEmpty = range.to === range.from;
                        const prefixLength = prefix.toString().length;
                        const changes = isEmpty
                            ? view.state.changes([
                                  {
                                      from: range.from,
                                      insert: `${prefix}${suffix}`,
                                  },
                              ])
                            : view.state.changes([
                                  {
                                      from: range.from,
                                      insert: prefix,
                                  },
                                  {
                                      from: range.to,
                                      insert: suffix,
                                  },
                              ]);

                        if (isEmpty) {
                            return {
                                range: EditorSelection.cursor(range.from + prefixLength),
                                changes,
                            };
                        }

                        return {
                            range: EditorSelection.range(range.from + prefixLength, range.to + prefixLength),
                            changes,
                        };
                    })
                );
            };
            document.addEventListener("slext:codemirror:wrapInCommand", wrapInCommand);

            return {
                destroy: () => {
                    document.removeEventListener("slext:codemirror:wrapInCommand", wrapInCommand);
                },
            };
        });
        extensions.push(requestWrapInCommand);
    });
})();
