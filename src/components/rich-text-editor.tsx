"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function runCmd(command: string) {
  document.execCommand(command, false);
}

export function RichTextEditor({ value, onChange, placeholder }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!focusedRef.current && editor.innerHTML !== value) {
      editor.innerHTML = value || "";
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("bold")}>B</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("italic")}>I</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => runCmd("insertUnorderedList")}>List</Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        dir="ltr"
        suppressContentEditableWarning
        className="min-h-32 rounded-[22px] border border-slate-200/80 bg-white/90 p-4 text-left text-sm text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] focus:outline-none"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (editorRef.current && editorRef.current.innerHTML !== value) {
            onChange(editorRef.current.innerHTML);
          }
        }}
        onInput={(event) => {
          const html = (event.currentTarget as HTMLDivElement).innerHTML;
          onChange(html);
        }}
        data-placeholder={placeholder ?? "Add note..."}
      />
    </div>
  );
}
