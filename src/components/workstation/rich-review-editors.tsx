"use client";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List } from "lucide-react";
import { richHtml } from "@/lib/workstation/rich-text";

export function FormattedField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const editor = useEditor({ extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false })], content: richHtml(value), immediatelyRender: false, shouldRerenderOnTransaction: false,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" } }, onUpdate: ({ editor }) => change.current(editor.getHTML()) });
  useEffect(() => { if (editor && editor.getHTML() !== richHtml(value) && !(editor.isEmpty && !value)) editor.commands.setContent(richHtml(value), { emitUpdate: false }); }, [editor, value]);
  return <div className="ws-richtext"><div className="ws-format" role="toolbar" aria-label={`Format ${label}`}>
    <button type="button" aria-label={`Bold ${label}`} title="Bold (Ctrl+B)" onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
    <button type="button" aria-label={`Italic ${label}`} title="Italic (Ctrl+I)" onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
    <button type="button" aria-label={`Underline ${label}`} title="Underline (Ctrl+U)" onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
    <button type="button" aria-label={`Bullet list ${label}`} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</button>
    <button type="button" aria-label={`Numbered list ${label}`} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. List</button>
    <button type="button" aria-label={`Undo ${label}`} onClick={() => editor?.chain().focus().undo().run()}>↶</button>
    <button type="button" aria-label={`Redo ${label}`} onClick={() => editor?.chain().focus().redo().run()}>↷</button>
  </div><EditorContent editor={editor} /></div>;
}

export function FormattedNote({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const editor = useEditor({ extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false })], content: value, immediatelyRender: false, shouldRerenderOnTransaction: false, editorProps: { attributes: { "aria-label": "Formatted review notes", role: "textbox", "aria-multiline": "true" } }, onUpdate: ({ editor }) => change.current(editor.getHTML()) });
  useEffect(() => { if (editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value]);
  return <div className="ws-richtext"><div className="ws-format"><button title="Bold" aria-label="Bold notes" onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={13} /></button><button title="Italic" aria-label="Italic notes" onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={13} /></button><button title="Bullet list" aria-label="Bullet list notes" onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={14} /></button><span>Notes & observations</span></div><EditorContent editor={editor} /></div>;
}
