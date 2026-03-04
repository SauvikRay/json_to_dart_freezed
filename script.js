const RESERVED = new Set([
    "abstract", "as", "assert", "async", "await", "break", "case", "catch", "class", "const",
    "continue", "covariant", "default", "deferred", "do", "dynamic", "else", "enum", "export",
    "extends", "extension", "external", "factory", "false", "final", "finally", "for", "Function",
    "get", "hide", "if", "implements", "import", "in", "interface", "is", "late", "library", "mixin",
    "new", "null", "on", "operator", "part", "rethrow", "return", "set", "show", "static", "super",
    "switch", "sync", "this", "throw", "true", "try", "typedef", "var", "void", "while", "with", "yield"
]);

const DEFAULT_OPTIONS = {
    nullSafety: true,
    typesOnly: false,
    putEncoderDecoderInClass: false,
    makeAllPropertiesRequired: false,
    makeAllPropertiesFinal: true,
    generateCopyWithMethod: true,
    makeAllPropertiesOptional: false
};

function pickById(...ids) {
    for (const id of ids) {
        const found = document.getElementById(id);
        if (found) return found;
    }
    return null;
}

const elements = {
    jsonInput: pickById("jsonInput"),
    jsonInputHighlight: pickById("jsonInputHighlight"),
    dartOutput: pickById("dartOutput", "generatedCode", "generatedOutput", "outputCode"),
    rootName: pickById("rootName"),
    fileName: pickById("fileName"),
    genBtn: pickById("genBtn", "generateBtn"),
    copyBtn: pickById("copyBtn"),
    sampleBtn: pickById("sampleBtn"),
    statusMsg: pickById("statusMsg"),
    optNullSafety: pickById("optNullSafety"),
    optTypesOnly: pickById("optTypesOnly"),
    optClassCodec: pickById("optClassCodec"),
    optRequired: pickById("optRequired"),
    optFinal: pickById("optFinal"),
    optCopyWith: pickById("optCopyWith"),
    optOptional: pickById("optOptional")
};

let latestOutput = "";
let autoGenerateTimer = null;

function ensureDartOutput() {
    if (elements.dartOutput) return elements.dartOutput;

    const outputPanel =
        document.querySelector(".output-panel") ||
        document.querySelector("main .panel:nth-child(2)");
    if (!outputPanel) return null;

    const pre = document.createElement("pre");
    pre.id = "dartOutput";
    pre.className = "code-view dart-view output-area";
    pre.textContent = "// Generated Dart will appear here.";
    outputPanel.appendChild(pre);
    elements.dartOutput = pre;
    return pre;
}

function setOutputText(text) {
    const output = ensureDartOutput();
    if (!output) return;
    output.textContent = text;

    output.style.color = "#111827";
    output.style.backgroundColor = "#ffffff";
    output.style.opacity = "1";
    output.style.visibility = "visible";
    output.style.display = "block";
    output.scrollTop = 0;
    output.scrollLeft = 0;
}

function setStatus(message, type) {
    if (!elements.statusMsg) return;
    elements.statusMsg.textContent = message;
    elements.statusMsg.className = `status ${type || "info"}`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function upperCamel(value) {
    const cleaned = String(value).replace(/[^a-zA-Z0-9]+/g, " ").trim();
    if (!cleaned) return "Model";
    return cleaned
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

function lowerCamel(value) {
    const upper = upperCamel(value);
    return upper.charAt(0).toLowerCase() + upper.slice(1);
}

function isValidDartIdentifier(value) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) && !RESERVED.has(value);
}

function sanitizeFieldName(jsonKey) {
    let name = lowerCamel(jsonKey);

    if (!name) name = "field";
    name = name.replace(/[^a-zA-Z0-9_]+/g, "_");
    name = name.replace(/^_+/g, "");
    name = name.replace(/_+$/g, "");

    if (!/^[a-zA-Z]/.test(name)) {
        name = `field${upperCamel(name || "value")}`;
    }

    if (RESERVED.has(name)) {
        name = `${name}Field`;
    }

    if (!isValidDartIdentifier(name)) {
        name = name.replace(/[^a-zA-Z0-9_]+/g, "_");
        name = name.replace(/^_+/g, "");
        if (!/^[a-zA-Z]/.test(name)) name = `field${name}`;
        if (RESERVED.has(name)) name = `${name}Field`;
    }

    return name;
}

function stableStringify(obj) {
    if (obj === null) return "null";
    if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
    if (typeof obj === "object") {
        const keys = Object.keys(obj).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
    }
    return JSON.stringify(obj);
}

function inferType(value, ctx) {
    if (value === null) return { type: "dynamic", nullable: true, jsonKind: "null" };

    const valueType = typeof value;
    if (valueType === "string") return { type: "String", nullable: false, jsonKind: "string" };
    if (valueType === "number") {
        return { type: Number.isInteger(value) ? "int" : "double", nullable: false, jsonKind: "number" };
    }
    if (valueType === "boolean") return { type: "bool", nullable: false, jsonKind: "bool" };

    if (Array.isArray(value)) {
        if (value.length === 0) return { type: "List<dynamic>", nullable: false, jsonKind: "list" };

        const elementInfos = value.map((item) => inferType(item, ctx));
        const anyNullable = elementInfos.some((item) => item.nullable);
        const baseTypes = new Set(elementInfos.map((item) => item.type.replace(/\?$/, "")));

        let elementType = "dynamic";
        if (baseTypes.size === 1) {
            elementType = [...baseTypes][0];
        } else {
            const allNumeric = [...baseTypes].every((type) => type === "int" || type === "double");
            if (allNumeric) elementType = "num";
        }

        const finalElementType = elementType === "dynamic" ? "dynamic" : `${elementType}${anyNullable ? "?" : ""}`;
        return { type: `List<${finalElementType}>`, nullable: false, jsonKind: "list" };
    }

    if (valueType === "object") {
        const className = ctx.classNameForObject(value);
        ctx.registerClass(className, value);
        return { type: className, nullable: false, jsonKind: "object" };
    }

    return { type: "dynamic", nullable: false, jsonKind: "unknown" };
}

function appendNullableIfNeeded(typeName) {
    if (typeName === "dynamic") return typeName;
    if (typeName.endsWith("?")) return typeName;
    return `${typeName}?`;
}

function removeNullability(typeName) {
    return typeName.replace(/\?/g, "");
}

function readGeneratorOptions() {
    return {
        nullSafety: elements.optNullSafety ? elements.optNullSafety.checked : DEFAULT_OPTIONS.nullSafety,
        typesOnly: elements.optTypesOnly ? elements.optTypesOnly.checked : DEFAULT_OPTIONS.typesOnly,
        putEncoderDecoderInClass: elements.optClassCodec
            ? elements.optClassCodec.checked
            : DEFAULT_OPTIONS.putEncoderDecoderInClass,
        makeAllPropertiesRequired: elements.optRequired
            ? elements.optRequired.checked
            : DEFAULT_OPTIONS.makeAllPropertiesRequired,
        makeAllPropertiesFinal: elements.optFinal ? elements.optFinal.checked : DEFAULT_OPTIONS.makeAllPropertiesFinal,
        generateCopyWithMethod: elements.optCopyWith
            ? elements.optCopyWith.checked
            : DEFAULT_OPTIONS.generateCopyWithMethod,
        makeAllPropertiesOptional: elements.optOptional
            ? elements.optOptional.checked
            : DEFAULT_OPTIONS.makeAllPropertiesOptional
    };
}

function applyOptionDependencies(changedId) {
    if (elements.optRequired && elements.optOptional && elements.optRequired.checked && elements.optOptional.checked) {
        if (changedId === "optRequired") elements.optOptional.checked = false;
        else elements.optRequired.checked = false;
    }

    if (elements.optTypesOnly && elements.optClassCodec) {
        const disableClassCodec = elements.optTypesOnly.checked;
        if (disableClassCodec) elements.optClassCodec.checked = false;
        elements.optClassCodec.disabled = disableClassCodec;
    }

    if (elements.optFinal && elements.optCopyWith) {
        const disableCopyWith = !elements.optFinal.checked;
        if (disableCopyWith) elements.optCopyWith.checked = false;
        elements.optCopyWith.disabled = disableCopyWith;
    }
}

function getClassAnnotation(config) {
    if (config.makeAllPropertiesFinal) {
        return config.generateCopyWithMethod ? "@freezed" : "@Freezed(copyWith: false)";
    }
    return "@unfreezed";
}

function buildGenerator(rootName, fileName, jsonObj, options) {
    const config = { ...DEFAULT_OPTIONS, ...options };
    const classes = new Map();
    const signatureToName = new Map();
    const usedNames = new Set([rootName]);
    const queue = [{ name: rootName, obj: jsonObj }];

    signatureToName.set(stableStringify(Object.keys(jsonObj).sort()), rootName);

    while (queue.length) {
        const current = queue.shift();
        if (classes.has(current.name)) continue;
        classes.set(current.name, current.obj);

        for (const [jsonKey, value] of Object.entries(current.obj)) {
            inferType(value, {
                classNameForObject: (obj) => {
                    const signature = stableStringify(Object.keys(obj).sort());
                    if (signatureToName.has(signature)) return signatureToName.get(signature);

                    let base = upperCamel(jsonKey);
                    if (!base || base === "Model") base = "Model";

                    let candidate = base;
                    let index = 2;
                    while (usedNames.has(candidate)) {
                        candidate = `${base}${index}`;
                        index += 1;
                    }

                    usedNames.add(candidate);
                    signatureToName.set(signature, candidate);
                    return candidate;
                },
                registerClass: (childName, childObj) => {
                    if (!classes.has(childName)) queue.push({ name: childName, obj: childObj });
                }
            });

            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item && typeof item === "object" && !Array.isArray(item)) {
                        const signature = stableStringify(Object.keys(item).sort());
                        const childName = signatureToName.get(signature);
                        if (childName && !classes.has(childName)) {
                            queue.push({ name: childName, obj: item });
                        }
                    }
                }
            }
        }
    }

    const classOrder = [...classes.keys()].filter((name) => name !== rootName).sort().concat([rootName]);

    function generateClass(name, obj) {
        const lines = [];
        const constructorPrefix = config.makeAllPropertiesFinal ? "const factory" : "factory";

        lines.push(getClassAnnotation(config));
        lines.push(`class ${name} with _$${name} {`);
        lines.push(`  ${constructorPrefix} ${name}({`);

        for (const [jsonKey, value] of Object.entries(obj)) {
            const fieldName = sanitizeFieldName(jsonKey);
            const needsJsonKey =
                fieldName !== jsonKey ||
                !isValidDartIdentifier(jsonKey) ||
                jsonKey !== lowerCamel(jsonKey);

            const typeInfo = inferType(value, {
                classNameForObject: (childObj) => {
                    const signature = stableStringify(Object.keys(childObj).sort());
                    return signatureToName.get(signature) || "Model";
                },
                registerClass: () => {}
            });

            let dartType = typeInfo.type;
            let isNullable = typeInfo.nullable || value === null;

            if (!config.nullSafety) {
                dartType = removeNullability(dartType);
                isNullable = false;
            } else if (config.makeAllPropertiesRequired) {
                dartType = removeNullability(dartType);
                isNullable = false;
            } else if (config.makeAllPropertiesOptional) {
                dartType = appendNullableIfNeeded(dartType);
                isNullable = true;
            } else {
                if (isNullable) dartType = appendNullableIfNeeded(dartType);
                else dartType = removeNullability(dartType);
            }

            const shouldRequire =
                config.nullSafety && (config.makeAllPropertiesRequired || (!config.makeAllPropertiesOptional && !isNullable));
            const requiredKeyword = shouldRequire ? "required " : "";

            if (needsJsonKey) {
                lines.push(`    @JsonKey(name: '${jsonKey}') ${requiredKeyword}${dartType} ${fieldName},`);
            } else {
                lines.push(`    ${requiredKeyword}${dartType} ${fieldName},`);
            }
        }

        lines.push(`  }) = _${name};`);

        if (!config.typesOnly) {
            lines.push("");
            lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) => _$${name}FromJson(json);`);
        }

        if (!config.typesOnly && config.putEncoderDecoderInClass) {
            lines.push("");
            lines.push(
                `  factory ${name}.fromJsonString(String source) => ${name}.fromJson(jsonDecode(source) as Map<String, dynamic>);`
            );
            lines.push("  String toJsonString() => jsonEncode(toJson());");
        }

        lines.push("}");
        return lines.join("\n");
    }

    const imports = ["import 'package:freezed_annotation/freezed_annotation.dart';"];
    if (!config.typesOnly && config.putEncoderDecoderInClass) {
        imports.unshift("import 'dart:convert';");
    }

    const parts = [`part '${fileName.replace(/\.dart$/, "")}.freezed.dart';`];
    if (!config.typesOnly) {
        parts.push(`part '${fileName.replace(/\.dart$/, "")}.g.dart';`);
    }

    const header = [
        "// GENERATED (by json_to_freezed.html)",
        `// File: ${fileName}`,
        "",
        ...imports,
        "",
        ...parts,
        ""
    ].join("\n");

    const body = classOrder.map((name) => generateClass(name, classes.get(name))).join("\n\n");
    return `${header}${body}\n`;
}

function applyHighlightRules(source, rules) {
    let text = source;
    const placeholders = [];

    for (const rule of rules) {
        rule.regex.lastIndex = 0;
        text = text.replace(rule.regex, (match) => {
            const id = placeholders.length;
            placeholders.push(`<span class="${rule.className}">${escapeHtml(match)}</span>`);
            return `\u0001${id}\u0002`;
        });
    }

    let html = escapeHtml(text);
    html = html.replace(/\u0001(\d+)\u0002/g, (_, id) => placeholders[Number(id)] || "");
    return html;
}

function highlightJson(source) {
    const pattern =
        /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;

    let html = "";
    let lastIndex = 0;
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(source)) !== null) {
        const token = match[0];
        html += escapeHtml(source.slice(lastIndex, match.index));

        let className = "token-string";
        if (/^"/.test(token)) className = /:$/.test(token) ? "token-key" : "token-string";
        else if (/true|false/.test(token)) className = "token-bool";
        else if (/null/.test(token)) className = "token-null";
        else className = "token-number";

        html += `<span class="${className}">${escapeHtml(token)}</span>`;
        lastIndex = match.index + token.length;
    }

    html += escapeHtml(source.slice(lastIndex));
    return html;
}

function highlightDart(source) {
    const keywordPattern =
        /\b(?:class|with|const|required|factory|import|part|return|dynamic|final|true|false|null|if|else|for|while|switch|case|break|continue|static|new|void)\b/g;
    const typePattern = /\b(?:String|int|double|bool|num|dynamic|List|Map|Object)\b|\b[A-Z][A-Za-z0-9_]*\b/g;

    return applyHighlightRules(source, [
        { regex: /\/\/[^\n\r]*/g, className: "token-comment" },
        { regex: /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, className: "token-string" },
        { regex: /@[A-Za-z_][A-Za-z0-9_]*/g, className: "token-annotation" },
        { regex: keywordPattern, className: "token-keyword" },
        { regex: typePattern, className: "token-type" }
    ]);
}

function syncJsonInputScroll() {
    if (!elements.jsonInput || !elements.jsonInputHighlight) return;
    elements.jsonInputHighlight.scrollTop = elements.jsonInput.scrollTop;
    elements.jsonInputHighlight.scrollLeft = elements.jsonInput.scrollLeft;
}

function renderJsonInputHighlight(rawValue) {
    if (!elements.jsonInputHighlight) return;
    if (!rawValue.trim()) {
        elements.jsonInputHighlight.innerHTML =
            "<span class=\"token-comment\">// Paste JSON here (root must be an object: { ... })</span>";
        return;
    }

    const source = rawValue.endsWith("\n") ? rawValue : `${rawValue}\n`;
    elements.jsonInputHighlight.innerHTML = highlightJson(source);
    syncJsonInputScroll();
}

function renderDartOutput(text) {
    const source = text.trim() ? text : "// Generated Dart will appear here.";
    const highlighted = highlightDart(source.endsWith("\n") ? source : `${source}\n`);
    const output = ensureDartOutput();
    if (!output) {
        setOutputText(source);
        return;
    }

    output.innerHTML = highlighted;
    output.style.color = "#111827";
    output.style.backgroundColor = "#ffffff";
    output.style.opacity = "1";
    output.style.visibility = "visible";
    output.style.display = "block";
    output.scrollTop = 0;
    output.scrollLeft = 0;
}

function generate() {
    try {
        if (!elements.jsonInput || !elements.rootName || !elements.fileName) {
            latestOutput = "Generation error:\nRequired UI elements are missing.";
            renderDartOutput(latestOutput);
            setStatus("Generation failed. Missing UI elements.", "error");
            return;
        }

        const inputRaw = elements.jsonInput.value;
        const inputTrimmed = inputRaw.trim();
        const rootNameRaw = elements.rootName.value.trim() || "ApiResponse";
        const fileNameRaw = elements.fileName.value.trim() || "api_response.dart";

        renderJsonInputHighlight(inputRaw);

        if (!inputTrimmed) {
            latestOutput = "";
            renderDartOutput("");
            setStatus("Paste JSON first.", "info");
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(inputRaw);
        } catch (error) {
            latestOutput = `Invalid JSON:\n${error.message}`;
            renderDartOutput(latestOutput);
            setStatus("Invalid JSON. Fix the input and generate again.", "error");
            return;
        }

        if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
            latestOutput =
                "Please paste a JSON object at the root (for example: { ... }). " +
                "If your root is a list, wrap it like {\"items\": [...]}";
            renderDartOutput(latestOutput);
            setStatus("Root must be a JSON object.", "error");
            return;
        }

        const rootName = upperCamel(rootNameRaw);
        const fileName = fileNameRaw.endsWith(".dart") ? fileNameRaw : `${fileNameRaw}.dart`;
        const options = readGeneratorOptions();

        latestOutput = buildGenerator(rootName, fileName, parsed, options);
        renderDartOutput(latestOutput);
        setStatus("Dart code generated.", "success");
    } catch (error) {
        latestOutput = `Generation error:\n${error && error.message ? error.message : String(error)}`;
        renderDartOutput(latestOutput);
        setStatus("Generation failed. See output panel for details.", "error");
    }
}

if (elements.genBtn) {
    elements.genBtn.addEventListener("click", generate);
}

if (elements.jsonInput) {
    elements.jsonInput.addEventListener("input", () => {
        renderJsonInputHighlight(elements.jsonInput.value);
        if (autoGenerateTimer) clearTimeout(autoGenerateTimer);
        autoGenerateTimer = setTimeout(() => {
            autoGenerateTimer = null;
            const raw = elements.jsonInput.value.trim();
            if (!raw) {
                latestOutput = "";
                renderDartOutput("");
                setStatus("Paste JSON first.", "info");
                return;
            }

            try {
                const parsed = JSON.parse(raw);
                if (parsed !== null && !Array.isArray(parsed) && typeof parsed === "object") generate();
                else {
                    latestOutput = "";
                    renderDartOutput("");
                    setStatus("Root must be a JSON object.", "error");
                }
            } catch (_) {
                setStatus("Typing JSON...", "info");
            }
        }, 180);
    });
    elements.jsonInput.addEventListener("scroll", syncJsonInputScroll);
}

if (elements.copyBtn) {
    elements.copyBtn.addEventListener("click", async () => {
        if (!latestOutput.trim()) {
            setStatus("Nothing to copy yet.", "error");
            return;
        }

        try {
            await navigator.clipboard.writeText(latestOutput);
            setStatus("Generated output copied to clipboard.", "success");
        } catch (_) {
            setStatus("Clipboard copy failed in this browser context.", "error");
        }
    });
}

if (elements.sampleBtn && elements.jsonInput) {
    elements.sampleBtn.addEventListener("click", () => {
        const sample = {
            status: "ok",
            page: 1,
            user_id: 123,
            user: { id: 123, full_name: "Sauvik Ray", is_active: true },
            items: [
                { id: 1, title: "First", rating: 4.5, tags: ["a", "b"] },
                { id: 2, title: "Second", rating: null, tags: [] }
            ]
        };

        elements.jsonInput.value = JSON.stringify(sample, null, 2);
        renderJsonInputHighlight(elements.jsonInput.value);
        generate();
    });
}

const optionElements = [
    elements.optNullSafety,
    elements.optTypesOnly,
    elements.optClassCodec,
    elements.optRequired,
    elements.optFinal,
    elements.optCopyWith,
    elements.optOptional
].filter(Boolean);

for (const optionEl of optionElements) {
    optionEl.addEventListener("change", () => {
        applyOptionDependencies(optionEl.id);

        if (elements.jsonInput && elements.jsonInput.value.trim()) generate();
        else setStatus("Generator options updated.", "info");
    });
}

applyOptionDependencies("");
renderJsonInputHighlight(elements.jsonInput ? elements.jsonInput.value : "");
renderDartOutput("");
setStatus("Ready.", "info");
