/**
 * EmailBodyEditor — Tiptap-based rich body editor for automated email templates.
 *
 * Supports bold, italic, paragraph breaks, and insertable section chips.
 * Section chips are non-editable block atoms that map to a template's named
 * auto-generated sections (Organization Details, Primary Contact, etc.).
 * Staff can reorder chips by drag/cut-paste and delete them with Backspace.
 *
 * Value format: BodyBlock[] — matches the server's render.ts BodyBlock type.
 */
import { useEffect, useRef, useMemo } from "react";
import type { ReactElement } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Node, mergeAttributes } from "@tiptap/core";

// ---- Shared type (mirrors server/email/render.ts BodyBlock) ----
export type BodyBlock =
  | { kind: "paragraph"; html: string }
  | { kind: "section"; name: string };

export type SectionDef = { name: string; label: string };

// ---- HTML escaping for serializer ----
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- Serialize a ProseMirror inline node to HTML ----
interface PmNode {
  type: string;
  text?: string;
  marks?: { type: string }[];
  content?: PmNode[];
  attrs?: Record<string, unknown>;
}

function serializeInline(node: PmNode): string {
  if (node.type === "hardBreak") return "<br />";
  if (node.type !== "text") return "";
  let text = esc(node.text ?? "");
  // Apply marks. ProseMirror stacks them; wrap outermost last.
  const marks = node.marks ?? [];
  const hasBold = marks.some((m) => m.type === "bold");
  const hasItalic = marks.some((m) => m.type === "italic");
  if (hasBold) text = `<strong>${text}</strong>`;
  if (hasItalic) text = `<em>${text}</em>`;
  return text;
}

// ---- Serialize Tiptap JSON doc → BodyBlock[] ----
function serializeToBlocks(json: PmNode): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  for (const node of json.content ?? []) {
    if (node.type === "paragraph") {
      const html = (node.content ?? []).map(serializeInline).join("");
      blocks.push({ kind: "paragraph", html });
    } else if (node.type === "sectionChip") {
      const name = node.attrs?.name as string | undefined;
      if (name) blocks.push({ kind: "section", name });
    }
  }
  return blocks;
}

// ---- Convert BodyBlock[] → HTML string for Tiptap setContent ----
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function blocksToHtml(blocks: BodyBlock[], sections: SectionDef[]): string {
  const parts = blocks.map((block) => {
    if (block.kind === "paragraph") {
      return `<p>${block.html || ""}</p>`;
    }
    const sec = sections.find((s) => s.name === block.name);
    if (!sec) return "";
    return `<div data-section-chip="" data-name="${escAttr(block.name)}" data-label="${escAttr(sec.label)}"></div>`;
  });
  const html = parts.filter(Boolean).join("");
  return html || "<p></p>";
}

// ---- SectionChip Tiptap node extension ----
const SectionChip = Node.create({
  name: "sectionChip",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: { default: null },
      label: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-section-chip]",
        getAttrs: (dom) => {
          if (typeof dom === "string") return {};
          const el = dom as HTMLElement;
          return {
            name: el.getAttribute("data-name") ?? null,
            label: el.getAttribute("data-label") ?? null,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-section-chip": "",
        "data-name": node.attrs.name,
        "data-label": node.attrs.label,
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-section-chip", "");
      dom.className = "email-section-chip";
      dom.contentEditable = "false";
      dom.setAttribute("title", "Section chip — drag to reorder, Backspace to remove");

      const icon = document.createElement("span");
      icon.className = "email-section-chip-icon";
      icon.textContent = "§";

      const label = document.createElement("span");
      label.textContent = (node.attrs.label as string | null) ?? node.attrs.name ?? "(section)";

      dom.appendChild(icon);
      dom.appendChild(label);
      return { dom };
    };
  },
});

// ---- Props ----
interface Props {
  value: BodyBlock[];
  onChange: (blocks: BodyBlock[]) => void;
  sections: SectionDef[];
}

// ---- Component ----
export function EmailBodyEditor({ value, onChange, sections }: Props): ReactElement {
  const lastEmittedRef = useRef<string>("");
  const initialHtml = useMemo(() => blocksToHtml(value, sections), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [StarterKit, SectionChip],
    content: initialHtml,
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as PmNode;
      const blocks = serializeToBlocks(json);
      const serialized = JSON.stringify(blocks);
      if (serialized !== lastEmittedRef.current) {
        lastEmittedRef.current = serialized;
        onChange(blocks);
      }
    },
  });

  // Sync when value changes externally (e.g. after restore-to-default).
  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(value);
    if (incoming === lastEmittedRef.current) return; // we emitted this, skip
    lastEmittedRef.current = incoming;
    editor.commands.setContent(blocksToHtml(value, sections));
  }, [value, editor, sections]);

  function insertSection(name: string, label: string): void {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: "sectionChip", attrs: { name, label } })
      .run();
  }

  const bold = editor?.isActive("bold") ?? false;
  const italic = editor?.isActive("italic") ?? false;

  // Which sections are not yet in the current doc?
  const usedSections = useMemo(() => {
    if (!editor) return new Set<string>();
    const json = editor.getJSON() as PmNode;
    const used = new Set<string>();
    for (const node of json.content ?? []) {
      if (node.type === "sectionChip" && node.attrs?.name) {
        used.add(node.attrs.name as string);
      }
    }
    return used;
  }, [editor?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableSections = sections.filter((s) => !usedSections.has(s.name));

  return (
    <div className="email-editor-wrap">
      <div className="email-editor-toolbar">
        <button
          type="button"
          className={`email-editor-toolbar-btn${bold ? " is-active" : ""}`}
          title="Bold (Ctrl+B)"
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.chain().focus().toggleBold().run();
          }}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`email-editor-toolbar-btn${italic ? " is-active" : ""}`}
          title="Italic (Ctrl+I)"
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.chain().focus().toggleItalic().run();
          }}
        >
          <em>I</em>
        </button>

        {sections.length > 0 && (
          <>
            <span className="email-editor-toolbar-sep" aria-hidden="true" />
            <span className="email-editor-toolbar-label">Insert:</span>
            {sections.map((sec) => {
              const alreadyIn = !availableSections.find((s) => s.name === sec.name);
              return (
                <button
                  key={sec.name}
                  type="button"
                  className="email-editor-toolbar-btn"
                  title={alreadyIn ? "Already inserted — delete the chip to re-add" : `Insert ${sec.label}`}
                  disabled={alreadyIn}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSection(sec.name, sec.label);
                  }}
                >
                  + {sec.label}
                </button>
              );
            })}
          </>
        )}
      </div>
      <div className="email-editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
